import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { seedRoles } from '../auth/roles.seed.js';
import { AuditEntry } from '../audit/audit.model.js';
import { Role } from '../auth/role.model.js';
import { Item } from '../catalog/item.model.js';
import { Unit } from '../catalog/unit.model.js';
import { addDays, todayLocal, weekdayOf } from '../lib/dates.js';
import { Session } from './session.model.js';
import { UsageLine } from './usage.model.js';
import { makeCentre, makePatient, programManager, staffIn } from '../../test/factories.js';

beforeAll(async () => {
  await Item.init();
  await Unit.init();
});
beforeEach(seedRoles);

async function setup() {
  const { centre, chairs, shifts } = await makeCentre();
  const base = `/api/centres/${centre.id}`;
  const nurse = await staffIn(centre.id, ['nurse']);
  const desk = await staffIn(centre.id, ['front_desk']);
  const pm = await programManager();
  const unit = (await pm.agent.post('/api/catalog/units').send({ name: 'cc' })).body as { id: string };
  const heparin = (await pm.agent.post('/api/catalog/items').send({ name: 'Heparin', type: 'medicine', unitId: unit.id })).body as {
    id: string;
  };
  await Item.updateOne({ _id: heparin.id }, { $set: { status: 'approved' } });
  const book = async (weekdays = [weekdayOf(todayLocal())], chair = 0) => {
    const { patient } = await makePatient(centre.id);
    const res = await desk.agent
      .post(`${base}/patients/${patient.id}/pattern`)
      .send({ chairId: chairs[chair]!.id, shiftId: shifts[0]!.id, weekdays, from: todayLocal() });
    expect(res.status).toBe(201);
    const session = await Session.findOne({ patientId: patient.id, date: todayLocal() });
    return { patient, session: session! };
  };
  return { centre, chairs, shifts, base, nurse, desk, pm, heparin, book };
}

describe('running a session', () => {
  it('open -> usage -> bp -> note -> close, GET shows everything, all audited', async () => {
    const { base, nurse, heparin, book } = await setup();
    const { session } = await book();
    const s = `${base}/sessions/${session.id}`;
    expect((await nurse.agent.post(`${s}/usage`).send({ itemId: heparin.id, amount: 5 })).status).toBe(409); // not active yet
    const opened = await nurse.agent.post(`${s}/open`);
    expect(opened.status).toBe(200);
    expect(opened.body.status).toBe('active');
    expect((await nurse.agent.post(`${s}/open`)).body.error).toBe('bad_status');
    const use = await nurse.agent.post(`${s}/usage`).send({ itemId: heparin.id, amount: 5 });
    expect(use.status).toBe(201);
    expect((await nurse.agent.patch(`${s}/vitals`).send({ weightBefore: 70.5 })).status).toBe(200);
    expect((await nurse.agent.post(`${s}/vitals/bp`).send({ systolic: 120, diastolic: 80 })).status).toBe(201);
    expect((await nurse.agent.post(`${s}/notes`).send({ text: 'all good' })).status).toBe(201);
    const closed = await nurse.agent.post(`${s}/close`);
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe('completed');
    const got = await nurse.agent.get(s);
    expect(got.status).toBe(200);
    expect(got.body).toMatchObject({ id: session.id, status: 'completed', orders: [] });
    expect(got.body.vitals.weightBefore).toBe(70.5);
    expect(got.body.vitals.bp).toHaveLength(1);
    expect(got.body.notes[0]).toMatchObject({ text: 'all good', by: { name: nurse.user.name } });
    expect(got.body.usage[0]).toMatchObject({ amount: 5, item: { id: heparin.id, name: 'Heparin', unit: 'cc' } });
    expect((await Item.findById(heparin.id))!.used).toBe(true);
    const actions = (await AuditEntry.find()).map((a) => a.action);
    for (const a of ['session.open', 'usage.add', 'vitals.update', 'note.add', 'session.close']) expect(actions).toContain(a);
    expect(actions.filter((a) => a === 'vitals.update')).toHaveLength(2);
    // completed sessions are read-only in this task
    const late = await nurse.agent.post(`${s}/usage`).send({ itemId: heparin.id, amount: 1 });
    expect(late.status).toBe(409);
    expect(late.body.error).toBe('bad_status');
  });

  it('removes a usage line (audited)', async () => {
    const { base, nurse, heparin, book } = await setup();
    const { session } = await book();
    const s = `${base}/sessions/${session.id}`;
    await nurse.agent.post(`${s}/open`);
    const use = await nurse.agent.post(`${s}/usage`).send({ itemId: heparin.id, amount: 2.5 });
    expect((await nurse.agent.delete(`${s}/usage/${use.body.id}`)).status).toBe(204);
    expect(await UsageLine.countDocuments()).toBe(0);
    expect((await nurse.agent.delete(`${s}/usage/${use.body.id}`)).status).toBe(404);
    expect(await AuditEntry.countDocuments({ action: 'usage.remove' })).toBe(1);
  });

  it('validates usage amount and item', async () => {
    const { base, nurse, heparin, book } = await setup();
    const { session } = await book();
    const s = `${base}/sessions/${session.id}`;
    await nurse.agent.post(`${s}/open`);
    expect((await nurse.agent.post(`${s}/usage`).send({ itemId: heparin.id, amount: 0 })).status).toBe(400);
    expect((await nurse.agent.post(`${s}/usage`).send({ itemId: heparin.id, amount: -1 })).status).toBe(400);
    expect((await nurse.agent.post(`${s}/usage`).send({ itemId: '64b000000000000000000000', amount: 1 })).status).toBe(404);
    await Item.updateOne({ _id: heparin.id }, { $set: { status: 'retired' } });
    const r = await nurse.agent.post(`${s}/usage`).send({ itemId: heparin.id, amount: 1 });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('item_retired');
  });

  it('usage/vitals/notes on a scheduled session are 409 bad_status', async () => {
    const { base, nurse, heparin, book } = await setup();
    const { session } = await book();
    const s = `${base}/sessions/${session.id}`;
    for (const r of [
      await nurse.agent.post(`${s}/usage`).send({ itemId: heparin.id, amount: 1 }),
      await nurse.agent.patch(`${s}/vitals`).send({ weightBefore: 70 }),
      await nurse.agent.post(`${s}/vitals/bp`).send({ systolic: 1, diastolic: 1 }),
      await nurse.agent.post(`${s}/notes`).send({ text: 'x' }),
    ]) {
      expect(r.status).toBe(409);
      expect(r.body.error).toBe('bad_status');
    }
  });

  it('a nurse of another centre gets 404 for a session of this centre', async () => {
    const a = await setup();
    const b = await setup();
    const { session } = await b.book();
    const res = await a.nurse.agent.get(`/api/centres/${a.centre.id}/sessions/${session.id}`);
    expect(res.status).toBe(404);
    expect((await a.nurse.agent.post(`/api/centres/${a.centre.id}/sessions/${session.id}/open`)).status).toBe(404);
  });

  it('opening a session dated tomorrow is 409 not_today', async () => {
    const { base, nurse, centre, chairs, shifts } = await setup();
    const { patient } = await makePatient(centre.id);
    const s = await Session.create({
      centreId: centre.id,
      patientId: patient.id,
      date: addDays(todayLocal(), 1),
      chairId: chairs[0]!.id,
      shiftId: shifts[0]!.id,
    });
    const res = await nurse.agent.post(`${base}/sessions/${s.id}/open`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('not_today');
  });

  it('front desk needs sessions.recordUsage: 403, then 201 once the PM grants it', async () => {
    const { base, nurse, desk, pm, heparin, book } = await setup();
    const { session } = await book();
    const s = `${base}/sessions/${session.id}`;
    await nurse.agent.post(`${s}/open`);
    expect((await desk.agent.post(`${s}/usage`).send({ itemId: heparin.id, amount: 1 })).status).toBe(403);
    const role = await Role.findOne({ key: 'front_desk' });
    await pm.agent.patch(`/api/roles/${role!.id}`).send({ permissions: [...role!.permissions, 'sessions.recordUsage'] });
    expect((await desk.agent.post(`${s}/usage`).send({ itemId: heparin.id, amount: 1 })).status).toBe(201);
  });

  it('closing without any heparin is fine', async () => {
    const { base, nurse, book } = await setup();
    const { session } = await book();
    const s = `${base}/sessions/${session.id}`;
    await nurse.agent.post(`${s}/open`);
    expect((await nurse.agent.post(`${s}/close`)).status).toBe(200);
    expect((await nurse.agent.post(`${s}/close`)).status).toBe(409);
  });
});

describe('postpone and make-up', () => {
  it('postpone then make-up in 2 days on a free chair', async () => {
    const { base, desk, chairs, shifts, book } = await setup();
    const { patient, session } = await book();
    expect((await desk.agent.post(`${base}/sessions/${session.id}/postpone`)).body.status).toBe('postponed');
    expect((await desk.agent.post(`${base}/sessions/${session.id}/postpone`)).status).toBe(409);
    const date = addDays(todayLocal(), 2);
    const res = await desk.agent.post(`${base}/patients/${patient.id}/makeup`).send({ date, chairId: chairs[1]!.id, shiftId: shifts[1]!.id });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ kind: 'makeup', status: 'scheduled', date });
    expect(await AuditEntry.countDocuments({ action: 'session.makeup' })).toBe(1);
    expect(await AuditEntry.countDocuments({ action: 'session.postpone' })).toBe(1);
  });

  it('make-up outside today..today+3 is 400', async () => {
    const { base, desk, chairs, shifts, book } = await setup();
    const { patient } = await book();
    const body = (date: string) => ({ date, chairId: chairs[1]!.id, shiftId: shifts[1]!.id });
    const far = await desk.agent.post(`${base}/patients/${patient.id}/makeup`).send(body(addDays(todayLocal(), 5)));
    expect(far.status).toBe(400);
    expect(far.body.error).toBe('makeup_out_of_window');
    expect((await desk.agent.post(`${base}/patients/${patient.id}/makeup`).send(body(addDays(todayLocal(), -1)))).status).toBe(400);
  });

  it('make-up onto a held slot or an occupied chair is 409 slot_busy', async () => {
    const { centre, base, desk, chairs, shifts, book } = await setup();
    const date = addDays(todayLocal(), 2);
    await book([weekdayOf(date)], 2); // another patient holds chair 3 / morning on that weekday
    const { patient } = await book([weekdayOf(todayLocal())], 0);
    const held = await desk.agent.post(`${base}/patients/${patient.id}/makeup`).send({ date, chairId: chairs[2]!.id, shiftId: shifts[0]!.id });
    expect(held.status).toBe(409);
    expect(held.body.error).toBe('slot_busy');
    // chair 1 / morning is occupied today by the first patient's regular session
    const other = await makePatient(centre.id);
    const busy = await desk.agent
      .post(`${base}/patients/${other.patient.id}/makeup`)
      .send({ date: todayLocal(), chairId: chairs[0]!.id, shiftId: shifts[0]!.id });
    expect(busy.status).toBe(409);
    expect(busy.body.error).toBe('slot_busy');
  });
});

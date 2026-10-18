import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { Types } from 'mongoose';
import { seedRoles } from '../auth/roles.seed.js';
import { Item } from '../catalog/item.model.js';
import { Unit } from '../catalog/unit.model.js';
import { addDays, todayLocal } from '../lib/dates.js';
import { Session } from '../sessions/session.model.js';
import { UsageLine } from '../sessions/usage.model.js';
import { makeCentre, makePatient, programManager, staffIn, makeSession } from '../../test/factories.js';

beforeAll(async () => {
  await Item.init();
  await Unit.init();
});
beforeEach(seedRoles);

const month = todayLocal().slice(0, 7);
const day = `${month}-10`;

async function setup() {
  const a = await makeCentre({ name: 'Alpha' });
  const b = await makeCentre({ name: 'Beta' });
  const pm = await programManager();
  const unit = (await pm.agent.post('/api/catalog/units').send({ name: 'cc' })).body as { id: string };
  const mk = async (name: string, type: string) => {
    const r = (await pm.agent.post('/api/catalog/items').send({ name, type, unitId: unit.id })).body as { id: string };
    await Item.updateOne({ _id: r.id }, { $set: { status: 'approved' } });
    return r;
  };
  const heparin = await mk('Heparin', 'medicine');
  const saline = await mk('Saline', 'medicine');
  const gauze = await mk('Gauze', 'supply');
  return { a, b, pm, unit, mk, heparin, saline, gauze };
}
type S = Awaited<ReturnType<typeof setup>>;

function sess(c: S['a'], patientId: Types.ObjectId, status: string, date = day, chair = 0) {
  return makeSession({
    centreId: c.centre._id,
    patientId,
    date,
    chairId: c.chairs[chair]!._id,
    shiftId: c.shifts[0]!._id,
    status,
  });
}
const use = (s: Awaited<ReturnType<typeof sess>>, itemId: string, amount: number) =>
  UsageLine.create({
    sessionId: s._id, centreId: s.centreId, patientId: s.patientId, date: s.date,
    itemId, amount, by: new Types.ObjectId(),
  });
const named = (body: { centre: { name: string } }[], name: string) => body.find((x) => x.centre.name === name);

describe('aggregation', () => {
  it('counts completed sessions and distinct patients; totals usage per item in unit, sorted by name', async () => {
    const s = await setup();
    const p1 = (await makePatient(s.a.centre.id)).patient;
    const p2 = (await makePatient(s.a.centre.id)).patient;
    const s1 = await sess(s.a, p1._id, 'completed', day);
    const s2 = await sess(s.a, p1._id, 'completed', `${month}-11`);
    const s3 = await sess(s.a, p2._id, 'completed', day, 1); // other chair: one live session per chair, shift and date
    const missed = await sess(s.a, p2._id, 'missed', `${month}-12`);
    await sess(s.a, p2._id, 'postponed', `${month}-13`);
    const other = await sess(s.a, p2._id, 'completed', `${addDays(day, 40).slice(0, 7)}-10`);
    await use(s1, s.heparin.id, 5);
    await use(s2, s.heparin.id, 3);
    await use(s3, s.saline.id, 2);
    await use(s1, s.gauze.id, 4);
    await use(missed, s.heparin.id, 100); // not completed: ignored
    await use(other, s.heparin.id, 100); // other month: ignored
    const res = await s.pm.agent.get(`/api/stats?month=${month}`);
    expect(res.status).toBe(200);
    expect(named(res.body, 'Alpha')).toEqual({
      centre: { id: s.a.centre.id, name: 'Alpha' },
      sessions: 3,
      patients: 2,
      medicines: [
        { item: { id: s.heparin.id, name: 'Heparin' }, unit: 'cc', total: 8 },
        { item: { id: s.saline.id, name: 'Saline' }, unit: 'cc', total: 2 },
      ],
      supplies: [{ item: { id: s.gauze.id, name: 'Gauze' }, unit: 'cc', total: 4 }],
    });
  });

  it('lists centres with no activity, including closed ones, with zeros', async () => {
    const s = await setup();
    s.b.centre.status = 'closed';
    await s.b.centre.save();
    const res = await s.pm.agent.get(`/api/stats?month=${month}`);
    expect(named(res.body, 'Beta')).toEqual({
      centre: { id: s.b.centre.id, name: 'Beta' },
      sessions: 0,
      patients: 0,
      medicines: [],
      supplies: [],
    });
  });

  it('usage edited after close changes the totals', async () => {
    const s = await setup();
    const nurse = await staffIn(s.a.centre.id, ['nurse']);
    const mgr = await staffIn(s.a.centre.id, ['centre_manager']);
    const p = (await makePatient(s.a.centre.id)).patient;
    const se = await sess(s.a, p._id, 'completed', day);
    const line = await use(se, s.heparin.id, 5);
    const url = `/api/centres/${s.a.centre.id}/stats?month=${month}`;
    expect((await mgr.agent.get(url)).body.medicines[0].total).toBe(5);
    const r = await nurse.agent.patch(`/api/centres/${s.a.centre.id}/sessions/${se.id}/usage/${line.id}`).send({ amount: 2 });
    expect(r.status).toBe(200);
    expect((await mgr.agent.get(url)).body.medicines[0].total).toBe(2);
  });

  it('after a merge the surviving item carries both totals', async () => {
    const s = await setup();
    const dup = await s.mk('Heparin B', 'medicine');
    const p = (await makePatient(s.a.centre.id)).patient;
    const se = await sess(s.a, p._id, 'completed', day);
    await use(se, s.heparin.id, 5);
    await use(se, dup.id, 7);
    expect((await s.pm.agent.post(`/api/catalog/items/${dup.id}/merge`).send({ intoId: s.heparin.id })).status).toBe(200);
    const res = await s.pm.agent.get(`/api/stats?month=${month}`);
    expect(named(res.body, 'Alpha')!).toMatchObject({
      medicines: [{ item: { id: s.heparin.id, name: 'Heparin' }, unit: 'cc', total: 12 }],
    });
  });

  it('resolves usage still pointing at a retired item through mergedInto', async () => {
    const s = await setup();
    const p = (await makePatient(s.a.centre.id)).patient;
    const se = await sess(s.a, p._id, 'completed', day);
    await use(se, s.saline.id, 3);
    await Item.updateOne({ _id: s.saline.id }, { $set: { status: 'retired', mergedInto: s.heparin.id } });
    const res = await s.pm.agent.get(`/api/stats?month=${month}`);
    expect(named(res.body, 'Alpha')!).toMatchObject({
      medicines: [{ item: { id: s.heparin.id, name: 'Heparin' }, unit: 'cc', total: 3 }],
    });
  });
});

describe('transfers and privacy', () => {
  it('old centre keeps counting its sessions after a transfer; no patient names in the response', async () => {
    const s = await setup();
    const desk = await staffIn(s.a.centre.id, ['front_desk']);
    const deskB = await staffIn(s.b.centre.id, ['front_desk']);
    const { patient } = await makePatient(s.a.centre.id, { name: 'Zainab Unique-Name' });
    const se = await sess(s.a, patient._id, 'completed', day);
    await use(se, s.heparin.id, 1);
    const baseA = `/api/centres/${s.a.centre.id}`;
    const t = await desk.agent.post(`${baseA}/patients/${patient.id}/transfer`).send({ toCentreId: s.b.centre.id });
    expect(t.status).toBe(201);
    expect((await deskB.agent.post(`/api/centres/${s.b.centre.id}/transfers/${t.body.id}/accept`)).status).toBe(200);
    const res = await s.pm.agent.get(`/api/stats?month=${month}`);
    expect(named(res.body, 'Alpha')).toMatchObject({ sessions: 1, patients: 1 });
    expect(named(res.body, 'Beta')).toMatchObject({ sessions: 0, patients: 0 });
    const json = JSON.stringify(res.body);
    expect(json).not.toContain('Zainab');
    expect(json).not.toContain(patient.id);
    const mgr = await staffIn(s.a.centre.id, ['centre_manager']);
    expect(JSON.stringify((await mgr.agent.get(`${baseA}/stats?month=${month}`)).body)).not.toContain('Zainab');
  });
});

describe('access and validation', () => {
  it('nurse gets 403 on /api/stats and on centre stats; manager of another centre gets 403', async () => {
    const s = await setup();
    const nurse = await staffIn(s.a.centre.id, ['nurse']);
    expect((await nurse.agent.get(`/api/stats?month=${month}`)).status).toBe(403);
    expect((await nurse.agent.get(`/api/centres/${s.a.centre.id}/stats?month=${month}`)).status).toBe(403);
    const mgrB = await staffIn(s.b.centre.id, ['centre_manager']);
    expect((await mgrB.agent.get(`/api/centres/${s.a.centre.id}/stats?month=${month}`)).status).toBe(403);
  });

  it('requires a YYYY-MM month', async () => {
    const s = await setup();
    const mgr = await staffIn(s.a.centre.id, ['centre_manager']);
    for (const q of ['', '?month=2026-13', '?month=2026-1', '?month=abc']) {
      const g = await s.pm.agent.get(`/api/stats${q}`);
      expect([g.status, g.body.error]).toEqual([400, 'validation']);
      const c = await mgr.agent.get(`/api/centres/${s.a.centre.id}/stats${q}`);
      expect([c.status, c.body.error]).toEqual([400, 'validation']);
    }
  });
});

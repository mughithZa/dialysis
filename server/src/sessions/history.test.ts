import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { seedRoles } from '../auth/roles.seed.js';
import { AuditEntry } from '../audit/audit.model.js';
import { Role } from '../auth/role.model.js';
import { Item } from '../catalog/item.model.js';
import { Unit } from '../catalog/unit.model.js';
import { todayLocal, weekdayOf } from '../lib/dates.js';
import { SessionChange } from './change.model.js';
import { Session } from './session.model.js';
import { UsageLine } from './usage.model.js';
import { ALL_DAYS, makeCentre, makePatient, programManager, staffIn } from '../../test/factories.js';

beforeAll(async () => {
  await Item.init();
  await Unit.init();
});
beforeEach(seedRoles);

async function setup() {
  const { centre, chairs, shifts } = await makeCentre({ workingDays: ALL_DAYS });
  const base = `/api/centres/${centre.id}`;
  const nurse = await staffIn(centre.id, ['nurse']);
  const desk = await staffIn(centre.id, ['front_desk']);
  const doctor = await staffIn(centre.id, ['doctor']);
  const pm = await programManager();
  const unit = (await pm.agent.post('/api/catalog/units').send({ name: 'cc' })).body as { id: string };
  const mk = async (name: string, type: string) => {
    const r = (await pm.agent.post('/api/catalog/items').send({ name, type, unitId: unit.id })).body as { id: string };
    await Item.updateOne({ _id: r.id }, { $set: { status: 'approved' } });
    return r;
  };
  const heparin = await mk('Heparin', 'medicine');
  const gauze = await mk('Gauze', 'supply');
  const { patient } = await makePatient(centre.id);
  const res = await desk.agent
    .post(`${base}/patients/${patient.id}/plan`)
    .send({ items: [{ weekday: weekdayOf(todayLocal()), chairId: chairs[0]!.id, shiftId: shifts[0]!.id }], from: todayLocal(), repeat: 'weekly' });
  expect(res.status).toBe(201);
  const session = (await Session.findOne({ patientId: patient.id, date: todayLocal() }))!;
  const s = `${base}/sessions/${session.id}`;
  await nurse.agent.post(`${s}/open`);
  return { s, session, nurse, desk, doctor, heparin, gauze };
}

describe('editing while active', () => {
  it('creates no history, and usage and notes can be edited and removed', async () => {
    const { s, nurse, heparin } = await setup();
    const line = await nurse.agent.post(`${s}/usage`).send({ itemId: heparin.id, amount: 5 });
    expect((await nurse.agent.patch(`${s}/usage/${line.body.id}`).send({ amount: 2 })).status).toBe(200);
    const note = await nurse.agent.post(`${s}/notes`).send({ text: 'a' });
    expect(note.body.id).toBeTruthy();
    expect((await nurse.agent.patch(`${s}/notes/${note.body.id}`).send({ text: 'b' })).status).toBe(200);
    expect((await nurse.agent.delete(`${s}/notes/${note.body.id}`)).status).toBe(204);
    expect((await nurse.agent.delete(`${s}/usage/${line.body.id}`)).status).toBe(204);
    await nurse.agent.patch(`${s}/vitals`).send({ weightBefore: 70 });
    expect(await SessionChange.countDocuments()).toBe(0);
    expect((await nurse.agent.get(`${s}/history`)).body).toEqual([]);
  });
});

describe('editing a closed session', () => {
  it('records usage update/remove/add with minimal before/after, newest first', async () => {
    const { s, session, nurse, doctor, heparin, gauze } = await setup();
    const line = await nurse.agent.post(`${s}/usage`).send({ itemId: heparin.id, amount: 5 });
    const other = await nurse.agent.post(`${s}/usage`).send({ itemId: gauze.id, amount: 3 });
    await nurse.agent.post(`${s}/close`);

    const upd = await nurse.agent.patch(`${s}/usage/${line.body.id}`).send({ amount: 1 });
    expect(upd.status).toBe(200);
    expect((await UsageLine.findById(line.body.id))!.amount).toBe(1);
    expect((await nurse.agent.delete(`${s}/usage/${other.body.id}`)).status).toBe(204);
    expect((await nurse.agent.post(`${s}/usage`).send({ itemId: gauze.id, amount: 2 })).status).toBe(201);

    const hist = await doctor.agent.get(`${s}/history`);
    expect(hist.status).toBe(200);
    expect(hist.body.map((h: { kind: string }) => h.kind)).toEqual(['usage.add', 'usage.remove', 'usage.update']);
    expect(hist.body[2]).toMatchObject({
      before: { itemId: heparin.id, itemName: 'Heparin', amount: 5 },
      after: { itemId: heparin.id, itemName: 'Heparin', amount: 1 },
      by: { id: nurse.user.id, name: nurse.user.name },
    });
    expect(hist.body[1]).toMatchObject({ before: { itemName: 'Gauze', amount: 3 }, after: null });
    expect(hist.body[0]).toMatchObject({ before: null, after: { itemName: 'Gauze', amount: 2 } });
    expect(await SessionChange.countDocuments({ sessionId: session.id })).toBe(3);
    expect(await AuditEntry.countDocuments({ action: 'usage.update' })).toBe(1);
  });

  it('records note add/update/remove and vitals changes', async () => {
    const { s, nurse } = await setup();
    await nurse.agent.patch(`${s}/vitals`).send({ weightBefore: 70, weightAfter: 68 });
    const note = await nurse.agent.post(`${s}/notes`).send({ text: 'first' });
    await nurse.agent.post(`${s}/close`);

    expect((await nurse.agent.patch(`${s}/vitals`).send({ weightAfter: 67 })).status).toBe(200);
    expect((await nurse.agent.post(`${s}/vitals/bp`).send({ systolic: 130, diastolic: 85 })).status).toBe(201);
    const added = await nurse.agent.post(`${s}/notes`).send({ text: 'late' });
    expect((await nurse.agent.patch(`${s}/notes/${note.body.id}`).send({ text: 'edited' })).status).toBe(200);
    expect((await nurse.agent.delete(`${s}/notes/${added.body.id}`)).status).toBe(204);
    expect((await nurse.agent.patch(`${s}/notes/64b000000000000000000000`).send({ text: 'x' })).status).toBe(404);

    const hist = (await nurse.agent.get(`${s}/history`)).body as { kind: string; before: unknown; after: unknown }[];
    expect(hist.map((h) => h.kind)).toEqual(['note.remove', 'note.update', 'note.add', 'vitals.update', 'vitals.update']);
    expect(hist[0]).toMatchObject({ before: { text: 'late' }, after: null });
    expect(hist[1]).toMatchObject({ before: { text: 'first' }, after: { text: 'edited' } });
    expect(hist[2]).toMatchObject({ before: null, after: { text: 'late' } });
    expect(hist[3]).toMatchObject({ before: null, after: { bp: { systolic: 130, diastolic: 85 } } });
    expect(hist[4]).toMatchObject({ before: { weightAfter: 68 }, after: { weightAfter: 67 } });
    expect(hist[4]!.before).not.toHaveProperty('weightBefore');
  });

  it('a doctor cannot edit (403) but can read history; front desk cannot read it', async () => {
    const { s, nurse, doctor, desk, heparin } = await setup();
    const line = await nurse.agent.post(`${s}/usage`).send({ itemId: heparin.id, amount: 5 });
    await nurse.agent.post(`${s}/close`);
    expect((await doctor.agent.patch(`${s}/usage/${line.body.id}`).send({ amount: 1 })).status).toBe(403);
    expect((await doctor.agent.get(`${s}/history`)).status).toBe(200);
    expect((await desk.agent.get(`${s}/history`)).status).toBe(403);
    expect(await SessionChange.countDocuments()).toBe(0);
  });

  it('a centre manager (editClosed, no recordUsage) can correct usage and notes on a completed session, with history; 403 while active', async () => {
    const { s, session, nurse, heparin } = await setup();
    const manager = await staffIn(session.centreId.toString(), ['centre_manager']);
    const line = await nurse.agent.post(`${s}/usage`).send({ itemId: heparin.id, amount: 5 });
    const note = await nurse.agent.post(`${s}/notes`).send({ text: 'a' });
    expect((await manager.agent.patch(`${s}/usage/${line.body.id}`).send({ amount: 2 })).status).toBe(403);
    expect((await manager.agent.post(`${s}/notes`).send({ text: 'x' })).status).toBe(403);
    await nurse.agent.post(`${s}/close`);
    expect((await manager.agent.patch(`${s}/usage/${line.body.id}`).send({ amount: 2 })).status).toBe(200);
    expect((await manager.agent.patch(`${s}/notes/${note.body.id}`).send({ text: 'b' })).status).toBe(200);
    expect((await manager.agent.patch(`${s}/vitals`).send({ weightBefore: 71 })).status).toBe(200);
    const hist = await manager.agent.get(`${s}/history`);
    expect(hist.body.map((c: { kind: string }) => c.kind).sort()).toEqual(['note.update', 'usage.update', 'vitals.update']);
  });

  it('a caller with the route permission but without editClosed gets 403', async () => {
    const { s, session, nurse, heparin } = await setup();
    await nurse.agent.post(`${s}/close`);
    const role = (await Role.findOne({ key: 'nurse' }))!;
    await Role.updateOne({ _id: role._id }, { $set: { permissions: role.permissions.filter((p) => p !== 'sessions.editClosed') } });
    const r = await nurse.agent.post(`${s}/usage`).send({ itemId: heparin.id, amount: 1 });
    expect(r.status).toBe(403);
    expect(await UsageLine.countDocuments({ sessionId: session.id })).toBe(0);
  });

  it('other statuses stay 409 bad_status', async () => {
    const { s, session, nurse, heparin } = await setup();
    await Session.updateOne({ _id: session._id }, { $set: { status: 'postponed' } });
    const r = await nurse.agent.post(`${s}/usage`).send({ itemId: heparin.id, amount: 1 });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('bad_status');
  });

  // Item.findById runs between the route's session load and the guarded transaction; the hook changes the status there.
  const changeStatusMidRequest = (sessionId: string, status: string) => {
    const orig = Item.findById.bind(Item);
    vi.spyOn(Item, 'findById').mockImplementationOnce(((id: string) => {
      const q = orig(id);
      return Session.updateOne({ _id: sessionId }, { $set: { status } }).then(() => q);
    }) as never);
  };

  it('a usage write racing a close goes through the closed-session rules (history written)', async () => {
    const { s, session, nurse, heparin } = await setup();
    changeStatusMidRequest(session.id, 'completed');
    const r = await nurse.agent.post(`${s}/usage`).send({ itemId: heparin.id, amount: 4 });
    vi.restoreAllMocks();
    expect(r.status).toBe(201);
    expect(await SessionChange.countDocuments({ kind: 'usage.add' })).toBe(1);
  });

  it('a usage write racing a postpone is rejected and writes nothing', async () => {
    const { s, session, nurse, heparin } = await setup();
    changeStatusMidRequest(session.id, 'postponed');
    const r = await nurse.agent.post(`${s}/usage`).send({ itemId: heparin.id, amount: 4 });
    vi.restoreAllMocks();
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('bad_status');
    expect(await UsageLine.countDocuments({ sessionId: session.id })).toBe(0);
  });
});

describe('audit entries', () => {
  it('status transitions and closed edits write their audit entries', async () => {
    const { s, nurse } = await setup();
    await nurse.agent.post(`${s}/close`);
    await nurse.agent.post(`${s}/notes`).send({ text: 'late' });
    expect(await AuditEntry.countDocuments({ action: 'session.open' })).toBe(1);
    expect(await AuditEntry.countDocuments({ action: 'session.close' })).toBe(1);
    expect(await AuditEntry.countDocuments({ action: 'note.add' })).toBe(1);
  });
});

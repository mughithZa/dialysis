import request from 'supertest';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { seedRoles } from '../auth/roles.seed.js';
import { Item } from '../catalog/item.model.js';
import { Unit } from '../catalog/unit.model.js';
import { Centre } from '../centres/centre.model.js';
import { addDays, todayLocal } from '../lib/dates.js';
import { Order } from '../orders/order.model.js';
import { Session } from '../sessions/session.model.js';
import { UsageLine } from '../sessions/usage.model.js';
import { getApp, login, makeCentre, makePatient, staffIn } from '../../test/factories.js';

beforeAll(async () => {
  await Item.init();
  await Unit.init();
});
beforeEach(seedRoles);

async function setup() {
  const { centre, chairs, shifts } = await makeCentre({ name: 'North' });
  const { patient, user } = await makePatient(centre.id, { name: 'Pat' });
  const agent = await login(user.username);
  const mk = (date: string, status: string, shift = 0) =>
    Session.create({ centreId: centre._id, patientId: patient._id, date, chairId: chairs[0]!._id, shiftId: shifts[shift]!._id, status });
  return { centre, chairs, shifts, patient, user, agent, mk };
}

describe('GET /api/me/overview', () => {
  it('lists upcoming scheduled sessions for 14 days, sorted, and the active one', async () => {
    const { agent, mk, centre } = await setup();
    const today = todayLocal();
    await mk(addDays(today, 14), 'scheduled');
    await mk(addDays(today, 13), 'scheduled');
    await mk(addDays(today, 2), 'scheduled', 1);
    await mk(addDays(today, 2), 'scheduled', 0);
    await mk(addDays(today, -1), 'scheduled');
    await mk(addDays(today, 1), 'completed');
    const none = await agent.get('/api/me/overview');
    expect(none.status).toBe(200);
    expect(none.body.patient).toEqual({ name: 'Pat' });
    expect(none.body.centre).toEqual({ name: 'North' });
    expect(none.body.active).toBeNull();
    expect(none.body.upcoming.map((s: { date: string; start: string }) => [s.date, s.start])).toEqual([
      [addDays(today, 2), '07:00'],
      [addDays(today, 2), '12:00'],
      [addDays(today, 13), '07:00'],
    ]);
    expect(none.body.upcoming[0]).toMatchObject({ end: '11:30', centreName: 'North', kind: 'regular', status: 'scheduled' });
    const act = await mk(addDays(today, -3), 'active');
    const got = await agent.get('/api/me/overview');
    expect(got.body.active).toMatchObject({ id: act.id, status: 'active', centreName: centre.name });
  });

  it('lets a discharged patient in with no upcoming sessions', async () => {
    const { agent, mk, patient } = await setup();
    await mk(addDays(todayLocal(), 1), 'scheduled');
    patient.status = 'discharged';
    await patient.save();
    const res = await agent.get('/api/me/overview');
    expect(res.status).toBe(200);
    expect(res.body.upcoming).toEqual([]);
  });
});

describe('GET /api/me/sessions', () => {
  it('returns own past sessions newest first with usage, paginated by before/limit', async () => {
    const { agent, mk, centre, patient } = await setup();
    const other = await makePatient(centre.id);
    const today = todayLocal();
    const s1 = await mk(addDays(today, -3), 'completed');
    await mk(addDays(today, -2), 'missed');
    await mk(addDays(today, -1), 'postponed');
    await mk(addDays(today, 1), 'scheduled');
    const staff = await staffIn(centre.id, ['nurse']);
    const unit = await Unit.create({ name: 'cc' });
    const item = await Item.create({ name: 'Heparin', type: 'medicine', unitId: unit._id, createdBy: staff.user._id, status: 'approved' });
    await UsageLine.create({ sessionId: s1._id, centreId: centre._id, patientId: patient._id, date: s1.date, itemId: item._id, amount: 5, by: staff.user._id });
    await Session.create({ centreId: centre._id, patientId: other.patient._id, date: addDays(today, -4), chairId: s1.chairId, shiftId: s1.shiftId, status: 'completed' });

    const res = await agent.get('/api/me/sessions');
    expect(res.status).toBe(200);
    expect(res.body.map((s: { date: string }) => s.date)).toEqual([addDays(today, -1), addDays(today, -2), addDays(today, -3)]);
    expect(res.body[2].usage).toEqual([{ name: 'Heparin', amount: 5, unit: 'cc' }]);
    expect(res.body[2]).toMatchObject({ id: s1.id, centreName: 'North', start: '07:00', end: '11:30', status: 'completed' });

    const page = await agent.get(`/api/me/sessions?limit=1&before=${addDays(today, -1)}`);
    expect(page.body.map((s: { date: string }) => s.date)).toEqual([addDays(today, -2)]);
    for (const q of ['limit=0', 'limit=51', 'before=nope']) expect((await agent.get(`/api/me/sessions?${q}`)).status).toBe(400);
  });

  it('shows medicines used in an active session', async () => {
    const { agent, mk, centre, patient } = await setup();
    const s = await mk(todayLocal(), 'active');
    const staff = await staffIn(centre.id, ['nurse']);
    const unit = await Unit.create({ name: 'mg' });
    const item = await Item.create({ name: 'EPO', type: 'medicine', unitId: unit._id, createdBy: staff.user._id, status: 'approved' });
    await UsageLine.create({ sessionId: s._id, centreId: centre._id, patientId: patient._id, date: s.date, itemId: item._id, amount: 2, by: staff.user._id });
    const res = await agent.get('/api/me/sessions');
    expect(res.body[0].usage).toEqual([{ name: 'EPO', amount: 2, unit: 'mg' }]);
  });

  it('omits notes and orders when the setting is off and includes them (without staff ids) when on', async () => {
    const { agent, mk, centre, patient } = await setup();
    const staff = await staffIn(centre.id, ['doctor']);
    const today = todayLocal();
    const s = await mk(addDays(today, -1), 'completed');
    s.notes.push({ at: new Date(), by: staff.user._id, text: 'felt dizzy' } as never);
    await s.save();
    await Order.create({ patientId: patient._id, centreId: centre._id, doctorId: staff.user._id, text: 'no heparin', from: addDays(today, -5) });
    await Order.create({ patientId: patient._id, centreId: centre._id, doctorId: staff.user._id, text: 'future', from: today });

    const off = await agent.get('/api/me/sessions');
    expect(off.body[0]).not.toHaveProperty('notes');
    expect(off.body[0]).not.toHaveProperty('orders');

    await Centre.updateOne({ _id: centre._id }, { $set: { 'settings.patientsSeeNotes': true } });
    const on = await agent.get('/api/me/sessions');
    expect(on.body[0].notes).toEqual([{ at: expect.any(String), text: 'felt dizzy' }]);
    expect(on.body[0].orders).toEqual([{ text: 'no heparin', from: addDays(today, -5) }]);
  });

  it('is patient-only and scoped to the caller', async () => {
    const { centre } = await setup();
    const staff = await staffIn(centre.id, ['nurse']);
    expect((await staff.agent.get('/api/me/overview')).status).toBe(403);
    expect((await staff.agent.get('/api/me/sessions')).status).toBe(403);
    const { user } = await makePatient(centre.id);
    const a = await login(user.username);
    expect((await a.get('/api/me/sessions')).body).toEqual([]);
    expect((await a.get(`/api/centres/${centre.id}/patients`)).status).toBe(403);
    expect((await request(getApp()).get('/api/me/overview')).status).toBe(401);
  });
});

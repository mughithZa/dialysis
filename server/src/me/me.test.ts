import request from 'supertest';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { seedRoles } from '../auth/roles.seed.js';
import { Item } from '../catalog/item.model.js';
import { Unit } from '../catalog/unit.model.js';
import { addDays, todayLocal } from '../lib/dates.js';
import { getApp, login, makeCentre, makePatient, staffIn, makeSession } from '../../test/factories.js';

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
    makeSession({ centreId: centre._id, patientId: patient._id, date, chairId: chairs[0]!._id, shiftId: shifts[shift]!._id, status });
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

  it('uses the session snapshots (block times), not the live setup', async () => {
    const { agent, centre, chairs, shifts, patient } = await setup();
    const today = todayLocal();
    await makeSession({ centreId: centre._id, patientId: patient._id, date: addDays(today, 1), chairId: chairs[0]!._id, shiftId: shifts[0]!._id, status: 'scheduled', shiftStart: '06:15', shiftEnd: '10:15' });
    await makeSession({ centreId: centre._id, patientId: patient._id, date: today, chairId: chairs[0]!._id, shiftId: shifts[1]!._id, status: 'active', shiftStart: '12:30', shiftEnd: '16:45' });
    const res = await agent.get('/api/me/overview');
    expect(res.body.upcoming[0]).toMatchObject({ start: '06:15', end: '10:15' });
    expect(res.body.active).toMatchObject({ start: '12:30', end: '16:45' });
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

describe('patient-only access', () => {
  it('is patient-only and scoped to the caller', async () => {
    const { centre } = await setup();
    const staff = await staffIn(centre.id, ['nurse']);
    expect((await staff.agent.get('/api/me/overview')).status).toBe(403);
    expect((await staff.agent.get('/api/me/timeline')).status).toBe(403);
    const { user } = await makePatient(centre.id);
    const a = await login(user.username);
    expect((await a.get('/api/me/timeline')).body).toMatchObject({ upcoming: [], today: [], past: [] });
    expect((await a.get(`/api/centres/${centre.id}/patients`)).status).toBe(403);
    expect((await request(getApp()).get('/api/me/overview')).status).toBe(401);
  });
});

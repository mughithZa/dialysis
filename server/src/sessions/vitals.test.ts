import { describe, it, expect, beforeEach } from 'vitest';
import { seedRoles } from '../auth/roles.seed.js';
import { addDays, localDateTime, todayLocal } from '../lib/dates.js';
import { makeCentre, makePatient, makeSession, staffIn } from '../../test/factories.js';

beforeEach(seedRoles);

async function setup() {
  const { centre, chairs, shifts } = await makeCentre({ name: 'North' });
  const { patient } = await makePatient(centre.id);
  const doctor = await staffIn(centre.id, ['doctor']);
  const today = todayLocal();
  const mk = (date: string, status: string, extra: object = {}) =>
    makeSession({ centreId: centre._id, patientId: patient._id, date, chairId: chairs[0]!._id, shiftId: shifts[0]!._id, status, ...extra });
  const bp = (date: string, time: string, systolic: number, diastolic: number) => ({ at: localDateTime(date, time), systolic, diastolic });
  return { centre, patient, doctor, today, mk, bp, url: `/api/centres/${centre.id}/patients/${patient.id}/vitals` };
}

describe('GET patients/:id/vitals', () => {
  it('returns per-session weights, weight loss and average BP, oldest first, only sessions with vitals', async () => {
    const { doctor, mk, bp, today, url } = await setup();
    const d1 = addDays(today, -4);
    const d2 = addDays(today, -2);
    await mk(d1, 'completed', { vitals: { weightBefore: 72.5, weightAfter: 70, bp: [bp(d1, '07:10', 140, 90), bp(d1, '09:00', 120, 81)] } });
    await mk(d2, 'completed', { vitals: { weightBefore: 71, bp: [] } });
    await mk(addDays(today, -3), 'completed'); // no vitals: left out
    await mk(addDays(today, -1), 'did_not_come');
    await mk(addDays(today, 2), 'scheduled');
    const res = await doctor.agent.get(url);
    expect(res.status).toBe(200);
    expect(res.body.points).toEqual([
      { sessionId: expect.any(String), date: d1, centreName: 'North', weightBefore: 72.5, weightAfter: 70, weightLoss: 2.5, systolic: 130, diastolic: 86, bpCount: 2 },
      { sessionId: expect.any(String), date: d2, centreName: 'North', weightBefore: 71, weightAfter: null, weightLoss: null, systolic: null, diastolic: null, bpCount: 0 },
    ]);
  });

  it('limits to the newest sessions and validates the limit', async () => {
    const { doctor, mk, today, url } = await setup();
    for (const n of [1, 2, 3, 4]) await mk(addDays(today, -n), 'completed', { vitals: { weightBefore: 70 + n, bp: [] } });
    const res = await doctor.agent.get(`${url}?limit=2`);
    expect(res.body.points.map((p: { date: string }) => p.date)).toEqual([addDays(today, -2), addDays(today, -1)]);
    expect((await doctor.agent.get(`${url}?limit=0`)).status).toBe(400);
    expect((await doctor.agent.get(`${url}?limit=101`)).status).toBe(400);
  });

  it('includes old-centre sessions after a transfer; the old centre gets 404', async () => {
    const { doctor, patient, mk, today, url } = await setup();
    const other = await makeCentre({ name: 'South' });
    await mk(addDays(today, -5), 'completed', { vitals: { weightBefore: 70, weightAfter: 68, bp: [] } });
    patient.centreId = other.centre._id;
    await patient.save();
    await makeSession({
      centreId: other.centre._id, patientId: patient._id, date: addDays(today, -1), chairId: other.chairs[0]!._id,
      shiftId: other.shifts[0]!._id, status: 'completed', vitals: { weightBefore: 69, weightAfter: 67 } as never,
    });
    const south = await staffIn(other.centre.id, ['doctor']);
    const res = await south.agent.get(`/api/centres/${other.centre.id}/patients/${patient.id}/vitals`);
    expect(res.body.points.map((p: { centreName: string }) => p.centreName)).toEqual(['North', 'South']);
    expect((await doctor.agent.get(url)).status).toBe(404);
  });

  it('is 404 for a patient of another centre and 403 for non-members', async () => {
    const { url, centre } = await setup();
    const other = await makeCentre({ name: 'East' });
    const { patient: stranger } = await makePatient(other.centre.id);
    const doctor = await staffIn(centre.id, ['doctor']);
    expect((await doctor.agent.get(`/api/centres/${centre.id}/patients/${stranger.id}/vitals`)).status).toBe(404);
    const manager = await staffIn(centre.id, ['centre_manager']);
    expect((await manager.agent.get(url)).status).toBe(200);
    const outsider = await staffIn(other.centre.id, ['doctor']);
    expect((await outsider.agent.get(url)).status).toBe(403);
  });
});

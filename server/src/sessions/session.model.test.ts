import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { seedRoles } from '../auth/roles.seed.js';
import { todayLocal } from '../lib/dates.js';
import { Session, FINAL_STATUSES } from './session.model.js';
import { makeCentre, makePatient, makeSession, staffIn } from '../../test/factories.js';

beforeAll(async () => {
  await Session.init();
});
beforeEach(seedRoles);

async function two() {
  const { centre, chairs, shifts } = await makeCentre();
  const a = await makePatient(centre.id);
  const b = await makePatient(centre.id);
  const base = { centreId: centre.id, chairId: chairs[0]!.id, shiftId: shifts[0]!.id, date: '2026-10-20' };
  return { centre, chairs, shifts, a, b, base };
}

describe('Session chair/shift/date guard', () => {
  it('rejects a second live session on the same chair, shift and date', async () => {
    const { a, b, base } = await two();
    await makeSession({ ...base, patientId: a.patient.id, status: 'scheduled' });
    await expect(makeSession({ ...base, patientId: b.patient.id, status: 'scheduled' })).rejects.toMatchObject({ code: 11000 });
  });

  it('allows it once the first is postponed', async () => {
    const { a, b, base } = await two();
    await makeSession({ ...base, patientId: a.patient.id, status: 'postponed' });
    await makeSession({ ...base, patientId: b.patient.id, status: 'scheduled' });
    expect(await Session.countDocuments()).toBe(2);
  });

  it('accepts did_not_come and cancelled and lists them as final', async () => {
    const { a, b, base } = await two();
    const x = await makeSession({ ...base, patientId: a.patient.id, status: 'did_not_come' });
    const y = await makeSession({ ...base, patientId: b.patient.id, status: 'cancelled' });
    expect(x.status).toBe('did_not_come');
    expect(y.status).toBe('cancelled');
    expect(x.detached).toBe(false);
    expect([...FINAL_STATUSES]).toEqual(['completed', 'postponed', 'missed', 'did_not_come', 'cancelled']);
  });

  it('snapshots are required', async () => {
    const { a, base } = await two();
    await expect(Session.create({ ...base, patientId: a.patient.id })).rejects.toThrow(/shiftStart|chairLabel|shiftEnd/);
  });
});

describe('opening a session', () => {
  it('sets runBy to the opener', async () => {
    const { centre, chairs, shifts, a } = await two();
    const nurse = await staffIn(centre.id, ['nurse']);
    const s = await makeSession({
      centreId: centre.id, patientId: a.patient.id, chairId: chairs[0]!.id, shiftId: shifts[0]!.id, date: todayLocal(),
    });
    const res = await nurse.agent.post(`/api/centres/${centre.id}/sessions/${s.id}/open`);
    expect(res.status).toBe(200);
    const fresh = await Session.findById(s.id);
    expect(String(fresh!.runBy)).toBe(String(nurse.user._id));
    expect(String(fresh!.openedBy)).toBe(String(nurse.user._id));
    expect(res.body.runBy).toEqual({ id: String(nurse.user._id), name: nurse.user.name });
    expect(res.body.nurse).toBeNull();
    expect(res.body.start).toBe('07:00');
    expect(res.body.chairLabel).toBe('1');
  });
});

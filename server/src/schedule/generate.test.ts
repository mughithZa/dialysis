import { describe, it, expect, beforeEach } from 'vitest';
import { seedRoles } from '../auth/roles.seed.js';
import { Pattern } from './pattern.model.js';
import { Session } from '../sessions/session.model.js';
import { regenerateSessions } from './generate.js';
import { generateAll } from '../notify/jobs.js';
import { addDays, todayLocal, weekdayOf } from '../lib/dates.js';
import { makeCentre, makePatient, staffIn } from '../../test/factories.js';

beforeEach(seedRoles);

const TODAY = '2026-10-17'; // a Saturday

async function openPattern(weekdays = [6, 1, 3], from = TODAY) {
  const { centre, chairs, shifts } = await makeCentre();
  const { patient } = await makePatient(centre.id);
  await Pattern.create({
    centreId: centre.id,
    patientId: patient.id,
    chairId: chairs[0]!.id,
    shiftId: shifts[0]!.id,
    weekdays,
    from,
  });
  return { centre, chairs, shifts, patient };
}

describe('regenerateSessions', () => {
  it('Sat/Mon/Wed from Saturday gives 6 scheduled sessions in 14 days, on those weekdays', async () => {
    const { patient, chairs } = await openPattern();
    await regenerateSessions(patient.id, TODAY);
    const sessions = await Session.find({ patientId: patient.id }).sort({ date: 1 });
    expect(sessions.map((s) => s.date)).toEqual([
      '2026-10-17', '2026-10-19', '2026-10-21', '2026-10-24', '2026-10-26', '2026-10-28',
    ]);
    expect(sessions.every((s) => [6, 1, 3].includes(weekdayOf(s.date)))).toBe(true);
    expect(sessions.every((s) => s.status === 'scheduled' && s.kind === 'regular')).toBe(true);
    expect(String(sessions[0]!.chairId)).toBe(chairs[0]!.id);
  });

  it('is idempotent', async () => {
    const { patient } = await openPattern();
    await regenerateSessions(patient.id, TODAY);
    await regenerateSessions(patient.id, TODAY);
    expect(await Session.countDocuments()).toBe(6);
  });

  it('starts at pattern.from when it is later than today', async () => {
    const { patient } = await openPattern([1], '2026-10-26');
    await regenerateSessions(patient.id, TODAY);
    expect((await Session.find().sort({ date: 1 })).map((s) => s.date)).toEqual(['2026-10-26']);
  });

  it('never touches non-scheduled sessions', async () => {
    const { patient, centre, chairs, shifts } = await openPattern();
    await Session.create({
      centreId: centre.id, patientId: patient.id, chairId: chairs[1]!.id, shiftId: shifts[0]!.id,
      date: '2026-10-19', kind: 'regular', status: 'completed',
    });
    await regenerateSessions(patient.id, TODAY);
    expect(await Session.countDocuments()).toBe(6);
    const done = await Session.findOne({ date: '2026-10-19' });
    expect(done!.status).toBe('completed');
    expect(String(done!.chairId)).toBe(chairs[1]!.id);
  });

  it('generateAll covers every open pattern', async () => {
    await openPattern([6]);
    await openPattern([1]);
    await generateAll(TODAY);
    // Sat 17, Sat 24 and Mon 19, Mon 26
    expect(await Session.countDocuments()).toBe(4);
  });
});

describe('pattern change regenerates', () => {
  it('future scheduled sessions follow the new pattern; past and completed stay', async () => {
    const { centre, chairs, shifts } = await makeCentre();
    const { agent } = await staffIn(centre.id, ['front_desk']);
    const { patient } = await makePatient(centre.id);
    const base = `/api/centres/${centre.id}/patients/${patient.id}/pattern`;
    const today = todayLocal();
    const body = { chairId: chairs[0]!.id, shiftId: shifts[0]!.id, weekdays: [0, 1, 2], from: today };
    expect((await agent.post(base).send(body)).status).toBe(201);
    const start = addDays(today, 7);
    const all = await Session.find({ patientId: patient.id }).sort({ date: 1 });
    const keep = all.find((s) => s.date >= start)!;
    keep.status = 'completed';
    await keep.save();
    const before = await Session.countDocuments({ patientId: patient.id, date: { $lt: start } });
    expect(before).toBeGreaterThan(0);

    const res = await agent.put(base).send({ ...body, shiftId: shifts[1]!.id, weekdays: [4], from: start });
    expect(res.status).toBe(200);

    const sched = await Session.find({ patientId: patient.id, status: 'scheduled', date: { $gte: start } });
    expect(sched.length).toBeGreaterThan(0);
    expect(sched.every((s) => weekdayOf(s.date) === 4 && String(s.shiftId) === shifts[1]!.id)).toBe(true);
    expect(await Session.countDocuments({ patientId: patient.id, date: { $lt: start } })).toBe(before);
    expect((await Session.findById(keep._id))!.status).toBe('completed');
  });
});

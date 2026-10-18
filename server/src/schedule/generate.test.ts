import { describe, it, expect, beforeEach, vi } from 'vitest';
import { seedRoles } from '../auth/roles.seed.js';
import { Centre } from '../centres/centre.model.js';
import { Chair } from '../centres/chair.model.js';
import { Shift } from '../centres/shift.model.js';
import { Plan } from './plan.model.js';
import { Session } from '../sessions/session.model.js';
import { regenerateSessions, refreshFutureSessions } from './generate.js';
import { generateAll } from '../notify/jobs.js';
import { addDays, todayLocal, weekdayOf } from '../lib/dates.js';
import { makeCentre, makePatient, staffIn, makeSession } from '../../test/factories.js';

beforeEach(seedRoles);

const TODAY = '2026-10-17'; // a Saturday

async function openPlan(weekdays = [6, 1, 3], from = TODAY, to: string | null = null) {
  const { centre, chairs, shifts } = await makeCentre();
  const { patient } = await makePatient(centre.id);
  const plan = await Plan.create({
    centreId: centre.id,
    patientId: patient.id,
    items: weekdays.map((weekday) => ({ weekday, shiftId: shifts[0]!.id, chairId: chairs[0]!.id })),
    from,
    to,
  });
  return { centre, chairs, shifts, patient, plan };
}

describe('regenerateSessions', () => {
  it('Sat/Mon/Wed from Saturday gives 6 scheduled sessions in 14 days, on those weekdays', async () => {
    const { patient, chairs } = await openPlan();
    await regenerateSessions(patient.id, TODAY);
    const sessions = await Session.find({ patientId: patient.id }).sort({ date: 1 });
    expect(sessions.map((s) => s.date)).toEqual([
      '2026-10-17', '2026-10-19', '2026-10-21', '2026-10-24', '2026-10-26', '2026-10-28',
    ]);
    expect(sessions.every((s) => [6, 1, 3].includes(weekdayOf(s.date)))).toBe(true);
    expect(sessions.every((s) => s.status === 'scheduled' && s.kind === 'regular')).toBe(true);
    expect(String(sessions[0]!.chairId)).toBe(chairs[0]!.id);
  });

  it('stamps planId and the block/machine snapshots; each item uses its own block and machine', async () => {
    const { centre, chairs, shifts } = await makeCentre();
    const { patient } = await makePatient(centre.id);
    const plan = await Plan.create({
      centreId: centre.id,
      patientId: patient.id,
      items: [
        { weekday: 1, shiftId: shifts[1]!.id, chairId: chairs[2]!.id },
        { weekday: 3, shiftId: shifts[0]!.id, chairId: chairs[3]!.id },
      ],
      from: TODAY,
    });
    await regenerateSessions(patient.id, TODAY);
    const sessions = await Session.find({ patientId: patient.id }).sort({ date: 1 });
    expect(sessions.map((s) => [s.date, String(s.shiftId), String(s.chairId), s.chairLabel, s.shiftStart, s.shiftEnd])).toEqual([
      ['2026-10-19', shifts[1]!.id, chairs[2]!.id, '3', '12:00', '16:30'],
      ['2026-10-21', shifts[0]!.id, chairs[3]!.id, '4', '07:00', '11:30'],
      ['2026-10-26', shifts[1]!.id, chairs[2]!.id, '3', '12:00', '16:30'],
      ['2026-10-28', shifts[0]!.id, chairs[3]!.id, '4', '07:00', '11:30'],
    ]);
    expect(sessions.every((s) => String(s.planId) === plan.id)).toBe(true);
  });

  it('skips days the centre does not work and stops at the plan end', async () => {
    const { patient, centre } = await openPlan([6, 1, 3], TODAY, '2026-10-26');
    await Centre.updateOne({ _id: centre._id }, { $set: { workingDays: [0, 2, 3, 4, 6] } }); // Monday off
    await regenerateSessions(patient.id, TODAY);
    expect((await Session.find().sort({ date: 1 })).map((s) => s.date)).toEqual(['2026-10-17', '2026-10-21', '2026-10-24']);
  });

  it('generates from an end-dated plan and the plan that follows it', async () => {
    const { patient, centre, chairs, shifts } = await openPlan([6], TODAY, '2026-10-23');
    await Plan.create({
      centreId: centre.id,
      patientId: patient.id,
      items: [{ weekday: 1, shiftId: shifts[0]!.id, chairId: chairs[0]!.id }],
      from: '2026-10-24',
    });
    await regenerateSessions(patient.id, TODAY);
    expect((await Session.find().sort({ date: 1 })).map((s) => s.date)).toEqual(['2026-10-17', '2026-10-26']);
  });

  it('does not recreate a plan session that was moved away (detached)', async () => {
    const { patient, chairs, shifts } = await openPlan([1]);
    await regenerateSessions(patient.id, TODAY);
    // Mon 19 moved to Tue 20 afternoon
    await Session.updateOne(
      { patientId: patient.id, date: '2026-10-19' },
      {
        $set: {
          date: '2026-10-20', shiftId: shifts[1]!._id, detached: true,
          movedFrom: { date: '2026-10-19', shiftId: shifts[0]!._id, chairId: chairs[0]!._id },
        },
      },
    );
    await regenerateSessions(patient.id, TODAY);
    expect((await Session.find().sort({ date: 1 })).map((s) => s.date)).toEqual(['2026-10-20', '2026-10-26']);
  });

  it('is idempotent', async () => {
    const { patient } = await openPlan();
    await regenerateSessions(patient.id, TODAY);
    await regenerateSessions(patient.id, TODAY);
    expect(await Session.countDocuments()).toBe(6);
  });

  it('starts at plan.from when it is later than today', async () => {
    const { patient } = await openPlan([1], '2026-10-26');
    await regenerateSessions(patient.id, TODAY);
    expect((await Session.find().sort({ date: 1 })).map((s) => s.date)).toEqual(['2026-10-26']);
  });

  it('never touches non-scheduled sessions', async () => {
    const { patient, centre, chairs, shifts } = await openPlan();
    await makeSession({
      centreId: centre.id, patientId: patient.id, chairId: chairs[1]!.id, shiftId: shifts[0]!.id,
      date: '2026-10-19', kind: 'regular', status: 'completed',
    });
    await regenerateSessions(patient.id, TODAY);
    expect(await Session.countDocuments()).toBe(6);
    const done = await Session.findOne({ date: '2026-10-19' });
    expect(done!.status).toBe('completed');
    expect(String(done!.chairId)).toBe(chairs[1]!.id);
  });

  it('generateAll covers every open plan', async () => {
    await openPlan([6]);
    await openPlan([1]);
    await generateAll(TODAY);
    // Sat 17, Sat 24 and Mon 19, Mon 26
    expect(await Session.countDocuments()).toBe(4);
  });
});

describe('plan change regenerates', () => {
  it('future scheduled sessions follow the new plan; past and completed stay', async () => {
    const { centre, chairs, shifts } = await makeCentre();
    const { agent } = await staffIn(centre.id, ['front_desk']);
    const { patient } = await makePatient(centre.id);
    const base = `/api/centres/${centre.id}/patients/${patient.id}/plan`;
    const today = todayLocal();
    const item = (weekday: number, shift = 0) => ({ weekday, shiftId: shifts[shift]!.id, chairId: chairs[0]!.id });
    const body = { items: [item(0), item(1), item(2)], from: today, repeat: 'weekly' };
    expect((await agent.post(base).send(body)).status).toBe(201);
    const start = addDays(today, 7);
    const all = await Session.find({ patientId: patient.id }).sort({ date: 1 });
    const keep = all.find((s) => s.date >= start)!;
    keep.status = 'completed';
    await keep.save();
    const before = await Session.countDocuments({ patientId: patient.id, date: { $lt: start } });
    expect(before).toBeGreaterThan(0);

    const res = await agent.put(base).send({ items: [item(4, 1)], from: start });
    expect(res.status).toBe(200);

    const sched = await Session.find({ patientId: patient.id, status: 'scheduled', date: { $gte: start } });
    expect(sched.length).toBeGreaterThan(0);
    expect(sched.every((s) => weekdayOf(s.date) === 4 && String(s.shiftId) === shifts[1]!.id)).toBe(true);
    expect(await Session.countDocuments({ patientId: patient.id, date: { $lt: start } })).toBe(before);
    expect((await Session.findById(keep._id))!.status).toBe('completed');
  });
});

describe('chair-date guard', () => {
  it('warns once per run when another patient holds the chair, and still creates the rest', async () => {
    const { centre, chairs, shifts, patient } = await openPlan([1]);
    const other = await makePatient(centre.id);
    await makeSession({
      centreId: centre.id, patientId: other.patient.id, chairId: chairs[0]!.id, shiftId: shifts[0]!.id,
      date: '2026-10-19', kind: 'makeup', status: 'scheduled',
    });
    await makeSession({
      centreId: centre.id, patientId: other.patient.id, chairId: chairs[0]!.id, shiftId: shifts[0]!.id,
      date: '2026-10-26', kind: 'makeup', status: 'scheduled',
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await regenerateSessions(patient.id, TODAY);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(await Session.countDocuments({ patientId: patient.id })).toBe(0);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('refreshFutureSessions', () => {
  it('updates snapshots of future scheduled sessions only', async () => {
    const { centre, shifts, patient } = await openPlan([6, 1]);
    await regenerateSessions(patient.id, TODAY);
    await Session.updateOne({ patientId: patient.id, date: '2026-10-17' }, { $set: { status: 'completed' } });
    await Shift.updateOne({ _id: shifts[0]!._id }, { $set: { start: '08:00', end: '12:30' } });
    await refreshFutureSessions(centre.id, '2026-10-18');
    const byDate = Object.fromEntries((await Session.find({ patientId: patient.id })).map((s) => [s.date, s]));
    expect(byDate['2026-10-17']!.shiftStart).toBe('07:00');
    expect(byDate['2026-10-19']!.shiftStart).toBe('08:00');
    expect(byDate['2026-10-19']!.shiftEnd).toBe('12:30');
    expect(byDate['2026-10-24']!.shiftStart).toBe('08:00');
  });

  it('updates the machine label and leaves past scheduled and non-scheduled sessions alone', async () => {
    const { centre, chairs, patient } = await openPlan([1]);
    await regenerateSessions(patient.id, TODAY);
    await Chair.updateOne({ _id: chairs[0]!._id }, { $set: { label: 'A1' } });
    await refreshFutureSessions(centre.id, '2026-10-20'); // Mon 19 is in the past
    const s19 = await Session.findOne({ date: '2026-10-19' });
    const s26 = await Session.findOne({ date: '2026-10-26' });
    expect(s19!.chairLabel).toBe('1');
    expect(s26!.chairLabel).toBe('A1');
  });

  it('deletes future scheduled sessions on non-working days and inactive blocks, keeps others', async () => {
    const { centre, chairs, shifts, patient } = await openPlan([1, 3]);
    await regenerateSessions(patient.id, TODAY);
    const completed = await makeSession({
      centreId: centre.id, patientId: (await makePatient(centre.id)).patient.id, chairId: chairs[1]!.id,
      shiftId: shifts[0]!.id, date: '2026-10-28', kind: 'regular', status: 'completed',
    });
    await Centre.updateOne({ _id: centre._id }, { $set: { workingDays: [0, 1, 2, 4, 6] } }); // Wed off
    await refreshFutureSessions(centre.id, TODAY);
    expect((await Session.find({ patientId: patient.id }).sort({ date: 1 })).map((s) => s.date)).toEqual(['2026-10-19', '2026-10-26']);
    expect(await Session.exists({ _id: completed._id })).toBeTruthy();

    await Shift.updateOne({ _id: shifts[0]!._id }, { $set: { active: false } });
    await refreshFutureSessions(centre.id, TODAY);
    expect(await Session.countDocuments({ patientId: patient.id })).toBe(0);
  });

  it('regenerates for the centre patients after a working-day change', async () => {
    const { centre, patient } = await openPlan([3]);
    await Centre.updateOne({ _id: centre._id }, { $set: { workingDays: [0, 1, 2, 4, 6] } });
    await refreshFutureSessions(centre.id, TODAY);
    expect(await Session.countDocuments({ patientId: patient.id })).toBe(0);
    await Centre.updateOne({ _id: centre._id }, { $set: { workingDays: [0, 1, 2, 3, 4, 6] } });
    await refreshFutureSessions(centre.id, TODAY);
    expect(await Session.countDocuments({ patientId: patient.id })).toBe(2);
  });
});

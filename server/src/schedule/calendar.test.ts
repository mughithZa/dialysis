import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { seedRoles } from '../auth/roles.seed.js';
import { Session } from '../sessions/session.model.js';
import { addDays, todayLocal, weekdayOf } from '../lib/dates.js';
import { makeCentre, makePatient, makeSession, staffIn } from '../../test/factories.js';
import { Plan } from './plan.model.js';
import { RosterEntry } from './roster.model.js';

beforeAll(async () => {
  await Promise.all([Session.init(), Plan.init()]);
});
beforeEach(seedRoles);

function nextWeekday(date: string, weekday: number): string {
  let d = date;
  while (weekdayOf(d) !== weekday) d = addDays(d, 1);
  return d;
}

async function setup() {
  const { centre, chairs, shifts } = await makeCentre({ chairs: 3 });
  const desk = await staffIn(centre.id, ['front_desk']);
  const nurse = await staffIn(centre.id, ['nurse']);
  const monday = nextWeekday(addDays(todayLocal(), 7), 1);
  return { centre, chairs, shifts, desk, nurse, monday, base: `/api/centres/${centre.id}/schedule/calendar` };
}

describe('GET /schedule/calendar', () => {
  it('returns sessions, plan holds, nurses and working flags per day and block', async () => {
    const { centre, chairs, shifts, desk, nurse, monday, base } = await setup();
    const a = await makePatient(centre.id, { name: 'Ahmad' });
    const b = await makePatient(centre.id, { name: 'Bassam' });
    await makeSession({ centreId: centre.id, patientId: a.patient.id, chairId: chairs[0]!.id, shiftId: shifts[0]!.id, date: monday });
    await Plan.create({
      centreId: centre.id,
      patientId: b.patient.id,
      items: [{ weekday: 1, shiftId: shifts[0]!.id, chairId: chairs[1]!.id }],
      from: monday,
      to: null,
    });
    await RosterEntry.create({ centreId: centre.id, nurseId: nurse.user.id, shiftId: shifts[0]!.id, from: monday, to: monday, chairIds: [chairs[0]!.id] });

    const fri = addDays(monday, 4);
    const res = await desk.agent.get(`${base}?from=${monday}&to=${fri}`);
    expect(res.status).toBe(200);
    expect(res.body.days).toHaveLength(5);
    const day = res.body.days[0];
    expect(day).toMatchObject({ date: monday, working: true });
    const blk = day.blocks[0];
    expect(blk.shiftId).toBe(shifts[0]!.id);
    expect(blk.nurseByChair[chairs[0]!.id]).toMatchObject({ id: nurse.user.id });
    expect(blk.nurseByChair[chairs[1]!.id]).toBeNull();
    const cell = (i: number) => blk.cells.find((c: { chairId: string }) => c.chairId === chairs[i]!.id);
    expect(cell(0).session).toMatchObject({ patient: { name: 'Ahmad' }, status: 'scheduled' });
    expect(cell(0).heldBy).toBeNull();
    expect(cell(1)).toMatchObject({ session: null, heldBy: { patientId: b.patient.id, name: 'Bassam' } });
    expect(cell(2)).toMatchObject({ session: null, heldBy: null });
    // Friday is the default day off
    expect(res.body.days[4]).toMatchObject({ date: fri, working: false, blocks: [] });
  });

  it('a postponed session releases its plan hold for that date', async () => {
    const { centre, chairs, shifts, desk, monday, base } = await setup();
    const b = await makePatient(centre.id, { name: 'Bassam' });
    await Plan.create({ centreId: centre.id, patientId: b.patient.id, items: [{ weekday: 1, shiftId: shifts[0]!.id, chairId: chairs[1]!.id }], from: monday, to: null });
    await makeSession({ centreId: centre.id, patientId: b.patient.id, chairId: chairs[1]!.id, shiftId: shifts[0]!.id, date: monday, status: 'postponed' });
    const res = await desk.agent.get(`${base}?from=${monday}&to=${monday}`);
    const c = res.body.days[0].blocks[0].cells.find((x: { chairId: string }) => x.chairId === chairs[1]!.id);
    expect(c).toMatchObject({ session: null, heldBy: null });
  });

  it('rejects more than 14 days and inverted ranges', async () => {
    const { desk, monday, base } = await setup();
    expect((await desk.agent.get(`${base}?from=${monday}&to=${addDays(monday, 14)}`)).status).toBe(400);
    expect((await desk.agent.get(`${base}?from=${addDays(monday, 2)}&to=${monday}`)).status).toBe(400);
    expect((await desk.agent.get(`${base}?from=${monday}&to=${addDays(monday, 13)}`)).status).toBe(200);
  });
});

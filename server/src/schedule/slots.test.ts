import { describe, it, expect, beforeAll, vi } from 'vitest';
import { Types } from 'mongoose';
import { withTransaction } from '../db.js';
import { addDays, todayLocal, weekdayOf } from '../lib/dates.js';
import { Centre } from '../centres/centre.model.js';
import { Chair } from '../centres/chair.model.js';
import { Shift } from '../centres/shift.model.js';
import { Session } from '../sessions/session.model.js';
import { Plan, type PlanItem } from './plan.model.js';
import { assertPlanItemsFree, freeMachines, isSlotFree, lockSlot, planHolds } from './slots.js';
import { SlotLock } from './slot-lock.model.js';
import { makeCentre, makePatient, makeSession } from '../../test/factories.js';

beforeAll(async () => {
  await Promise.all([Session.init(), Plan.init()]);
});

/** First date on or after `date` falling on `weekday`. */
function nextWeekday(date: string, weekday: number): string {
  let d = date;
  while (weekdayOf(d) !== weekday) d = addDays(d, 1);
  return d;
}
const MON = 1;
const TUE = 2;
const FRI = 5; // default centre: Friday off

const pid = () => new Types.ObjectId().toHexString();

async function setup() {
  const { centre, chairs, shifts } = await makeCentre();
  const c = centre.id as string;
  const m = (i: number) => chairs[i]!.id as string;
  const s = (i: number) => shifts[i]!.id as string;
  const monday = nextWeekday(todayLocal(), MON);
  return { centre, chairs, shifts, c, m, s, monday };
}

async function makePlan(o: { centreId: string; patientId: string; items: PlanItem[]; from: string; to?: string | null }) {
  return Plan.create({ ...o, to: o.to ?? null });
}

describe('Plan model', () => {
  it('allows one open plan per patient but any number of ended ones', async () => {
    const { c, m, s, monday } = await setup();
    const p = pid();
    const items = [{ weekday: MON, shiftId: s(0), chairId: m(0) }];
    await makePlan({ centreId: c, patientId: p, items, from: monday, to: addDays(monday, 7) });
    await makePlan({ centreId: c, patientId: p, items, from: addDays(monday, 14) });
    await expect(makePlan({ centreId: c, patientId: p, items, from: addDays(monday, 21) })).rejects.toMatchObject({ code: 11000 });
  });

  it('requires 1..7 items with a unique weekday+shift and repeat weekly', async () => {
    const { c, m, s, monday } = await setup();
    const p = pid();
    await expect(makePlan({ centreId: c, patientId: p, items: [], from: monday })).rejects.toThrow(/items/);
    await expect(
      makePlan({
        centreId: c,
        patientId: p,
        items: [
          { weekday: MON, shiftId: s(0), chairId: m(0) },
          { weekday: MON, shiftId: s(0), chairId: m(1) },
        ],
        from: monday,
      }),
    ).rejects.toThrow(/items/);
    await expect(
      makePlan({ centreId: c, patientId: p, items: [{ weekday: 7, shiftId: s(0), chairId: m(0) }], from: monday }),
    ).rejects.toThrow(/weekday/);
    const ok = await makePlan({
      centreId: c,
      patientId: p,
      items: [
        { weekday: MON, shiftId: s(0), chairId: m(0) },
        { weekday: MON, shiftId: s(1), chairId: m(1) },
      ],
      from: monday,
    });
    expect(ok.repeat).toBe('weekly');
    expect(ok.to).toBeNull();
  });
});

describe('isSlotFree: sessions', () => {
  it('free slot → true', async () => {
    const { c, m, s, monday } = await setup();
    expect(await isSlotFree(c, m(0), s(0), monday)).toBe(true);
  });

  it('another patient\'s scheduled, active or completed session → false; postponed/cancelled/missed/did_not_come → true', async () => {
    const { c, m, s, monday } = await setup();
    const statuses = ['scheduled', 'active', 'completed', 'postponed', 'cancelled', 'missed', 'did_not_come'];
    for (const [i, status] of statuses.entries()) {
      const date = addDays(monday, i * 7);
      await makeSession({ centreId: c, patientId: pid(), chairId: m(0), shiftId: s(0), date, status });
    }
    const got = [];
    for (const i of statuses.keys()) got.push(await isSlotFree(c, m(0), s(0), addDays(monday, i * 7)));
    expect(got).toEqual([false, false, false, true, true, true, true]);
    // other chair / other shift on the same date untouched
    expect(await isSlotFree(c, m(1), s(0), monday)).toBe(true);
    expect(await isSlotFree(c, m(0), s(1), monday)).toBe(true);
  });

  it('own session with ignorePatientId → true; someone else\'s still → false', async () => {
    const { c, m, s, monday } = await setup();
    const p = pid();
    await makeSession({ centreId: c, patientId: p, chairId: m(0), shiftId: s(0), date: monday, status: 'scheduled' });
    expect(await isSlotFree(c, m(0), s(0), monday, { ignorePatientId: p })).toBe(true);
    expect(await isSlotFree(c, m(0), s(0), monday, { ignorePatientId: pid() })).toBe(false);
  });

  it('non-working day, inactive or foreign chair, inactive or foreign shift → false', async () => {
    const { c, m, s, chairs, shifts } = await setup();
    const other = await makeCentre({ name: 'Other' });
    const friday = nextWeekday(todayLocal(), FRI);
    const tuesday = nextWeekday(todayLocal(), TUE);
    expect(await isSlotFree(c, m(0), s(0), friday)).toBe(false);
    expect(await isSlotFree(c, other.chairs[0]!.id, s(0), tuesday)).toBe(false);
    expect(await isSlotFree(c, m(0), other.shifts[0]!.id, tuesday)).toBe(false);
    expect(await isSlotFree(c, 'not-an-id', s(0), tuesday)).toBe(false);
    expect(await isSlotFree(c, m(0), s(0), 'garbage')).toBe(false);
    await Chair.updateOne({ _id: chairs[0]!._id }, { active: false });
    await Shift.updateOne({ _id: shifts[1]!._id }, { active: false });
    expect(await isSlotFree(c, m(0), s(0), tuesday)).toBe(false);
    expect(await isSlotFree(c, m(1), s(1), tuesday)).toBe(false);
    expect(await isSlotFree(c, m(1), s(0), tuesday)).toBe(true);
  });
});

describe('isSlotFree: weekly plans (Review Focus 1 & 2)', () => {
  it('another patient\'s weekly plan holds a Monday 5 weeks out with no session generated → false', async () => {
    const { c, m, s, monday } = await setup();
    const holder = pid();
    await makePlan({ centreId: c, patientId: holder, items: [{ weekday: MON, shiftId: s(1), chairId: m(2) }], from: todayLocal() });
    const far = addDays(monday, 35);
    expect(await Session.countDocuments()).toBe(0);
    expect(await isSlotFree(c, m(2), s(1), far)).toBe(false);
    // the holder themselves is not blocked by their own plan
    expect(await isSlotFree(c, m(2), s(1), far, { ignorePatientId: holder })).toBe(true);
    // other chair, other block, other weekday are free
    expect(await isSlotFree(c, m(1), s(1), far)).toBe(true);
    expect(await isSlotFree(c, m(2), s(0), far)).toBe(true);
    expect(await isSlotFree(c, m(2), s(1), addDays(far, 1))).toBe(true);
  });

  it('a plan that starts later does not hold dates before its start', async () => {
    const { c, m, s, monday } = await setup();
    await makePlan({ centreId: c, patientId: pid(), items: [{ weekday: MON, shiftId: s(0), chairId: m(0) }], from: addDays(monday, 14) });
    expect(await isSlotFree(c, m(0), s(0), addDays(monday, 7))).toBe(true);
    expect(await isSlotFree(c, m(0), s(0), addDays(monday, 14))).toBe(false);
  });

  it('holder\'s Monday session postponed → that Monday free, next Monday taken', async () => {
    const { c, m, s, monday } = await setup();
    const holder = pid();
    const plan = await makePlan({ centreId: c, patientId: holder, items: [{ weekday: MON, shiftId: s(0), chairId: m(0) }], from: monday });
    await makeSession({ centreId: c, patientId: holder, chairId: m(0), shiftId: s(0), date: monday, status: 'postponed', planId: plan._id });
    expect(await isSlotFree(c, m(0), s(0), monday)).toBe(true);
    expect(await isSlotFree(c, m(0), s(0), addDays(monday, 7))).toBe(false);
  });

  it('holder\'s Monday session cancelled → that Monday free, next Monday taken', async () => {
    const { c, m, s, monday } = await setup();
    const holder = pid();
    await makePlan({ centreId: c, patientId: holder, items: [{ weekday: MON, shiftId: s(0), chairId: m(0) }], from: monday });
    await makeSession({ centreId: c, patientId: holder, chairId: m(0), shiftId: s(0), date: addDays(monday, 7), status: 'cancelled' });
    expect(await isSlotFree(c, m(0), s(0), addDays(monday, 7))).toBe(true);
    expect(await isSlotFree(c, m(0), s(0), monday)).toBe(false);
    expect(await isSlotFree(c, m(0), s(0), addDays(monday, 14))).toBe(false);
  });

  it('holder\'s did_not_come or missed session does not free the slot', async () => {
    const { c, m, s, monday } = await setup();
    const holder = pid();
    await makePlan({ centreId: c, patientId: holder, items: [{ weekday: MON, shiftId: s(0), chairId: m(0) }], from: monday });
    await makeSession({ centreId: c, patientId: holder, chairId: m(0), shiftId: s(0), date: monday, status: 'did_not_come' });
    await makeSession({ centreId: c, patientId: holder, chairId: m(0), shiftId: s(0), date: addDays(monday, 7), status: 'missed' });
    expect(await isSlotFree(c, m(0), s(0), monday)).toBe(false);
    expect(await isSlotFree(c, m(0), s(0), addDays(monday, 7))).toBe(false);
  });

  it('another patient\'s postponed session does not free the holder\'s slot', async () => {
    const { c, m, s, monday } = await setup();
    await makePlan({ centreId: c, patientId: pid(), items: [{ weekday: MON, shiftId: s(0), chairId: m(0) }], from: monday });
    await makeSession({ centreId: c, patientId: pid(), chairId: m(0), shiftId: s(0), date: monday, status: 'postponed' });
    expect(await isSlotFree(c, m(0), s(0), monday)).toBe(false);
  });

  it('holder\'s session moved away (movedFrom) → that Monday free, next Monday taken; destination taken', async () => {
    const { c, m, s, monday } = await setup();
    const holder = pid();
    await makePlan({ centreId: c, patientId: holder, items: [{ weekday: MON, shiftId: s(0), chairId: m(0) }], from: monday });
    const tuesday = addDays(monday, 1);
    await makeSession({
      centreId: c,
      patientId: holder,
      chairId: m(3),
      shiftId: s(1),
      date: tuesday,
      status: 'scheduled',
      detached: true,
      movedFrom: { date: monday, shiftId: new Types.ObjectId(s(0)), chairId: new Types.ObjectId(m(0)) },
    });
    expect(await isSlotFree(c, m(0), s(0), monday)).toBe(true);
    expect(await isSlotFree(c, m(0), s(0), addDays(monday, 7))).toBe(false);
    expect(await isSlotFree(c, m(3), s(1), tuesday)).toBe(false);
  });

  it('a move from another block on the same date does not free this block', async () => {
    const { c, m, s, monday } = await setup();
    const holder = pid();
    await makePlan({
      centreId: c,
      patientId: holder,
      items: [
        { weekday: MON, shiftId: s(0), chairId: m(0) },
        { weekday: MON, shiftId: s(1), chairId: m(0) },
      ],
      from: monday,
    });
    await makeSession({
      centreId: c,
      patientId: holder,
      chairId: m(1),
      shiftId: s(1),
      date: addDays(monday, 2),
      status: 'scheduled',
      detached: true,
      movedFrom: { date: monday, shiftId: new Types.ObjectId(s(1)), chairId: new Types.ObjectId(m(0)) },
    });
    expect(await isSlotFree(c, m(0), s(1), monday)).toBe(true);
    expect(await isSlotFree(c, m(0), s(0), monday)).toBe(false);
  });

  it('plan ended (to = last Monday) → the following Monday free, the last Monday still taken', async () => {
    const { c, m, s, monday } = await setup();
    const last = addDays(monday, 14);
    await makePlan({ centreId: c, patientId: pid(), items: [{ weekday: MON, shiftId: s(0), chairId: m(0) }], from: monday, to: last });
    expect(await isSlotFree(c, m(0), s(0), last)).toBe(false);
    expect(await isSlotFree(c, m(0), s(0), addDays(last, 7))).toBe(true);
  });

  it('a slot freed for one date by a postponement is still taken by a live one-off there', async () => {
    const { c, m, s, monday } = await setup();
    const holder = pid();
    await makePlan({ centreId: c, patientId: holder, items: [{ weekday: MON, shiftId: s(0), chairId: m(0) }], from: monday });
    await makeSession({ centreId: c, patientId: holder, chairId: m(0), shiftId: s(0), date: monday, status: 'postponed' });
    await makeSession({ centreId: c, patientId: pid(), chairId: m(0), shiftId: s(0), date: monday, status: 'scheduled', kind: 'makeup' });
    expect(await isSlotFree(c, m(0), s(0), monday)).toBe(false);
  });

  it('accepts a Mongo session (reads inside a transaction)', async () => {
    const { c, m, s, monday } = await setup();
    const got = await withTransaction(async (session) => {
      // uncommitted writes are visible only to reads that go through `session`
      await Plan.create([{ centreId: c, patientId: pid(), items: [{ weekday: MON, shiftId: s(0), chairId: m(0) }], from: monday, to: null }], {
        session,
      });
      const [chair, shift] = await Promise.all([Chair.findById(m(2)), Shift.findById(s(0))]);
      await Session.create(
        [{ centreId: c, patientId: pid(), chairId: m(2), shiftId: s(0), date: monday, chairLabel: chair!.label, shiftStart: shift!.start, shiftEnd: shift!.end }],
        { session },
      );
      return {
        inPlan: await isSlotFree(c, m(0), s(0), monday, { session }),
        inSession: await isSlotFree(c, m(2), s(0), monday, { session }),
        outPlan: await isSlotFree(c, m(0), s(0), monday),
        outSession: await isSlotFree(c, m(2), s(0), monday),
        list: (await freeMachines(c, s(0), monday, { session })).map((x) => x.label),
      };
    });
    expect(got).toEqual({ inPlan: false, inSession: false, outPlan: true, outSession: true, list: ['2', '4'] });
  });
});

describe('freeMachines', () => {
  it('lists active machines that are free, in label order', async () => {
    const { c, m, s, chairs, monday } = await setup();
    await makePlan({ centreId: c, patientId: pid(), items: [{ weekday: MON, shiftId: s(0), chairId: m(0) }], from: monday });
    await makeSession({ centreId: c, patientId: pid(), chairId: m(2), shiftId: s(0), date: monday, status: 'scheduled' });
    await Chair.updateOne({ _id: chairs[3]!._id }, { active: false });
    expect(await freeMachines(c, s(0), monday)).toEqual([{ id: m(1), label: '2' }]);
    expect((await freeMachines(c, s(1), monday)).map((x) => x.label)).toEqual(['1', '2', '3']);
  });

  it('ignorePatientId frees the patient\'s own holdings', async () => {
    const { c, m, s, monday } = await setup();
    const p = pid();
    await makePlan({ centreId: c, patientId: p, items: [{ weekday: MON, shiftId: s(0), chairId: m(0) }], from: monday });
    expect((await freeMachines(c, s(0), monday, { ignorePatientId: p })).map((x) => x.label)).toEqual(['1', '2', '3', '4']);
  });

  it('non-working day → []', async () => {
    const { c, s } = await setup();
    expect(await freeMachines(c, s(0), nextWeekday(todayLocal(), FRI))).toEqual([]);
    await Centre.updateOne({ _id: c }, { workingDays: [0, 2, 3, 4, 6] });
    expect(await freeMachines(c, s(0), nextWeekday(todayLocal(), MON))).toEqual([]);
  });

  it('inactive block → []; block of another centre → 404', async () => {
    const { c, s, shifts } = await setup();
    const other = await makeCentre({ name: 'Other' });
    await expect(freeMachines(c, other.shifts[0]!.id, nextWeekday(todayLocal(), MON))).rejects.toMatchObject({ status: 404 });
    await Shift.updateOne({ _id: shifts[0]!._id }, { active: false });
    expect(await freeMachines(c, s(0), nextWeekday(todayLocal(), MON))).toEqual([]);
  });
});

describe('assertPlanItemsFree', () => {
  const run = (...args: Parameters<typeof assertPlanItemsFree> extends [...infer A, unknown] ? A : never) =>
    withTransaction((session) => assertPlanItemsFree(...args, session));

  it('overlapping date ranges with another patient\'s plan item → 409 slot_taken', async () => {
    const { c, m, s } = await setup();
    const item = { weekday: MON, shiftId: s(0), chairId: m(0) };
    await makePlan({ centreId: c, patientId: pid(), items: [item], from: '2026-11-02', to: '2026-11-30' });
    await expect(run(c, [item], '2026-11-30', null, pid())).rejects.toMatchObject({ status: 409, code: 'slot_taken' });
    await expect(run(c, [item], '2026-10-19', '2026-11-02', pid())).rejects.toMatchObject({ status: 409, code: 'slot_taken' });
    await expect(run(c, [item], '2026-10-19', null, pid())).rejects.toMatchObject({ status: 409, code: 'slot_taken' });
  });

  it('an open plan that starts later still conflicts with an open-ended booking (beyond the generation window)', async () => {
    const { c, m, s } = await setup();
    const item = { weekday: MON, shiftId: s(1), chairId: m(2) };
    await makePlan({ centreId: c, patientId: pid(), items: [item], from: '2027-03-01' });
    await expect(run(c, [item], '2026-10-19', null, pid())).rejects.toMatchObject({ status: 409, code: 'slot_taken' });
    await expect(run(c, [item], '2026-10-19', '2027-02-28', pid())).resolves.toBeUndefined();
  });

  it('adjacent ranges (A to 2026-11-30, B from 2026-12-01) → ok', async () => {
    const { c, m, s } = await setup();
    const item = { weekday: MON, shiftId: s(0), chairId: m(0) };
    await makePlan({ centreId: c, patientId: pid(), items: [item], from: '2026-11-02', to: '2026-11-30' });
    await expect(run(c, [item], '2026-12-01', null, pid())).resolves.toBeUndefined();
  });

  it('ranges that overlap only on days that are not the item\'s weekday → ok', async () => {
    const { c, m, s } = await setup();
    const item = { weekday: MON, shiftId: s(0), chairId: m(0) };
    // A ends Tue 2026-12-01; B starts the same Tuesday: no Monday in common
    await makePlan({ centreId: c, patientId: pid(), items: [item], from: '2026-11-02', to: '2026-12-01' });
    await expect(run(c, [item], '2026-12-01', null, pid())).resolves.toBeUndefined();
    // a range with no Monday in it at all is fine even against an open plan
    await makePlan({ centreId: c, patientId: pid(), items: [{ ...item, chairId: m(1) }], from: '2026-10-19' });
    await expect(run(c, [{ ...item, chairId: m(1) }], '2026-12-08', '2026-12-13', pid())).resolves.toBeUndefined();
  });

  it('same chair and weekday but a different block, or same block and weekday on another chair → ok', async () => {
    const { c, m, s } = await setup();
    await makePlan({ centreId: c, patientId: pid(), items: [{ weekday: MON, shiftId: s(0), chairId: m(0) }], from: '2026-10-19' });
    await expect(run(c, [{ weekday: MON, shiftId: s(1), chairId: m(0) }], '2026-10-19', null, pid())).resolves.toBeUndefined();
    await expect(run(c, [{ weekday: MON, shiftId: s(0), chairId: m(1) }], '2026-10-19', null, pid())).resolves.toBeUndefined();
    await expect(run(c, [{ weekday: TUE, shiftId: s(0), chairId: m(0) }], '2026-10-19', null, pid())).resolves.toBeUndefined();
  });

  it('the patient\'s own plan does not conflict', async () => {
    const { c, m, s } = await setup();
    const p = pid();
    const item = { weekday: MON, shiftId: s(0), chairId: m(0) };
    await makePlan({ centreId: c, patientId: p, items: [item], from: '2026-10-19' });
    await expect(run(c, [item], '2026-11-02', null, p)).resolves.toBeUndefined();
  });

  it('another patient\'s scheduled/active session on a matching date in range → 409; outside range, other weekday, postponed or own → ok', async () => {
    const { c, m, s } = await setup();
    const item = { weekday: MON, shiftId: s(0), chairId: m(0) };
    const p = pid();
    await makeSession({ centreId: c, patientId: pid(), chairId: m(0), shiftId: s(0), date: '2026-11-09', status: 'scheduled' });
    await makeSession({ centreId: c, patientId: pid(), chairId: m(0), shiftId: s(0), date: '2026-11-10', status: 'scheduled' }); // Tuesday
    await makeSession({ centreId: c, patientId: pid(), chairId: m(0), shiftId: s(0), date: '2026-11-16', status: 'postponed' });
    await makeSession({ centreId: c, patientId: p, chairId: m(0), shiftId: s(0), date: '2026-11-23', status: 'scheduled' });
    await expect(run(c, [item], '2026-10-19', null, p)).rejects.toMatchObject({ status: 409, code: 'slot_taken' });
    await expect(run(c, [item], '2026-11-02', '2026-11-09', p)).rejects.toMatchObject({ status: 409, code: 'slot_taken' });
    await expect(run(c, [item], '2026-11-10', null, p)).resolves.toBeUndefined();
    await expect(run(c, [item], '2026-10-19', '2026-11-08', p)).resolves.toBeUndefined();
    await Session.updateOne({ date: '2026-11-09' }, { status: 'active' });
    await expect(run(c, [item], '2026-11-09', null, p)).rejects.toMatchObject({ status: 409, code: 'slot_taken' });
  });

  it('refuses a non-working weekday, inactive or foreign machine/block, and an inverted range', async () => {
    const { c, m, s, chairs, shifts } = await setup();
    const other = await makeCentre({ name: 'Other' });
    const p = pid();
    await expect(run(c, [{ weekday: FRI, shiftId: s(0), chairId: m(0) }], '2026-10-19', null, p)).rejects.toMatchObject({
      status: 400,
      code: 'not_working_day',
    });
    await expect(run(c, [{ weekday: MON, shiftId: s(0), chairId: other.chairs[0]!.id }], '2026-10-19', null, p)).rejects.toMatchObject({
      status: 404,
    });
    await expect(run(c, [{ weekday: MON, shiftId: other.shifts[0]!.id, chairId: m(0) }], '2026-10-19', null, p)).rejects.toMatchObject({
      status: 404,
    });
    await expect(run(c, [{ weekday: MON, shiftId: s(0), chairId: m(0) }], '2026-10-19', '2026-10-18', p)).rejects.toMatchObject({
      status: 400,
      code: 'invalid_range',
    });
    await Chair.updateOne({ _id: chairs[0]!._id }, { active: false });
    await Shift.updateOne({ _id: shifts[1]!._id }, { active: false });
    await expect(run(c, [{ weekday: MON, shiftId: s(0), chairId: m(0) }], '2026-10-19', null, p)).rejects.toMatchObject({
      status: 400,
      code: 'inactive_chair',
    });
    await expect(run(c, [{ weekday: MON, shiftId: s(1), chairId: m(1) }], '2026-10-19', null, p)).rejects.toMatchObject({
      status: 400,
      code: 'inactive_shift',
    });
  });

  it('concurrent plan bookings of the same slot by different patients: exactly one wins', async () => {
    const { c, m, s } = await setup();
    const item = { weekday: MON, shiftId: s(1), chairId: m(2) };
    const book = (patientId: string) =>
      withTransaction(async (session) => {
        await assertPlanItemsFree(c, [item], '2026-10-19', null, patientId, session);
        await Plan.create([{ centreId: c, patientId, items: [item], from: '2026-10-19', to: null }], { session });
      });
    const results = await Promise.allSettled([book(pid()), book(pid()), book(pid()), book(pid()), book(pid())]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results.filter((x) => x.status === 'rejected')) {
      expect((r as PromiseRejectedResult).reason).toMatchObject({ status: 409, code: 'slot_taken' });
    }
    expect(await Plan.countDocuments()).toBe(1);
  });

  it('a concurrent one-off (lockSlot + isSlotFree) and plan booking for the same slot: exactly one wins', async () => {
    const { c, m, s, monday } = await setup();
    const item = { weekday: MON, shiftId: s(0), chairId: m(0) };
    const date = addDays(monday, 35); // beyond the generation window
    const plan = () =>
      withTransaction(async (session) => {
        await assertPlanItemsFree(c, [item], monday, null, pid(), session);
        await Plan.create([{ centreId: c, patientId: pid(), items: [item], from: monday, to: null }], { session });
        return 'plan';
      });
    const oneOff = () =>
      withTransaction(async (session) => {
        await lockSlot(m(0), s(0), weekdayOf(date), session);
        if (!(await isSlotFree(c, m(0), s(0), date, { session }))) throw Object.assign(new Error('slot_taken'), { status: 409 });
        const [chair, shift] = await Promise.all([Chair.findById(m(0)), Shift.findById(s(0))]);
        await Session.create(
          [{ centreId: c, patientId: pid(), chairId: m(0), shiftId: s(0), date, chairLabel: chair!.label, shiftStart: shift!.start, shiftEnd: shift!.end }],
          { session },
        );
        return 'oneOff';
      });
    for (let round = 0; round < 3; round++) {
      await Plan.deleteMany({});
      await Session.deleteMany({});
      const results = await Promise.allSettled([plan(), oneOff()]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect((await Plan.countDocuments()) + (await Session.countDocuments())).toBe(1);
    }
  });
});

describe('slots hardening (Task 4)', () => {
  it('holder postponed on the same date in a DIFFERENT block still holds this block', async () => {
    const { c, m, s, monday } = await setup();
    const holder = pid();
    await makePlan({ centreId: c, patientId: holder, items: [{ weekday: MON, shiftId: s(0), chairId: m(0) }], from: monday });
    // the holder's one-off in the afternoon block that day was postponed: it must not release the morning slot
    await makeSession({ centreId: c, patientId: holder, chairId: m(1), shiftId: s(1), date: monday, status: 'postponed' });
    expect(await isSlotFree(c, m(0), s(0), monday)).toBe(false);
    expect((await freeMachines(c, s(0), monday)).map((x) => x.label)).toEqual(['2', '3', '4']);
  });

  it('a malformed ignorePatientId is treated as no ignore (never throws, errs on taken)', async () => {
    const { c, m, s, monday } = await setup();
    const p = pid();
    await makeSession({ centreId: c, patientId: p, chairId: m(0), shiftId: s(0), date: monday, status: 'scheduled' });
    expect(await isSlotFree(c, m(0), s(0), monday, { ignorePatientId: 'nope' })).toBe(false);
    expect((await freeMachines(c, s(0), monday, { ignorePatientId: 'nope' })).map((x) => x.label)).toEqual(['2', '3', '4']);
  });

  it('plans are looked up within the centre only', async () => {
    const { c, m, s, monday } = await setup();
    const other = await makeCentre();
    const item = { weekday: MON, shiftId: s(0), chairId: m(0) };
    // a stray plan filed under another centre that names this centre's machine and block
    await makePlan({ centreId: other.centre.id, patientId: pid(), items: [item], from: monday });
    expect(await isSlotFree(c, m(0), s(0), monday)).toBe(true);
    await expect(withTransaction((session) => assertPlanItemsFree(c, [item], monday, null, pid(), session))).resolves.toBeUndefined();
  });

  it("another patient's live session on a date the booking patient released (postponed/cancelled/moved, same machine) does not conflict; other dates still do", async () => {
    const { c, m, s, monday } = await setup();
    const p = pid();
    const q = pid();
    const item = { weekday: MON, shiftId: s(0), chairId: m(0) };
    const at = { centreId: c, chairId: m(0), shiftId: s(0) };
    const run = (from: string) => withTransaction((session) => assertPlanItemsFree(c, [item], from, null, p, session));
    await makeSession({ ...at, patientId: p, date: monday, status: 'postponed' });
    await makeSession({ ...at, patientId: q, date: monday, status: 'scheduled', kind: 'makeup' });
    await expect(run(monday)).resolves.toBeUndefined();
    // released by a move away from the slot
    const next = addDays(monday, 7);
    await makeSession({ ...at, chairId: m(1), patientId: p, date: addDays(next, 1), status: 'scheduled', detached: true, movedFrom: { date: next, shiftId: new Types.ObjectId(s(0)), chairId: new Types.ObjectId(m(0)) } });
    await makeSession({ ...at, patientId: q, date: next, status: 'scheduled', oneOff: true });
    await expect(run(monday)).resolves.toBeUndefined();
    // a release on another machine does not count
    const third = addDays(monday, 14);
    await makeSession({ ...at, chairId: m(1), patientId: p, date: third, status: 'cancelled' });
    await makeSession({ ...at, patientId: q, date: third, status: 'scheduled', oneOff: true });
    await expect(run(monday)).rejects.toMatchObject({ status: 409, code: 'slot_taken' });
  });

  it('a plan of a patient who has moved to another centre holds nothing here', async () => {
    const { c, m, s, monday } = await setup();
    const other = await makeCentre();
    const { patient } = await makePatient(other.centre.id);
    const item = { weekday: MON, shiftId: s(0), chairId: m(0) };
    await makePlan({ centreId: c, patientId: patient.id, items: [item], from: monday, to: monday });
    expect(await isSlotFree(c, m(0), s(0), monday)).toBe(true);
    expect((await planHolds(c, s(0), monday)).size).toBe(0);
    await expect(withTransaction((session) => assertPlanItemsFree(c, [item], monday, null, pid(), session))).resolves.toBeUndefined();
  });

  it('locks items in chairId:shiftId:weekday order whatever order they are given in', async () => {
    const { c, m, s, monday } = await setup();
    const items = [
      { weekday: 3, shiftId: s(1), chairId: m(3) },
      { weekday: MON, shiftId: s(0), chairId: m(0) },
      { weekday: TUE, shiftId: s(1), chairId: m(0) },
      { weekday: MON, shiftId: s(1), chairId: m(0) },
    ];
    const spy = vi.spyOn(SlotLock, 'updateOne');
    try {
      await withTransaction((session) => assertPlanItemsFree(c, items, monday, null, pid(), session));
      const keys = spy.mock.calls.map(([f]) => {
        const k = f as { chairId: unknown; shiftId: unknown; weekday: number };
        return `${String(k.chairId)}:${String(k.shiftId)}:${k.weekday}`;
      });
      expect(keys).toHaveLength(4);
      expect(keys).toEqual([...keys].sort());
    } finally {
      spy.mockRestore();
    }
  });
});

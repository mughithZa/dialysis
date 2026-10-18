import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { seedRoles } from '../auth/roles.seed.js';
import { AuditEntry } from '../audit/audit.model.js';
import { Session } from '../sessions/session.model.js';
import { addDays, todayLocal, weekdayOf } from '../lib/dates.js';
import { ALL_DAYS, makeCentre, makePatient, staffIn } from '../../test/factories.js';
import { Plan } from './plan.model.js';
import { GENERATION_DAYS } from './generate.js';

beforeAll(async () => {
  await Promise.all([Session.init(), Plan.init()]);
});
beforeEach(seedRoles);

const SUN = 0;
const MON = 1;
const TUE = 2;
const WED = 3;
const FRI = 5; // default centre: Friday off

/** First date on or after `date` falling on `weekday`. */
function nextWeekday(date: string, weekday: number): string {
  let d = date;
  while (weekdayOf(d) !== weekday) d = addDays(d, 1);
  return d;
}

/** All dates in [from, to] falling on `weekday`. */
function datesOn(from: string, to: string, weekday: number): string[] {
  const out: string[] = [];
  for (let d = nextWeekday(from, weekday); d <= to; d = addDays(d, 7)) out.push(d);
  return out;
}

const today = () => todayLocal();
const windowEnd = () => addDays(today(), GENERATION_DAYS - 1);

async function setup(workingDays?: number[]) {
  const { centre, chairs, shifts } = await makeCentre({ chairs: 6, workingDays });
  const desk = await staffIn(centre.id, ['front_desk']);
  const base = `/api/centres/${centre.id}`;
  const m = (i: number) => chairs[i]!.id as string;
  const s = (i: number) => shifts[i]!.id as string;
  const item = (weekday: number, shift: number, chair: number) => ({ weekday, shiftId: s(shift), chairId: m(chair) });
  const book = (patientId: string, body: object) => desk.agent.post(`${base}/patients/${patientId}/plan`).send(body);
  const weekly = (patientId: string, items: object[], o: object = {}) =>
    book(patientId, { items, from: today(), repeat: 'weekly', ...o });
  const once = (patientId: string, items: object[], o: object = {}) => book(patientId, { items, from: today(), repeat: 'once', ...o });
  const change = (patientId: string, body: object) => desk.agent.put(`${base}/patients/${patientId}/plan`).send(body);
  return { centre, chairs, shifts, desk, agent: desk.agent, base, m, s, item, book, weekly, once, change };
}

describe('weekly plan', () => {
  it('Mon S2 M3 + Wed S1 M6 → sessions on the right days, blocks and machines for 14 days; audited; GET plan', async () => {
    const { centre, chairs, shifts, agent, base, item, weekly } = await setup();
    const { patient } = await makePatient(centre.id);
    const res = await weekly(patient.id, [item(MON, 1, 2), item(WED, 0, 5)]);
    expect(res.status).toBe(201);
    expect(res.body.plan).toMatchObject({
      patientId: patient.id,
      from: today(),
      to: null,
      repeat: 'weekly',
      items: [
        { weekday: MON, shiftId: shifts[1]!.id, chairId: chairs[2]!.id },
        { weekday: WED, shiftId: shifts[0]!.id, chairId: chairs[5]!.id },
      ],
    });

    const sessions = await Session.find({ patientId: patient.id }).sort({ date: 1 });
    const mondays = datesOn(today(), windowEnd(), MON);
    const wednesdays = datesOn(today(), windowEnd(), WED);
    expect(sessions.map((x) => x.date)).toEqual([...mondays, ...wednesdays].sort());
    for (const x of sessions) {
      const mon = weekdayOf(x.date) === MON;
      expect(String(x.shiftId)).toBe(shifts[mon ? 1 : 0]!.id);
      expect(String(x.chairId)).toBe(chairs[mon ? 2 : 5]!.id);
      expect(x.chairLabel).toBe(mon ? '3' : '6');
      expect(x.shiftStart).toBe(shifts[mon ? 1 : 0]!.start);
      expect(x.shiftEnd).toBe(shifts[mon ? 1 : 0]!.end);
      expect(String(x.planId)).toBe(res.body.plan.id);
      expect(x).toMatchObject({ status: 'scheduled', kind: 'regular', detached: false });
    }
    expect(await AuditEntry.countDocuments({ action: 'plan.create' })).toBe(1);

    const got = await agent.get(`${base}/patients/${patient.id}/plan`);
    expect(got.status).toBe(200);
    expect(got.body.plan.id).toBe(res.body.plan.id);
    const { patient: none } = await makePatient(centre.id);
    expect((await agent.get(`${base}/patients/${none.id}/plan`)).body).toEqual({ plan: null });
  });

  it('GET plan prefers the plan in force today, else the next one to start', async () => {
    const { centre, agent, base, item, weekly, change } = await setup();
    const get = async (id: string) => (await agent.get(`${base}/patients/${id}/plan`)).body.plan;
    const a = await makePatient(centre.id);
    const first = (await weekly(a.patient.id, [item(MON, 0, 0)])).body.plan;
    await change(a.patient.id, { items: [item(TUE, 0, 0)], from: addDays(today(), 7) });
    expect(await get(a.patient.id)).toMatchObject({ id: first.id, to: addDays(today(), 6) });

    const b = await makePatient(centre.id);
    const soon = (await weekly(b.patient.id, [item(MON, 1, 1)], { from: addDays(today(), 3) })).body.plan;
    await change(b.patient.id, { items: [item(TUE, 1, 1)], from: addDays(today(), 7) });
    expect(await get(b.patient.id)).toMatchObject({ id: soon.id, from: addDays(today(), 3), to: addDays(today(), 6) });
  });

  it('with an end date: the plan stops there and nothing is generated after it', async () => {
    const { centre, item, weekly } = await setup(ALL_DAYS);
    const { patient } = await makePatient(centre.id);
    const to = addDays(today(), 6);
    const res = await weekly(patient.id, [item(MON, 0, 0), item(TUE, 0, 0)], { to });
    expect(res.status).toBe(201);
    expect(res.body.plan.to).toBe(to);
    const sessions = await Session.find({ patientId: patient.id });
    expect(sessions).toHaveLength(2);
    expect(sessions.every((x) => x.date <= to)).toBe(true);
  });

  it('a second weekly plan for the same patient → 409 already_booked', async () => {
    const { centre, item, weekly } = await setup();
    const { patient } = await makePatient(centre.id);
    expect((await weekly(patient.id, [item(MON, 0, 0)])).status).toBe(201);
    const again = await weekly(patient.id, [item(TUE, 0, 1)]);
    expect([again.status, again.body]).toEqual([409, { error: 'already_booked' }]);
  });

  it('another patient\'s plan on the same machine, block and weekday → 409 slot_taken; nothing created', async () => {
    const { centre, item, weekly } = await setup();
    const a = await makePatient(centre.id);
    const b = await makePatient(centre.id);
    expect((await weekly(a.patient.id, [item(MON, 1, 2)])).status).toBe(201);
    const res = await weekly(b.patient.id, [item(TUE, 1, 2), item(MON, 1, 2)]);
    expect([res.status, res.body]).toEqual([409, { error: 'slot_taken' }]);
    expect(await Plan.countDocuments({ patientId: b.patient.id })).toBe(0);
    expect(await Session.countDocuments({ patientId: b.patient.id })).toBe(0);
  });

  it('two concurrent weekly bookings of two patients for the same (M3, S2, Mon) → [201, 409]', async () => {
    const { centre, item, weekly } = await setup();
    const a = await makePatient(centre.id);
    const b = await makePatient(centre.id);
    const rs = await Promise.all([weekly(a.patient.id, [item(MON, 1, 2)]), weekly(b.patient.id, [item(MON, 1, 2)])]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(rs.find((r) => r.status === 409)!.body.error).toBe('slot_taken');
    expect(await Plan.countDocuments()).toBe(1);
  });

  it('concurrent weekly bookings for the same patient: exactly one wins with already_booked', async () => {
    const { centre, item, weekly } = await setup();
    const { patient } = await makePatient(centre.id);
    const rs = await Promise.all([weekly(patient.id, [item(MON, 0, 0)]), weekly(patient.id, [item(TUE, 0, 1)])]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(rs.find((r) => r.status === 409)!.body.error).toBe('already_booked');
    expect(await Plan.countDocuments({ patientId: patient.id, to: null })).toBe(1);
  });

  it('concurrent end-dated weekly bookings for one patient on different slots: [201, 409], never overlapping plans', async () => {
    const { centre, item, weekly } = await setup();
    for (let round = 0; round < 3; round++) {
      const { patient } = await makePatient(centre.id);
      const to = addDays(today(), 30);
      const rs = await Promise.all([
        weekly(patient.id, [item(MON, 0, round)], { to }),
        weekly(patient.id, [item(TUE, 1, round)], { to }),
      ]);
      expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(rs.find((r) => r.status === 409)!.body.error).toBe('already_booked');
      expect(await Plan.countDocuments({ patientId: patient.id })).toBe(1);
    }
  });

  it('an end-dated booking racing a plan change for one patient never leaves overlapping plans', async () => {
    const { centre, item, weekly, change } = await setup();
    for (let round = 0; round < 3; round++) {
      const { patient } = await makePatient(centre.id);
      expect((await weekly(patient.id, [item(MON, 0, round)], { to: addDays(today(), 20) })).status).toBe(201);
      await Promise.all([
        // starts after the current plan ends, so alone it is fine; the change would make it overlap
        weekly(patient.id, [item(TUE, 1, round)], { from: addDays(today(), 21), to: addDays(today(), 40) }),
        change(patient.id, { items: [item(WED, 1, round)], from: addDays(today(), 7) }),
      ]);
      const plans = await Plan.find({ patientId: patient.id }).sort({ from: 1 });
      for (let i = 1; i < plans.length; i++) {
        const prev = plans[i - 1]!;
        expect(prev.to != null && prev.to < plans[i]!.from).toBe(true);
      }
    }
  });
});

describe('one-off booking (repeat: once)', () => {
  it('creates exactly one session per item on the first matching date ≥ from; no plan', async () => {
    const { centre, chairs, shifts, item, once } = await setup();
    const { patient } = await makePatient(centre.id);
    const res = await once(patient.id, [item(MON, 1, 2), item(WED, 0, 5)]);
    expect(res.status).toBe(201);
    expect(res.body.sessions).toHaveLength(2);
    const sessions = await Session.find({ patientId: patient.id }).sort({ date: 1 });
    expect(sessions.map((x) => x.date)).toEqual([nextWeekday(today(), MON), nextWeekday(today(), WED)].sort());
    const mon = sessions.find((x) => weekdayOf(x.date) === MON)!;
    expect([String(mon.shiftId), String(mon.chairId), mon.chairLabel]).toEqual([shifts[1]!.id, chairs[2]!.id, '3']);
    expect(sessions.every((x) => x.status === 'scheduled' && x.kind === 'regular' && !x.planId)).toBe(true);
    expect(await Plan.countDocuments()).toBe(0);
    expect(await AuditEntry.countDocuments({ action: 'booking.once' })).toBe(1);
  });

  it('is allowed while the patient has an open plan', async () => {
    const { centre, item, weekly, once } = await setup();
    const { patient } = await makePatient(centre.id);
    expect((await weekly(patient.id, [item(MON, 0, 0)])).status).toBe(201);
    const res = await once(patient.id, [item(TUE, 1, 3)]);
    expect(res.status).toBe(201);
    expect(await Session.exists({ patientId: patient.id, date: nextWeekday(today(), TUE), shiftId: res.body.sessions[0].shiftId })).not.toBeNull();
  });

  it('onto a slot another patient\'s plan holds → 409 slot_taken; onto that slot on a date the holder postponed → 201', async () => {
    const { centre, s, item, weekly, once } = await setup();
    const holder = await makePatient(centre.id);
    const other = await makePatient(centre.id);
    expect((await weekly(holder.patient.id, [item(MON, 0, 0)])).status).toBe(201);
    const first = nextWeekday(today(), MON);
    const taken = await once(other.patient.id, [item(MON, 0, 0)]);
    expect([taken.status, taken.body]).toEqual([409, { error: 'slot_taken' }]);
    await Session.updateOne({ patientId: holder.patient.id, date: first, shiftId: s(0) }, { $set: { status: 'postponed' } });
    const freed = await once(other.patient.id, [item(MON, 0, 0)]);
    expect(freed.status).toBe(201);
    expect(freed.body.sessions[0].date).toBe(first);
    // the holder's next Monday is still theirs
    const next = await once(other.patient.id, [item(MON, 0, 0)], { from: addDays(first, 1) });
    expect([next.status, next.body]).toEqual([409, { error: 'slot_taken' }]);
  });

  it('all items are booked in one transaction: one taken item books none', async () => {
    const { centre, item, weekly, once } = await setup();
    const holder = await makePatient(centre.id);
    const other = await makePatient(centre.id);
    await weekly(holder.patient.id, [item(WED, 0, 0)]);
    const res = await once(other.patient.id, [item(MON, 0, 0), item(WED, 0, 0)]);
    expect(res.status).toBe(409);
    expect(await Session.countDocuments({ patientId: other.patient.id })).toBe(0);
  });

  it('a concurrent one-off and weekly booking of the same slot: exactly one wins', async () => {
    const { centre, item, weekly, once } = await setup();
    for (let round = 0; round < 3; round++) {
      const a = await makePatient(centre.id);
      const b = await makePatient(centre.id);
      const rs = await Promise.all([once(a.patient.id, [item(MON, round % 2, round)]), weekly(b.patient.id, [item(MON, round % 2, round)])]);
      expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    }
  });
});

describe('booking validation', () => {
  it('validates body, from, range, machines, blocks, working day and patient state', async () => {
    const { centre, chairs, shifts, item, book, weekly, once } = await setup();
    const { patient } = await makePatient(centre.id);
    const err = async (p: Promise<{ status: number; body: { error?: string } }>) => {
      const r = await p;
      return [r.status, r.body.error];
    };
    expect(await err(weekly(patient.id, []))).toEqual([400, 'validation']);
    expect(await err(weekly(patient.id, [item(MON, 0, 0), item(MON, 0, 1)]))).toEqual([400, 'validation']);
    expect(await err(weekly(patient.id, [{ ...item(MON, 0, 0), weekday: 7 }]))).toEqual([400, 'validation']);
    expect(await err(book(patient.id, { items: [item(MON, 0, 0)], from: today(), repeat: 'monthly' }))).toEqual([400, 'validation']);
    expect(await err(book(patient.id, { items: [item(MON, 0, 0)], repeat: 'weekly' }))).toEqual([400, 'validation']);
    for (const go of [weekly, once]) {
      expect(await err(go(patient.id, [item(MON, 0, 0)], { from: addDays(today(), -1) }))).toEqual([400, 'from_in_past']);
      expect(await err(go(patient.id, [item(FRI, 0, 0)]))).toEqual([400, 'not_working_day']);
      expect(await err(go(patient.id, [{ ...item(MON, 0, 0), chairId: 'nope' }]))).toEqual([404, 'not_found']);
    }
    expect(await err(weekly(patient.id, [item(MON, 0, 0)], { to: addDays(today(), -1) }))).toEqual([400, 'invalid_range']);

    const other = await makeCentre();
    expect(await err(weekly(patient.id, [{ ...item(MON, 0, 0), chairId: other.chairs[0]!.id }]))).toEqual([404, 'not_found']);
    expect(await err(once(patient.id, [{ ...item(MON, 0, 0), shiftId: other.shifts[0]!.id }]))).toEqual([404, 'not_found']);
    chairs[1]!.active = false;
    await chairs[1]!.save();
    shifts[1]!.active = false;
    await shifts[1]!.save();
    expect(await err(weekly(patient.id, [item(MON, 0, 1)]))).toEqual([400, 'inactive_chair']);
    expect(await err(once(patient.id, [item(MON, 1, 0)]))).toEqual([400, 'inactive_shift']);
    expect(await Plan.countDocuments()).toBe(0);
    expect(await Session.countDocuments()).toBe(0);

    patient.status = 'transferring';
    await patient.save();
    expect(await err(weekly(patient.id, [item(MON, 0, 0)]))).toEqual([409, 'transfer_pending']);
    patient.status = 'discharged';
    await patient.save();
    expect(await err(once(patient.id, [item(MON, 0, 0)]))).toEqual([409, 'patient_not_active']);
    const foreign = await makePatient(other.centre.id);
    expect(await err(weekly(foreign.patient.id, [item(MON, 0, 0)]))).toEqual([404, 'not_found']);
  });

  it('booking needs schedule.book; reading the plan needs schedule.view', async () => {
    const { centre, base, item } = await setup();
    const { patient } = await makePatient(centre.id);
    const nurse = await staffIn(centre.id, ['nurse']);
    const body = { items: [item(MON, 0, 0)], from: today(), repeat: 'weekly' };
    expect((await nurse.agent.post(`${base}/patients/${patient.id}/plan`).send(body)).status).toBe(403);
    expect((await nurse.agent.put(`${base}/patients/${patient.id}/plan`).send(body)).status).toBe(403);
    expect((await nurse.agent.get(`${base}/patients/${patient.id}/plan`)).status).toBe(200);
  });
});

describe('changing the weekly plan from a date', () => {
  it('keeps a moved (detached) future session and removes the old weekday\'s future sessions (Review Focus 4)', async () => {
    const { centre, agent, base, m, s, item, weekly, change } = await setup();
    const { patient } = await makePatient(centre.id);
    const booked = await weekly(patient.id, [item(MON, 0, 0), item(WED, 0, 0)]);
    expect(booked.status).toBe(201);
    const start = addDays(today(), 7);
    const before = await Session.find({ patientId: patient.id, date: { $lt: start } }).sort({ date: 1 });

    // a later Monday moved (Task 7's Move) to Tuesday afternoon on machine 2
    const mondayLater = nextWeekday(start, MON);
    const moved = (await Session.findOneAndUpdate(
      { patientId: patient.id, date: mondayLater },
      {
        $set: {
          date: addDays(mondayLater, 1),
          shiftId: s(1),
          chairId: m(1),
          chairLabel: '2',
          detached: true,
          movedFrom: { date: mondayLater, shiftId: s(0), chairId: m(0) },
        },
      },
      { new: true },
    ))!;
    // and a one-off booked separately in the changed range
    const oneOff = await agent
      .post(`${base}/patients/${patient.id}/plan`)
      .send({ items: [item(SUN, 1, 4)], from: start, repeat: 'once' });
    expect(oneOff.status).toBe(201);

    const res = await change(patient.id, { items: [item(TUE, 0, 3)], from: start });
    expect(res.status).toBe(200);
    expect(res.body.plan).toMatchObject({ from: start, to: null, items: [{ weekday: TUE, chairId: m(3), shiftId: s(0) }] });

    const plans = await Plan.find({ patientId: patient.id }).sort({ from: 1 });
    expect(plans.map((p) => [p.from, p.to])).toEqual([
      [today(), addDays(start, -1)],
      [start, null],
    ]);
    const kept = (await Session.findById(moved._id))!;
    expect(kept.toObject()).toMatchObject({ status: 'scheduled', detached: true, date: addDays(mondayLater, 1), chairLabel: '2' });
    expect(await Session.exists({ _id: oneOff.body.sessions[0].id })).not.toBeNull();

    const after = await Session.find({ patientId: patient.id, date: { $gte: start }, detached: false, kind: 'regular', planId: { $exists: true } });
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((x) => weekdayOf(x.date) === TUE && String(x.chairId) === m(3) && String(x.planId) === res.body.plan.id)).toBe(true);
    expect(await Session.find({ patientId: patient.id, date: { $lt: start } }).sort({ date: 1 })).toHaveLength(before.length);
    expect(await AuditEntry.countDocuments({ action: 'plan.change' })).toBe(1);
  });

  it('keeps a one-off the patient booked on their own plan slot beyond the generation window', async () => {
    const { centre, item, weekly, once, change } = await setup();
    const { patient } = await makePatient(centre.id);
    await weekly(patient.id, [item(MON, 0, 0)]);
    const far = await once(patient.id, [item(MON, 0, 0)], { from: addDays(today(), 21) });
    expect(far.status).toBe(201);
    expect((await Session.findById(far.body.sessions[0].id))!.oneOff).toBe(true);
    expect((await change(patient.id, { items: [item(TUE, 0, 0)], from: addDays(today(), 7) })).status).toBe(200);
    expect(await Session.exists({ _id: far.body.sessions[0].id })).not.toBeNull();
  });

  it('removes a legacy generated session (no planId, not a one-off) sitting on an old item', async () => {
    const { centre, item, weekly, change } = await setup();
    const { patient } = await makePatient(centre.id);
    await weekly(patient.id, [item(MON, 0, 0)]);
    const start = addDays(today(), 7);
    const monday = nextWeekday(start, MON);
    await Session.updateOne({ patientId: patient.id, date: monday }, { $unset: { planId: 1 } });
    expect((await change(patient.id, { items: [item(TUE, 0, 0)], from: start })).status).toBe(200);
    expect(await Session.exists({ patientId: patient.id, date: monday })).toBeNull();
  });

  it('frees the old slots from the change date for another patient', async () => {
    const { centre, item, weekly, change } = await setup();
    const a = await makePatient(centre.id);
    const b = await makePatient(centre.id);
    await weekly(a.patient.id, [item(MON, 0, 0)]);
    const start = addDays(today(), 7);
    expect((await change(a.patient.id, { items: [item(TUE, 0, 0)], from: start })).status).toBe(200);
    expect((await weekly(b.patient.id, [item(MON, 0, 0)], { from: start })).status).toBe(201);
  });

  it('into a taken slot → 409 and the old plan stays open with its sessions', async () => {
    const { centre, item, weekly, change } = await setup();
    const a = await makePatient(centre.id);
    const b = await makePatient(centre.id);
    await weekly(a.patient.id, [item(MON, 0, 0)]);
    await weekly(b.patient.id, [item(TUE, 1, 1)]);
    const sessionsBefore = await Session.countDocuments({ patientId: a.patient.id });
    const res = await change(a.patient.id, { items: [item(TUE, 1, 1)], from: today() });
    expect([res.status, res.body]).toEqual([409, { error: 'slot_taken' }]);
    const plans = await Plan.find({ patientId: a.patient.id });
    expect(plans.map((p) => p.to)).toEqual([null]);
    expect(await Session.countDocuments({ patientId: a.patient.id })).toBe(sessionsBefore);
  });

  it('from on or before the plan start replaces it; may reuse its own slots; no plan → 409 no_plan', async () => {
    const { centre, s, item, weekly, change } = await setup();
    const { patient } = await makePatient(centre.id);
    const none = await change(patient.id, { items: [item(MON, 0, 0)], from: today() });
    expect([none.status, none.body]).toEqual([409, { error: 'no_plan' }]);
    const start = addDays(today(), 3);
    await weekly(patient.id, [item(MON, 0, 0)], { from: start });
    const res = await change(patient.id, { items: [item(MON, 0, 0), item(MON, 1, 1)], from: start });
    expect(res.status).toBe(200);
    const plans = await Plan.find({ patientId: patient.id });
    expect(plans).toHaveLength(1);
    expect(plans[0]!.to).toBeNull();
    expect(plans[0]!.items).toHaveLength(2);
    expect(await Session.countDocuments({ patientId: patient.id, shiftId: s(1) })).toBeGreaterThan(0);
  });

  it('validates like booking', async () => {
    const { centre, item, weekly, change } = await setup();
    const { patient } = await makePatient(centre.id);
    await weekly(patient.id, [item(MON, 0, 0)]);
    expect((await change(patient.id, { items: [item(MON, 0, 0)], from: addDays(today(), -1) })).body.error).toBe('from_in_past');
    expect((await change(patient.id, { items: [item(FRI, 0, 0)], from: today() })).body.error).toBe('not_working_day');
    expect((await change(patient.id, { items: [], from: today() })).status).toBe(400);
    expect((await Plan.find({ patientId: patient.id })).map((p) => p.to)).toEqual([null]);
  });
});

describe('discharge ends the plan', () => {
  it('sets the plan end, drops later scheduled sessions, frees the slot from the next day; audited', async () => {
    const { centre, agent, base, item, weekly } = await setup(ALL_DAYS);
    const { patient } = await makePatient(centre.id);
    await weekly(patient.id, [item(MON, 0, 0), item(TUE, 0, 0), item(WED, 0, 0)]);
    const date = addDays(today(), 6); // a full week kept, a week dropped
    const res = await agent.post(`${base}/patients/${patient.id}/discharge`).send({ reason: 'transplant', date });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'discharged', discharge: { reason: 'transplant', date } });
    expect((await Plan.findOne({ patientId: patient.id }))!.to).toBe(date);
    expect(await Session.countDocuments({ patientId: patient.id, date: { $gt: date } })).toBe(0);
    expect(await Session.countDocuments({ patientId: patient.id, date: { $lte: date } })).toBeGreaterThan(0);
    expect(await AuditEntry.countDocuments({ action: 'patient.discharge' })).toBe(1);

    const other = await makePatient(centre.id);
    const next = await weekly(other.patient.id, [item(MON, 0, 0)], { from: addDays(date, 1) });
    expect(next.status).toBe(201);
    const again = await weekly(patient.id, [item(SUN, 1, 1)]);
    expect([again.status, again.body]).toEqual([409, { error: 'patient_not_active' }]);
  });

  it('a plan that has not started yet is removed; an end-dated plan running past the date is capped', async () => {
    const { centre, agent, base, item, weekly } = await setup(ALL_DAYS);
    const a = await makePatient(centre.id);
    await weekly(a.patient.id, [item(MON, 0, 0)], { from: addDays(today(), 5) });
    expect((await agent.post(`${base}/patients/${a.patient.id}/discharge`).send({ reason: 'moved', date: today() })).status).toBe(200);
    expect(await Plan.countDocuments({ patientId: a.patient.id })).toBe(0);
    expect(await Session.countDocuments({ patientId: a.patient.id })).toBe(0);

    const b = await makePatient(centre.id);
    await weekly(b.patient.id, [item(TUE, 0, 1)], { to: addDays(today(), 30) });
    const date = addDays(today(), 2);
    expect((await agent.post(`${base}/patients/${b.patient.id}/discharge`).send({ reason: 'moved', date })).status).toBe(200);
    expect((await Plan.findOne({ patientId: b.patient.id }))!.to).toBe(date);
  });

  it('validates reason and date; already discharged is 409', async () => {
    const { centre, agent, base } = await setup();
    const { patient } = await makePatient(centre.id);
    const url = `${base}/patients/${patient.id}/discharge`;
    expect((await agent.post(url).send({ reason: 'bogus', date: today() })).status).toBe(400);
    expect((await agent.post(url).send({ reason: 'moved' })).status).toBe(400);
    expect((await agent.post(url).send({ reason: 'moved', date: '18/10/2026' })).status).toBe(400);
    expect((await agent.post(url).send({ reason: 'moved', date: today() })).status).toBe(200);
    expect((await agent.post(url).send({ reason: 'moved', date: today() })).status).toBe(409);
  });
});

describe('free machines', () => {
  it('GET /schedule/free lists machines free for a block and date; patientId ignores that patient\'s holdings', async () => {
    const { centre, agent, base, s, item, weekly } = await setup();
    const { patient } = await makePatient(centre.id);
    await weekly(patient.id, [item(MON, 0, 1)]);
    const monday = nextWeekday(addDays(today(), 1), MON);
    const res = await agent.get(`${base}/schedule/free?date=${monday}&shiftId=${s(0)}`);
    expect(res.status).toBe(200);
    expect(res.body.map((x: { label: string }) => x.label)).toEqual(['1', '3', '4', '5', '6']);
    const mine = await agent.get(`${base}/schedule/free?date=${monday}&shiftId=${s(0)}&patientId=${patient.id}`);
    expect(mine.body.map((x: { label: string }) => x.label)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect((await agent.get(`${base}/schedule/free?date=nope&shiftId=${s(0)}`)).status).toBe(400);
    expect((await agent.get(`${base}/schedule/free?date=${monday}`)).status).toBe(400);
    const other = await makeCentre();
    expect((await agent.get(`${base}/schedule/free?date=${monday}&shiftId=${other.shifts[0]!.id}`)).status).toBe(404);
    const outsider = await staffIn(other.centre.id, ['nurse']);
    expect((await outsider.agent.get(`${base}/schedule/free?date=${monday}&shiftId=${s(0)}`)).status).toBe(403);
  });
});

describe('legacy grid (kept for the current client until the calendar replaces it)', () => {
  it('shows each held (machine, block, weekday) with its patient, from current plans', async () => {
    const { centre, chairs, shifts, agent, base, item, weekly, change } = await setup();
    const a = await makePatient(centre.id);
    const b = await makePatient(centre.id);
    const c = await makePatient(centre.id);
    await weekly(a.patient.id, [item(MON, 1, 2), item(WED, 0, 5)]);
    await weekly(b.patient.id, [item(SUN, 0, 0)]);
    expect((await change(b.patient.id, { items: [item(TUE, 0, 0)], from: addDays(today(), 7) })).status).toBe(200);
    await Plan.create({ centreId: centre.id, patientId: c.patient.id, items: [item(MON, 0, 3)], from: '2020-01-06', to: '2020-02-03' });

    const grid = await agent.get(`${base}/schedule/grid`);
    expect(grid.status).toBe(200);
    expect(grid.body.chairs).toHaveLength(6);
    expect(grid.body.shifts).toHaveLength(2);
    const slots = (grid.body.slots as { chairId: string; shiftId: string; weekday: number; patient: { id: string; name: string } }[])
      .map((x) => `${x.weekday}:${x.shiftId}:${x.chairId}:${x.patient.id}`)
      .sort();
    // b's plan in force today (Sunday, ending before the change) wins over the Tuesday plan starting next week
    expect(slots).toEqual(
      [
        `${MON}:${shifts[1]!.id}:${chairs[2]!.id}:${a.patient.id}`,
        `${WED}:${shifts[0]!.id}:${chairs[5]!.id}:${a.patient.id}`,
        `${SUN}:${shifts[0]!.id}:${chairs[0]!.id}:${b.patient.id}`,
      ].sort(),
    );
    expect(grid.body.slots.find((x: { patient: { id: string } }) => x.patient.id === a.patient.id).patient.name).toBe(a.patient.name);
  });

  it('the old pattern endpoints still book and change a weekly plan for the current client', async () => {
    const { centre, agent, base, s, m } = await setup();
    const { patient } = await makePatient(centre.id);
    const url = `${base}/patients/${patient.id}/pattern`;
    const created = await agent.post(url).send({ chairId: m(0), shiftId: s(0), weekdays: [MON, WED], from: today() });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ patientId: patient.id, chairId: m(0), shiftId: s(0), weekdays: [MON, WED], from: today(), to: null });
    const plan = (await Plan.findOne({ patientId: patient.id, to: null }))!;
    expect(plan.items.map((i) => i.weekday)).toEqual([MON, WED]);
    const changed = await agent.put(url).send({ chairId: m(1), shiftId: s(1), weekdays: [TUE], from: addDays(today(), 7) });
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({ chairId: m(1), shiftId: s(1), weekdays: [TUE] });
    expect((await agent.post(url).send({ chairId: m(0), shiftId: s(0), weekdays: [], from: today() })).status).toBe(400);
  });
});

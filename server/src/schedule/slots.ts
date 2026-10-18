/**
 * The single source of truth for "is this machine free in this session block on this date" (spec §10a rule 1).
 * Booking, Move, make-up, the free-machine list and the calendar must all ask here; nothing else decides it.
 *
 * A slot (machine × block × date) is taken when, for a patient other than `ignorePatientId`:
 *  1. a session with status scheduled | active | completed sits on it, or
 *  2. a weekly plan item holds it: same weekday, `from ≤ date`, `to` null or `≥ date`, and the date is a working
 *     day of the centre — unless that plan's patient released this one date, i.e. either
 *       a. the patient's session for (date, block) is postponed or cancelled, or
 *       b. a session of the patient was moved away from (date, block) (`movedFrom`),
 *     and unless the plan's patient now belongs to another centre (a plan left behind by a transfer holds nothing).
 *
 * Write paths that act on an answer from here must run inside a transaction and call `lockSlot` (or
 * `assertPlanItemsFree`, which does it) before reading, so two concurrent bookings of the same slot conflict.
 */
import mongoose, { type ClientSession, type Types } from 'mongoose';
import { DateTime } from 'luxon';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { addDays, weekdayOf } from '../lib/dates.js';
import { Centre } from '../centres/centre.model.js';
import { Chair } from '../centres/chair.model.js';
import { Shift } from '../centres/shift.model.js';
import { Patient } from '../patients/patient.model.js';
import { LIVE_STATUSES, Session } from '../sessions/session.model.js';
import { Plan, type PlanItem } from './plan.model.js';
import { CentreScheduleLock, SlotLock } from './slot-lock.model.js';

type Id = string | Types.ObjectId;

export interface SlotOpts {
  /** This patient's own sessions and plan never block them. A malformed id is treated as "ignore nobody". */
  ignorePatientId?: Id;
  /** Read inside the caller's transaction. */
  session?: ClientSession;
}

/** Statuses of a plan's own session that release its slot for that one date. */
const RELEASING_STATUSES = ['postponed', 'cancelled'] as const;

const validId = (id: unknown): id is Id => (typeof id === 'string' || id instanceof mongoose.Types.ObjectId) && mongoose.isValidObjectId(id);
const isDate = (d: unknown): d is string =>
  typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && DateTime.fromISO(d, { zone: 'utc' }).isValid;
const same = (a: unknown, b: unknown) => String(a) === String(b);

/** Bumps a lock row in the caller's transaction; a racing first-time upsert is retried like a write conflict. */
async function bump(model: typeof SlotLock | typeof CentreScheduleLock, key: object, session: ClientSession): Promise<void> {
  await model.init();
  try {
    await (model as typeof SlotLock).updateOne(key, { $inc: { rev: 1 } }, { upsert: true, session });
  } catch (e) {
    // two first-time upserts of the same key race on the unique index: make the loser retry like a write conflict
    if (e instanceof mongoose.mongo.MongoServerError && e.code === 11000) e.addErrorLabel('TransientTransactionError');
    throw e;
  }
}

/**
 * Write-locks the centre's schedule in the caller's transaction. Setup (`applySetup`) and every booking write
 * (plan, change, one-off, make-up, move) take it as their FIRST operation, so a setup change and a booking cannot
 * both commit on a stale view of each other: the loser write-conflicts and `withTransaction` retries it.
 */
export async function lockCentreSchedule(centreId: Id, session: ClientSession): Promise<void> {
  if (!session.inTransaction()) throw new Error('lockCentreSchedule must run inside a transaction');
  await bump(CentreScheduleLock, { centreId }, session);
}

/**
 * Write-locks (chair, shift, weekday) in the caller's transaction. Two transactions that lock the same key
 * write-conflict, and the loser is retried by `withTransaction`, re-reading the winner's booking. Call it
 * before `isSlotFree` in every write path (one-off, move, make-up); `assertPlanItemsFree` calls it itself.
 */
export async function lockSlot(chairId: Id, shiftId: Id, weekday: number, session: ClientSession): Promise<void> {
  if (!session.inTransaction()) throw new Error('lockSlot must run inside a transaction');
  await bump(SlotLock, { chairId, shiftId, weekday }, session);
}

/**
 * Of `patientIds`, those whose patient record now belongs to a centre other than `centreId` (transferred away).
 * Their plans filed under `centreId` hold nothing. An id without a patient record is not "departed".
 */
async function departedFrom(centreId: Id, patientIds: unknown[], session: ClientSession | null): Promise<Set<string>> {
  if (!patientIds.length) return new Set();
  const gone = await Patient.find({ _id: { $in: patientIds }, centreId: { $ne: centreId } }, { _id: 1 })
    .session(session)
    .lean();
  return new Set(gone.map((p) => String(p._id)));
}

/**
 * Machines held by a weekly plan for (shift, date), chair id -> holding patient id (rule 2 above, exceptions applied).
 * Assumes the date is a working day.
 */
export async function planHolds(centreId: Id, shiftId: Id, date: string, opts: SlotOpts = {}, chairId?: Id): Promise<Map<string, string>> {
  const session = opts.session ?? null;
  const notMe = validId(opts.ignorePatientId) ? { patientId: { $ne: opts.ignorePatientId } } : {};
  const onChair = chairId ? { chairId } : {};
  const holds = new Map<string, string>();
  const weekday = weekdayOf(date);
  const found = await Plan.find(
    {
      centreId,
      items: { $elemMatch: { weekday, shiftId, ...onChair } },
      from: { $lte: date },
      $or: [{ to: null }, { to: { $gte: date } }],
      ...notMe,
    },
    { patientId: 1, items: 1 },
  )
    .session(session)
    .lean();
  const departed = await departedFrom(centreId, found.map((p) => p.patientId), session);
  const plans = found.filter((p) => !departed.has(String(p.patientId)));
  if (!plans.length) return holds;

  // exceptions: the holder released this one date (postponed/cancelled there, or moved away from it)
  const released = await Session.find(
    {
      patientId: { $in: plans.map((p) => p.patientId) },
      $or: [
        { date, shiftId, status: { $in: [...RELEASING_STATUSES] } },
        { 'movedFrom.date': date, 'movedFrom.shiftId': shiftId },
      ],
    },
    { patientId: 1 },
  )
    .session(session)
    .lean();
  const releasedBy = new Set(released.map((s) => String(s.patientId)));

  for (const plan of plans) {
    if (releasedBy.has(String(plan.patientId))) continue;
    for (const item of plan.items) {
      if (item.weekday === weekday && same(item.shiftId, shiftId) && (!chairId || same(item.chairId, chairId))) {
        holds.set(String(item.chairId), String(plan.patientId));
      }
    }
  }
  return holds;
}

/** Chair ids taken for (shift, date), optionally only looking at one chair. Assumes the date is a working day. */
async function takenChairIds(centreId: Id, shiftId: Id, date: string, opts: SlotOpts, chairId?: Id): Promise<Set<string>> {
  const session = opts.session ?? null;
  const notMe = validId(opts.ignorePatientId) ? { patientId: { $ne: opts.ignorePatientId } } : {};
  const onChair = chairId ? { chairId } : {};
  const taken = new Set<string>();

  // rule 1: live sessions
  const live = await Session.find({ shiftId, date, status: { $in: [...LIVE_STATUSES] }, ...onChair, ...notMe }, { chairId: 1 })
    .session(session)
    .lean();
  for (const s of live) taken.add(String(s.chairId));

  // rule 2: weekly plan items covering the date
  for (const id of (await planHolds(centreId, shiftId, date, opts, chairId)).keys()) taken.add(id);
  return taken;
}

/**
 * Whether machine `chairId` is free in block `shiftId` on `date` for a booking by `ignorePatientId` (or anyone).
 * False as well when the date is not a working day, or the machine/block is unknown, inactive or in another centre.
 */
export async function isSlotFree(centreId: Id, chairId: Id, shiftId: Id, date: string, opts: SlotOpts = {}): Promise<boolean> {
  if (!validId(centreId) || !validId(chairId) || !validId(shiftId) || !isDate(date)) return false;
  const session = opts.session ?? null;
  // sequential on purpose: a transaction's session must not run operations in parallel
  const centre = await Centre.findById(centreId).session(session).lean();
  if (!centre || !centre.workingDays.includes(weekdayOf(date))) return false;
  const chair = await Chair.findById(chairId).session(session).lean();
  if (!chair || !same(chair.centreId, centreId) || !chair.active) return false;
  const shift = await Shift.findById(shiftId).session(session).lean();
  if (!shift || !same(shift.centreId, centreId) || !shift.active) return false;
  const taken = await takenChairIds(centreId, shiftId, date, opts, chairId);
  return !taken.has(String(chairId));
}

/**
 * Active machines of the centre free in block `shiftId` on `date`, in label order. Empty on a non-working day
 * or for an inactive block. 404 when the centre or block does not exist in this centre.
 */
export async function freeMachines(
  centreId: Id,
  shiftId: Id,
  date: string,
  opts: SlotOpts = {},
): Promise<{ id: string; label: string }[]> {
  if (!validId(centreId) || !validId(shiftId)) throw notFound();
  if (!isDate(date)) throw badRequest('invalid_date');
  const session = opts.session ?? null;
  const centre = await Centre.findById(centreId).session(session).lean();
  if (!centre) throw notFound();
  const shift = await Shift.findById(shiftId).session(session).lean();
  if (!shift || !same(shift.centreId, centreId)) throw notFound();
  if (!shift.active || !centre.workingDays.includes(weekdayOf(date))) return [];
  const chairs = await Chair.find({ centreId, active: true }).session(session).lean();
  const taken = await takenChairIds(centreId, shiftId, date, opts);
  return chairs
    .filter((c) => !taken.has(String(c._id)))
    .map((c) => ({ id: String(c._id), label: c.label }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}

/** First date on or after `date` that falls on `weekday`. */
export function firstOnOrAfter(date: string, weekday: number): string {
  return addDays(date, (weekday - weekdayOf(date) + 7) % 7);
}

type ChairLean = { _id: Types.ObjectId; label: string };
type ShiftLean = { _id: Types.ObjectId; start: string; end: string };
export interface ValidatedItem {
  weekday: number;
  chair: ChairLean;
  shift: ShiftLean;
}

/**
 * Checks plan/booking items against the centre's setup, in item order:
 *  - 404 for an unknown centre, or a machine/block that is not in the centre;
 *  - 400 `not_working_day` when an item's weekday is not a working day of the centre;
 *  - 400 `inactive_chair` / `inactive_shift`.
 * Returns each item's machine and block (for snapshots).
 */
export async function validatePlanItems(centreId: Id, items: PlanItem[], session: ClientSession | null = null): Promise<ValidatedItem[]> {
  const centre = validId(centreId) ? await Centre.findById(centreId).session(session).lean() : null;
  if (!centre) throw notFound();
  const out: ValidatedItem[] = [];
  for (const item of items) {
    if (!centre.workingDays.includes(item.weekday)) throw badRequest('not_working_day');
    const chair = validId(item.chairId) ? await Chair.findById(item.chairId).session(session).lean() : null;
    if (!chair || !same(chair.centreId, centreId)) throw notFound();
    const shift = validId(item.shiftId) ? await Shift.findById(item.shiftId).session(session).lean() : null;
    if (!shift || !same(shift.centreId, centreId)) throw notFound();
    if (!chair.active) throw badRequest('inactive_chair');
    if (!shift.active) throw badRequest('inactive_shift');
    out.push({ weekday: item.weekday, chair, shift });
  }
  return out;
}

/** Lock key order: every writer takes locks in this one order. */
const lockKey = (i: PlanItem) => `${String(i.chairId)}:${String(i.shiftId)}:${i.weekday}`;

/** Locks each item's (chair, shift, weekday) in `chairId:shiftId:weekday` order. */
export async function lockSlots(items: PlanItem[], session: ClientSession): Promise<void> {
  const sorted = [...items].sort((a, b) => (lockKey(a) < lockKey(b) ? -1 : lockKey(a) > lockKey(b) ? 1 : 0));
  for (const item of sorted) await lockSlot(item.chairId, item.shiftId, item.weekday, session);
}

/**
 * Refuses a weekly plan for `patientId` holding `items` from `from` to `to` (null = open) unless every item's
 * (chair, shift, weekday) is free over the whole range:
 *  - 400 `invalid_date` / `invalid_range` for a malformed or inverted range;
 *  - the `validatePlanItems` errors (404, `not_working_day`, `inactive_chair`, `inactive_shift`);
 *  - 409 `slot_taken` when another patient's plan item (in this centre) on the same (chair, shift, weekday)
 *    shares at least one such weekday with the range, or another patient has a scheduled/active/completed
 *    session on that chair and block on a matching weekday within the range — unless `patientId` released that
 *    date on this chair and block (its own session there is postponed/cancelled, or was moved away from it).
 * Runs inside the caller's transaction and locks each item's slot first, so concurrent bookings serialise.
 */
export async function assertPlanItemsFree(
  centreId: Id,
  items: PlanItem[],
  from: string,
  to: string | null,
  patientId: Id,
  session: ClientSession,
): Promise<void> {
  if (!isDate(from) || (to !== null && !isDate(to))) throw badRequest('invalid_date');
  if (to !== null && to < from) throw badRequest('invalid_range');
  await validatePlanItems(centreId, items, session);
  await lockSlots(items, session);

  for (const { chairId, shiftId, weekday } of items) {
    const plans = await Plan.find(
      {
        centreId,
        patientId: { $ne: patientId },
        items: { $elemMatch: { chairId, shiftId, weekday } },
        $or: [{ to: null }, { to: { $gte: from } }],
        ...(to !== null ? { from: { $lte: to } } : {}),
      },
      { patientId: 1, from: 1, to: 1 },
    )
      .session(session)
      .lean();
    const departed = await departedFrom(centreId, plans.map((p) => p.patientId), session);
    for (const p of plans) {
      if (departed.has(String(p.patientId))) continue;
      const lo = p.from > from ? p.from : from;
      const hi = p.to === null || p.to === undefined ? to : to === null || p.to < to ? p.to : to;
      if (hi === null || firstOnOrAfter(lo, weekday) <= hi) throw conflict('slot_taken');
    }

    const range = to === null ? { $gte: from } : { $gte: from, $lte: to };
    const sessions = await Session.find(
      { patientId: { $ne: patientId }, chairId, shiftId, status: { $in: [...LIVE_STATUSES] }, date: range },
      { date: 1 },
    )
      .session(session)
      .lean();
    const clashes = sessions.filter((s) => weekdayOf(s.date) === weekday);
    if (!clashes.length) continue;
    // a date the booking patient released on this machine and block (postponed/cancelled there, or moved away)
    // was free for the other patient to take; it does not hold against the patient's own plan
    const released = await Session.find(
      {
        patientId,
        $or: [
          { chairId, shiftId, status: { $in: [...RELEASING_STATUSES] }, date: range },
          { 'movedFrom.chairId': chairId, 'movedFrom.shiftId': shiftId, 'movedFrom.date': range },
        ],
      },
      { date: 1, chairId: 1, shiftId: 1, status: 1, movedFrom: 1 },
    )
      .session(session)
      .lean();
    const releasedDates = new Set<string>();
    for (const r of released) {
      const here = same(r.chairId, chairId) && same(r.shiftId, shiftId);
      if (here && (RELEASING_STATUSES as readonly string[]).includes(r.status)) releasedDates.add(r.date);
      if (r.movedFrom && same(r.movedFrom.chairId, chairId) && same(r.movedFrom.shiftId, shiftId)) releasedDates.add(r.movedFrom.date);
    }
    if (clashes.some((s) => !releasedDates.has(s.date))) throw conflict('slot_taken');
  }
}

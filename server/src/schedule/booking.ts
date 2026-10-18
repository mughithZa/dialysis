import mongoose, { type ClientSession, type Types } from 'mongoose';
import { withTransaction } from '../db.js';
import { badRequest, conflict } from '../lib/errors.js';
import { addDays, todayLocal, weekdayOf } from '../lib/dates.js';
import { loadPatientInCentre } from '../patients/load.js';
import type { PatientDoc } from '../patients/patient.model.js';
import { Session, type SessionDoc } from '../sessions/session.model.js';
import { Plan, type PlanDoc } from './plan.model.js';
import { PatientPlanLock } from './slot-lock.model.js';
import { assertPlanItemsFree, firstOnOrAfter, isSlotFree, lockSlots, validatePlanItems } from './slots.js';
import { deleteScheduledSessionsAfter, regenerateSessions } from './generate.js';

/** One day row of a booking: machine `chairId` in session block `shiftId` on `weekday` (0=Sunday … 6=Saturday). */
export interface PlanItemInput {
  weekday: number;
  shiftId: string;
  chairId: string;
}
export interface BookInput {
  items: PlanItemInput[];
  from: string;
  /** `once`: each row's next occurrence on or after `from`; `weekly`: a plan from `from` to `to` (null = open). */
  repeat: 'once' | 'weekly';
  to?: string | null;
}
export interface ChangeInput {
  items: PlanItemInput[];
  from: string;
  to?: string | null;
}
export type BookResult = { plan: PlanDoc } | { sessions: SessionDoc[] };
type Audit<T> = (result: T, session: ClientSession) => Promise<void>;

const isDuplicateKey = (e: unknown) => (e as { code?: number }).code === 11000;
const keyOf = (e: unknown) => (e as { keyPattern?: Record<string, unknown> }).keyPattern ?? {};

/** Plans of the patient that still hold on or after `date` (open, or ending on/after it). */
const holdingFrom = (patientId: Types.ObjectId | string, date: string) => ({
  patientId,
  $or: [{ to: null }, { to: { $gte: date } }],
});

/**
 * Write-locks the patient's plans in the caller's transaction: concurrent plan writes for one patient conflict and
 * the loser is retried by `withTransaction`, re-reading the winner's plan. Take it first, before any plan read.
 */
export async function lockPatientPlans(patientId: Types.ObjectId | string, session: ClientSession): Promise<void> {
  await PatientPlanLock.init();
  try {
    await PatientPlanLock.updateOne({ patientId }, { $inc: { rev: 1 } }, { upsert: true, session });
  } catch (e) {
    // two first-time upserts race on the unique index: retry the loser like a write conflict
    if (e instanceof mongoose.mongo.MongoServerError && e.code === 11000) e.addErrorLabel('TransientTransactionError');
    throw e;
  }
}

/** Patient of this centre who may be booked (409 otherwise) for a range starting today or later. */
async function loadBookable(centreId: string, patientId: string, input: { from: string; to?: string | null }): Promise<PatientDoc> {
  const patient = await loadPatientInCentre(centreId, patientId);
  if (patient.status === 'transferring') throw conflict('transfer_pending');
  if (patient.status !== 'active') throw conflict('patient_not_active');
  if (input.from < todayLocal()) throw badRequest('from_in_past');
  if (input.to != null && input.to < input.from) throw badRequest('invalid_range');
  return patient;
}

/** Inserts a weekly plan inside the transaction, after checking its slots are free over its whole range. */
async function insertPlan(
  centreId: string,
  patient: PatientDoc,
  input: ChangeInput,
  session: ClientSession,
): Promise<PlanDoc> {
  await assertPlanItemsFree(centreId, input.items, input.from, input.to ?? null, patient._id, session);
  try {
    const [plan] = await Plan.create(
      [{ centreId, patientId: patient._id, items: input.items, from: input.from, to: input.to ?? null, repeat: 'weekly' }],
      { session },
    );
    return plan!;
  } catch (e) {
    if (isDuplicateKey(e)) throw conflict('already_booked'); // the one-open-plan index
    throw e;
  }
}

/**
 * One-off: one `scheduled` regular session per item on its first date ≥ `from`, all in one transaction. Each
 * slot is locked and checked with `isSlotFree`, so a concurrent plan booking or one-off of it conflicts.
 */
async function bookOnce(
  centreId: string,
  patient: PatientDoc,
  input: BookInput,
  audit?: Audit<BookResult>,
): Promise<SessionDoc[]> {
  return withTransaction(async (session) => {
    const valid = await validatePlanItems(centreId, input.items, session);
    await lockSlots(input.items, session);
    const docs = [];
    for (const { weekday, chair, shift } of valid) {
      const date = firstOnOrAfter(input.from, weekday);
      if (!(await isSlotFree(centreId, chair._id, shift._id, date, { session, ignorePatientId: patient._id }))) {
        throw conflict('slot_taken');
      }
      docs.push({
        centreId,
        patientId: patient._id,
        date,
        chairId: chair._id,
        shiftId: shift._id,
        shiftStart: shift.start,
        shiftEnd: shift.end,
        chairLabel: chair.label,
        kind: 'regular' as const,
        status: 'scheduled' as const,
        oneOff: true,
      });
    }
    let sessions: SessionDoc[];
    try {
      sessions = await Session.create(docs, { session, ordered: true });
    } catch (e) {
      if (isDuplicateKey(e)) throw conflict('patientId' in keyOf(e) ? 'session_exists' : 'slot_taken');
      throw e;
    }
    await audit?.({ sessions }, session);
    return sessions;
  });
}

/**
 * Books a patient: `repeat: 'once'` creates the sessions directly (allowed alongside an open plan) and returns
 * `{sessions}`; `repeat: 'weekly'` creates a plan (409 `already_booked` if one already holds from `from`),
 * generates its sessions and returns `{plan}`.
 */
export async function bookPlan(
  centreId: string,
  patientId: string,
  input: BookInput,
  audit?: Audit<BookResult>,
): Promise<BookResult> {
  const patient = await loadBookable(centreId, patientId, input);
  if (input.repeat === 'once') return { sessions: await bookOnce(centreId, patient, input, audit) };

  const plan = await withTransaction(async (session) => {
    await lockPatientPlans(patient._id, session);
    if (await Plan.exists(holdingFrom(patient._id, input.from)).session(session)) throw conflict('already_booked');
    const created = await insertPlan(centreId, patient, input, session);
    await audit?.({ plan: created }, session);
    return created;
  });
  await regenerateSessions(patient.id);
  return { plan };
}

/**
 * Deletes the patient's future scheduled sessions that belong to `plans` from `from` on: those generated from
 * them, plus legacy generated sessions (neither `planId` nor `oneOff`) sitting on one of their items. Detached
 * (moved) sessions, make-ups and one-offs (`oneOff: true`) are always kept.
 */
async function deletePlanSessionsFrom(
  patientId: Types.ObjectId,
  plans: PlanDoc[],
  from: string,
  session: ClientSession,
): Promise<void> {
  const planIds = new Set(plans.map((p) => String(p._id)));
  const itemKeys = new Set(plans.flatMap((p) => p.items.map((i) => `${i.weekday}:${String(i.shiftId)}:${String(i.chairId)}`)));
  const candidates = await Session.find(
    { patientId, status: 'scheduled', detached: { $ne: true }, oneOff: { $ne: true }, kind: 'regular', date: { $gte: from } },
    { planId: 1, date: 1, shiftId: 1, chairId: 1 },
  )
    .session(session)
    .lean();
  const doomed = candidates.filter((s) =>
    s.planId ? planIds.has(String(s.planId)) : itemKeys.has(`${weekdayOf(s.date)}:${String(s.shiftId)}:${String(s.chairId)}`),
  );
  if (doomed.length) await Session.deleteMany({ _id: { $in: doomed.map((s) => s._id) } }, { session });
}

/**
 * Changes the weekly plan from `input.from`: the current plan ends the day before (or is replaced when it had
 * not started by then), its scheduled sessions from that date go (moved/detached ones, make-ups and one-offs
 * stay), and the new plan is booked and generated — atomically, so a taken slot leaves everything as it was.
 */
export async function changePlan(
  centreId: string,
  patientId: string,
  input: ChangeInput,
  audit?: Audit<PlanDoc>,
): Promise<PlanDoc> {
  const patient = await loadBookable(centreId, patientId, input);
  const plan = await withTransaction(async (session) => {
    await lockPatientPlans(patient._id, session);
    const current = await Plan.find(holdingFrom(patient._id, input.from)).session(session);
    if (!current.length) throw conflict('no_plan');
    const lastDay = addDays(input.from, -1);
    for (const p of current) {
      if (p.from >= input.from) {
        await p.deleteOne({ session }); // never took effect: replace rather than invert the range
      } else {
        p.to = lastDay;
        await p.save({ session });
      }
    }
    await deletePlanSessionsFrom(patient._id, current, input.from, session);
    const created = await insertPlan(centreId, patient, input, session);
    await audit?.(created, session);
    return created;
  });
  await regenerateSessions(patient.id);
  return plan;
}

/**
 * Ends the patient's plans on `lastDate` (discharge, transfer): a plan holding past it is capped there, one
 * that would only start later is removed. Every scheduled session after `lastDate` goes, moved ones included:
 * the patient is leaving the centre's care.
 */
export async function endPlans(patientId: string, lastDate: string, session: ClientSession): Promise<void> {
  await lockPatientPlans(patientId, session);
  const plans = await Plan.find({ patientId, $or: [{ to: null }, { to: { $gt: lastDate } }] }).session(session);
  for (const p of plans) {
    if (p.from > lastDate) {
      await p.deleteOne({ session });
    } else {
      p.to = lastDate;
      await p.save({ session });
    }
  }
  await deleteScheduledSessionsAfter(patientId, lastDate, session);
}

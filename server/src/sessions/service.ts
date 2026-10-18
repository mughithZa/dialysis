import mongoose, { type ClientSession } from 'mongoose';
import { withTransaction } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { addDays, todayLocal, weekdayOf } from '../lib/dates.js';
import { Centre } from '../centres/centre.model.js';
import { Chair } from '../centres/chair.model.js';
import { Shift } from '../centres/shift.model.js';
import { Patient } from '../patients/patient.model.js';
import { loadPatientInCentre } from '../patients/load.js';
import { isSlotFree, lockCentreSchedule, lockSlot } from '../schedule/slots.js';
import { nurseFor } from '../schedule/roster.js';
import { SessionChange, type ChangeKind } from './change.model.js';
import { Session, type SessionDoc } from './session.model.js';

export const MAKEUP_WINDOW_DAYS = 3;

const validId = (id: unknown): id is string => typeof id === 'string' && mongoose.isValidObjectId(id);

/** Loads a session of this centre; a missing id or a session of another centre is 404. */
export async function loadSessionInCentre(centreId: string, sid: unknown): Promise<SessionDoc> {
  const session = validId(sid) ? await Session.findById(sid) : null;
  if (!session || String(session.centreId) !== String(centreId)) throw notFound();
  // a transferred patient's old sessions stay in the old centre's records but are no longer reachable there
  if (!(await Patient.exists({ _id: session.patientId, centreId }))) throw notFound();
  return session;
}

/**
 * Single status check for usage, vitals and notes writes. `active` needs the route's own permission
 * (`activePerm`); `completed` needs `sessions.editClosed` alone (not the record permission) and its edits are written to the change history
 * (returns true); any other status is 409 `bad_status`.
 */
export function assertRecordable(session: SessionDoc, perms: ReadonlySet<string>, activePerm: string): boolean {
  if (session.status === 'active') {
    if (!perms.has(activePerm)) throw forbidden();
    return false;
  }
  if (session.status !== 'completed') throw conflict('bad_status');
  if (!perms.has('sessions.editClosed')) throw forbidden();
  return true;
}

/**
 * Runs `fn` in a transaction after re-checking the session status inside it. The guarded `$inc`
 * makes a concurrent close/postpone conflict with this transaction, so a write can never slip
 * into a session whose status changed without passing the closed-session rules.
 */
export async function withRecordable<T>(
  sessionId: string,
  perms: ReadonlySet<string>,
  activePerm: string,
  fn: (tx: ClientSession, session: SessionDoc, closed: boolean) => Promise<T>,
): Promise<T> {
  return withTransaction(async (tx) => {
    const fresh = await Session.findOneAndUpdate(
      { _id: sessionId, status: { $in: ['active', 'completed'] } },
      { $inc: { rev: 1 } },
      { new: true, session: tx },
    );
    if (!fresh) throw conflict('bad_status');
    return fn(tx, fresh, assertRecordable(fresh, perms, activePerm));
  });
}

export async function recordChange(
  tx: ClientSession,
  sessionId: string,
  by: unknown,
  kind: ChangeKind,
  before: object | null,
  after: object | null,
): Promise<void> {
  await SessionChange.create([{ sessionId, by, kind, before, after }], { session: tx });
}

/** Moves a session between statuses atomically: fails with 409 `bad_status` if it is not in one of `from`. */
export async function transition(
  sessionId: string,
  from: SessionDoc['status'][],
  set: Record<string, unknown>,
  tx?: ClientSession,
): Promise<SessionDoc> {
  const updated = await Session.findOneAndUpdate(
    { _id: sessionId, status: { $in: from } },
    { $set: set },
    { new: true, session: tx },
  );
  if (!updated) throw conflict('bad_status');
  return updated;
}

export async function openSession(session: SessionDoc, userId: string, tx?: ClientSession): Promise<SessionDoc> {
  if (session.status !== 'scheduled') throw conflict('bad_status');
  if (session.date !== todayLocal()) throw conflict('not_today');
  return transition(session.id, ['scheduled'], { status: 'active', openedAt: new Date(), openedBy: userId, runBy: userId }, tx);
}

export async function closeSession(session: SessionDoc, userId: string, tx?: ClientSession): Promise<SessionDoc> {
  const closed = await transition(session.id, ['active'], { status: 'completed', closedAt: new Date(), closedBy: userId }, tx);
  await finaliseSnapshot(closed, tx);
  return closed;
}

export async function postponeSession(session: SessionDoc, tx?: ClientSession): Promise<SessionDoc> {
  const postponed = await transition(session.id, ['scheduled', 'missed'], { status: 'postponed' }, tx);
  await finaliseSnapshot(postponed, tx);
  return postponed;
}

/** Records that the patient did not come: from `scheduled` or `missed`, never for a future date. Snapshot is atomic with the status. */
export async function didNotCome(session: SessionDoc, reason: string | undefined, tx: ClientSession): Promise<SessionDoc> {
  if (session.date > todayLocal()) throw conflict('not_yet');
  const updated = await transition(
    session.id,
    ['scheduled', 'missed'],
    { status: 'did_not_come', ...(reason ? { statusReason: reason } : {}) },
    tx,
  );
  await finaliseSnapshot(updated, tx);
  return updated;
}

export async function cancelSession(session: SessionDoc, reason: string, tx: ClientSession): Promise<SessionDoc> {
  const updated = await transition(session.id, ['scheduled'], { status: 'cancelled', statusReason: reason }, tx);
  await finaliseSnapshot(updated, tx);
  return updated;
}

export interface MoveInput {
  date: string;
  chairId: string;
  shiftId: string;
}

/**
 * Moves one scheduled session to another free slot (today or later), detaching it from its plan. Runs in the caller's
 * transaction: locks the target slot, then asks `isSlotFree` (the patient's own slot never blocks them). `movedFrom`
 * keeps the FIRST original slot across re-moves, so regeneration never recreates it.
 */
export async function moveSession(centreId: string, sessionId: string, input: MoveInput, tx: ClientSession): Promise<SessionDoc> {
  if (input.date < todayLocal()) throw badRequest('move_in_past');
  await lockCentreSchedule(centreId, tx);
  const current = await Session.findById(sessionId, null, { session: tx });
  if (!current || String(current.centreId) !== String(centreId)) throw notFound();
  if (current.status !== 'scheduled') throw conflict('bad_status');
  const chair = validId(input.chairId) ? await Chair.findById(input.chairId, null, { session: tx }) : null;
  if (!chair || String(chair.centreId) !== String(centreId)) throw notFound();
  const shift = validId(input.shiftId) ? await Shift.findById(input.shiftId, null, { session: tx }) : null;
  if (!shift || String(shift.centreId) !== String(centreId)) throw notFound();
  if (!chair.active) throw badRequest('inactive_chair');
  if (!shift.active) throw badRequest('inactive_shift');
  const centre = await Centre.findById(centreId, null, { session: tx });
  if (!centre?.workingDays.includes(weekdayOf(input.date))) throw badRequest('not_working_day');
  if (
    current.date === input.date &&
    String(current.shiftId) === String(shift._id) &&
    String(current.chairId) === String(chair._id)
  ) {
    throw badRequest('same_slot');
  }

  await lockSlot(chair._id, shift._id, weekdayOf(input.date), tx);
  if (!(await isSlotFree(centreId, chair._id, shift._id, input.date, { session: tx, ignorePatientId: current.patientId }))) {
    throw conflict('slot_taken');
  }
  const set: Record<string, unknown> = {
    date: input.date,
    shiftId: shift._id,
    chairId: chair._id,
    shiftStart: shift.start,
    shiftEnd: shift.end,
    chairLabel: chair.label,
    detached: true,
  };
  if (!current.movedFrom) set.movedFrom = { date: current.date, shiftId: current.shiftId, chairId: current.chairId };
  try {
    return await transition(current.id, ['scheduled'], set, tx);
  } catch (e) {
    if ((e as { code?: number }).code === 11000) throw conflict('session_exists');
    throw e;
  }
}

export interface MakeupInput {
  date: string;
  chairId: string;
  shiftId: string;
}

/**
 * Creates a make-up session for an active patient within today..today+3 on a free machine/block. "Free" is
 * `isSlotFree` (so a plan-held slot is refused unless its holder released that date), checked after locking the
 * slot inside the transaction so a concurrent booking of it conflicts.
 */
export async function createMakeup(centreId: string, patientId: string, input: MakeupInput): Promise<SessionDoc> {
  const patient = await loadPatientInCentre(centreId, patientId);
  const today = todayLocal();
  if (input.date < today || input.date > addDays(today, MAKEUP_WINDOW_DAYS)) throw badRequest('makeup_out_of_window');
  if (patient.status !== 'active') throw conflict('patient_not_active');
  const chair = validId(input.chairId) ? await Chair.findById(input.chairId) : null;
  if (!chair || String(chair.centreId) !== String(centreId)) throw notFound();
  const shift = validId(input.shiftId) ? await Shift.findById(input.shiftId) : null;
  if (!shift || String(shift.centreId) !== String(centreId)) throw notFound();
  if (!chair.active) throw badRequest('inactive_chair');
  if (!shift.active) throw badRequest('inactive_shift');
  const centre = await Centre.findById(centreId);
  if (!centre?.workingDays.includes(weekdayOf(input.date))) throw badRequest('not_working_day');

  return withTransaction(async (tx) => {
    await lockCentreSchedule(centreId, tx);
    await lockSlot(chair._id, shift._id, weekdayOf(input.date), tx);
    if (!(await isSlotFree(centreId, chair._id, shift._id, input.date, { session: tx, ignorePatientId: patient._id }))) {
      throw conflict('slot_busy');
    }
    try {
      const [created] = await Session.create(
        [
          {
            centreId,
            patientId: patient._id,
            date: input.date,
            chairId: chair._id,
            shiftId: shift._id,
            shiftStart: shift.start,
            shiftEnd: shift.end,
            chairLabel: chair.label,
            kind: 'makeup',
          },
        ],
        { session: tx },
      );
      return created!;
    } catch (e) {
      if ((e as { code?: number }).code === 11000) throw conflict('session_exists');
      throw e;
    }
  });
}

/**
 * Freezes who covered a session when it reaches a final status: stores `rosterNurseId` from the roster, only if not
 * already set. Nothing is stored when nobody was rostered.
 */
export async function finaliseSnapshot(session: SessionDoc, tx?: ClientSession): Promise<void> {
  if (session.rosterNurseId) return;
  const nurseId = await nurseFor(String(session.centreId), session.date, String(session.shiftId), String(session.chairId));
  if (!nurseId) return;
  await Session.updateOne(
    { _id: session._id, rosterNurseId: { $exists: false } },
    { $set: { rosterNurseId: nurseId } },
    { session: tx },
  );
  session.rosterNurseId = new mongoose.Types.ObjectId(nurseId);
}

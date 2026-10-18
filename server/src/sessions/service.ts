import mongoose, { type ClientSession } from 'mongoose';
import { withTransaction } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { addDays, todayLocal, weekdayOf } from '../lib/dates.js';
import { Chair } from '../centres/chair.model.js';
import { Shift } from '../centres/shift.model.js';
import { Patient } from '../patients/patient.model.js';
import { loadPatientInCentre } from '../patients/load.js';
import { Pattern } from '../schedule/pattern.model.js';
import { Slot } from '../schedule/slot.model.js';
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
 * Single status check for usage, vitals and notes writes. `active` is open for recording;
 * `completed` needs `sessions.editClosed` and its edits are written to the change history
 * (returns true); any other status is 409 `bad_status`.
 */
export function assertRecordable(session: SessionDoc, perms: ReadonlySet<string>): boolean {
  if (session.status === 'active') return false;
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
  fn: (tx: ClientSession, session: SessionDoc, closed: boolean) => Promise<T>,
): Promise<T> {
  return withTransaction(async (tx) => {
    const fresh = await Session.findOneAndUpdate(
      { _id: sessionId, status: { $in: ['active', 'completed'] } },
      { $inc: { rev: 1 } },
      { new: true, session: tx },
    );
    if (!fresh) throw conflict('bad_status');
    return fn(tx, fresh, assertRecordable(fresh, perms));
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
  return transition(session.id, ['scheduled'], { status: 'active', openedAt: new Date(), openedBy: userId }, tx);
}

export const closeSession = (session: SessionDoc, userId: string, tx?: ClientSession) =>
  transition(session.id, ['active'], { status: 'completed', closedAt: new Date(), closedBy: userId }, tx);

export const postponeSession = (session: SessionDoc, tx?: ClientSession) =>
  transition(session.id, ['scheduled', 'missed'], { status: 'postponed' }, tx);

export interface MakeupInput {
  date: string;
  chairId: string;
  shiftId: string;
}

/** Creates a make-up session for an active patient within today..today+3 on a free chair/shift. */
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

  const occupied = await Session.exists({
    chairId: chair._id,
    shiftId: shift._id,
    date: input.date,
    status: { $ne: 'postponed' },
  });
  if (occupied) throw conflict('slot_busy');
  const held = await Slot.findOne({ chairId: chair._id, shiftId: shift._id, weekday: weekdayOf(input.date) });
  if (held) {
    const pattern = await Pattern.findById(held.patternId);
    if (!pattern || String(pattern.patientId) !== String(patient._id)) throw conflict('slot_busy');
  }
  try {
    return await Session.create({
      centreId,
      patientId: patient._id,
      date: input.date,
      chairId: chair._id,
      shiftId: shift._id,
      kind: 'makeup',
    });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) throw conflict('session_exists');
    throw e;
  }
}

import mongoose, { type ClientSession } from 'mongoose';
import { conflict, notFound } from '../lib/errors.js';
import { todayLocal } from '../lib/dates.js';
import { Order } from '../orders/order.model.js';
import { Patient } from '../patients/patient.model.js';
import { endPatterns } from '../schedule/booking.js';
import { Session } from '../sessions/session.model.js';
import { Transfer, type TransferDoc } from './transfer.model.js';

/** Loads a transfer; `side` is the centre the caller must be (else 404, never revealing existence). */
export async function loadTransfer(centreId: string, transferId: unknown, side: 'from' | 'to'): Promise<TransferDoc> {
  const t =
    typeof transferId === 'string' && mongoose.isValidObjectId(transferId) ? await Transfer.findById(transferId) : null;
  const owner = t && (side === 'from' ? t.fromCentreId : t.toCentreId);
  if (!t || String(owner) !== String(centreId)) throw notFound();
  return t;
}

/** Atomically moves a pending transfer to `status`; 409 `not_pending` if somebody got there first. */
export async function decide(
  t: TransferDoc,
  status: 'accepted' | 'rejected' | 'cancelled',
  userId: unknown,
  session: ClientSession,
  extra: { rejectReason?: string } = {},
): Promise<void> {
  const done = await Transfer.findOneAndUpdate(
    { _id: t._id, status: 'pending' },
    { $set: { status, decidedBy: userId, decidedAt: new Date(), ...extra } },
    { session },
  );
  if (!done) throw conflict('not_pending');
}

/** Hands the patient over to the target centre; run inside the accept transaction. */
export async function moveToTarget(t: TransferDoc, session: ClientSession): Promise<void> {
  const today = todayLocal();
  if (await Session.exists({ patientId: t.patientId, status: 'active' }).session(session)) throw conflict('session_active');
  await endPatterns(String(t.patientId), today, session);
  // endPatterns keeps sessions up to and including today; today's still-scheduled one goes too
  await Session.deleteMany({ patientId: t.patientId, status: 'scheduled', date: { $gte: today } }, { session });
  const moved = await Patient.updateOne(
    { _id: t.patientId, centreId: t.fromCentreId, status: 'transferring' },
    { $set: { centreId: t.toCentreId, status: 'active' } },
    { session },
  );
  if (!moved.modifiedCount) throw conflict('patient_not_transferring');
  await Order.updateMany({ patientId: t.patientId, status: 'active' }, { $set: { centreId: t.toCentreId } }, { session });
}

import mongoose, { type ClientSession } from 'mongoose';
import { withTransaction } from '../db.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { addDays, todayLocal } from '../lib/dates.js';
import { Chair } from '../centres/chair.model.js';
import { Shift } from '../centres/shift.model.js';
import { loadPatientInCentre } from '../patients/load.js';
import { Pattern, type PatternDoc } from './pattern.model.js';
import { Slot } from './slot.model.js';
import { deleteScheduledSessionsAfter, regenerateSessions } from './generate.js';

export interface PatternInput {
  chairId: string;
  shiftId: string;
  weekdays: number[];
  from: string;
}
export interface BookInput extends PatternInput {
  patientId: string;
}

const isDuplicateKey = (e: unknown) => (e as { code?: number }).code === 11000;
const validId = (id: unknown): id is string => typeof id === 'string' && mongoose.isValidObjectId(id);

/** Chair and shift must belong to the centre (else 404) and be active (else 400). */
async function checkChairAndShift(centreId: string, input: PatternInput): Promise<void> {
  const chair = validId(input.chairId) ? await Chair.findById(input.chairId) : null;
  if (!chair || String(chair.centreId) !== String(centreId)) throw notFound();
  const shift = validId(input.shiftId) ? await Shift.findById(input.shiftId) : null;
  if (!shift || String(shift.centreId) !== String(centreId)) throw notFound();
  if (!chair.active) throw badRequest('inactive_chair');
  if (!shift.active) throw badRequest('inactive_shift');
  if (input.from < todayLocal()) throw badRequest('from_in_past');
}

async function insertPattern(
  centreId: string,
  patientId: string,
  input: PatternInput,
  session: ClientSession,
): Promise<PatternDoc> {
  try {
    await Slot.init(); // the unique index must exist before inserts can race
    const [pattern] = await Pattern.create(
      [{ centreId, patientId, chairId: input.chairId, shiftId: input.shiftId, weekdays: input.weekdays, from: input.from }],
      { session },
    );
    await Slot.create(
      input.weekdays.map((weekday) => ({
        centreId,
        chairId: input.chairId,
        shiftId: input.shiftId,
        weekday,
        patternId: pattern!._id,
      })),
      { session, ordered: true },
    );
    return pattern!;
  } catch (e) {
    if (isDuplicateKey(e)) throw conflict('slot_taken');
    throw e;
  }
}

export async function bookPattern(
  centreId: string,
  input: BookInput,
  audit?: (pattern: PatternDoc, session: ClientSession) => Promise<void>,
): Promise<PatternDoc> {
  const patient = await loadPatientInCentre(centreId, input.patientId);
  await checkChairAndShift(centreId, input);
  if (patient.status !== 'active') throw conflict('patient_not_active');
  const pattern = await withTransaction(async (session) => {
    if (await Pattern.exists({ patientId: patient._id, to: null }).session(session)) throw conflict('already_booked');
    const created = await insertPattern(centreId, patient.id, input, session);
    await audit?.(created, session);
    return created;
  });
  await regenerateSessions(patient.id);
  return pattern;
}

/** Ends the open pattern the day before `input.from`, frees its slots and books the new one atomically. */
export async function changePattern(
  centreId: string,
  patientId: string,
  input: PatternInput,
  audit?: (pattern: PatternDoc, session: ClientSession) => Promise<void>,
): Promise<PatternDoc> {
  const patient = await loadPatientInCentre(centreId, patientId);
  await checkChairAndShift(centreId, input);
  if (patient.status !== 'active') throw conflict('patient_not_active');
  const pattern = await withTransaction(async (session) => {
    const open = await Pattern.findOne({ patientId: patient._id, to: null }).session(session);
    if (!open) throw conflict('no_pattern');
    open.to = addDays(input.from, -1);
    await open.save({ session });
    await Slot.deleteMany({ patternId: open._id }, { session });
    await deleteScheduledSessionsAfter(patient.id, open.to, session);
    const created = await insertPattern(centreId, patient.id, input, session);
    await audit?.(created, session);
    return created;
  });
  await regenerateSessions(patient.id);
  return pattern;
}

/** Closes every open pattern of the patient on `lastDate`, frees its slots, drops later scheduled sessions. */
export async function endPatterns(patientId: string, lastDate: string, session: ClientSession): Promise<void> {
  const open = await Pattern.find({ patientId, to: null }).session(session);
  if (open.length) {
    await Pattern.updateMany({ _id: { $in: open.map((p) => p._id) } }, { $set: { to: lastDate } }, { session });
    await Slot.deleteMany({ patternId: { $in: open.map((p) => p._id) } }, { session });
  }
  await deleteScheduledSessionsAfter(patientId, lastDate, session);
}

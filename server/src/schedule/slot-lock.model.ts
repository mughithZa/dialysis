import { Schema, model } from 'mongoose';

/**
 * One row per (chair, shift, weekday) ever booked. Bumping it inside a transaction serialises bookings of that
 * slot; see `lockSlot` in schedule/slots.ts. It holds no booking data.
 */
const slotLockSchema = new Schema({
  chairId: { type: Schema.Types.ObjectId, required: true },
  shiftId: { type: Schema.Types.ObjectId, required: true },
  weekday: { type: Number, required: true },
  rev: { type: Number, default: 0 },
});
slotLockSchema.index({ chairId: 1, shiftId: 1, weekday: 1 }, { unique: true });

export const SlotLock = model('SlotLock', slotLockSchema);

/**
 * One row per patient whose plans were ever written. Bumping it inside a transaction serialises every plan write
 * of that patient (book weekly, change, end), so "one plan per patient at a time" holds even for end-dated plans,
 * which the open-plan unique index does not cover. See `lockPatientPlans` in schedule/booking.ts.
 */
const patientPlanLockSchema = new Schema({
  patientId: { type: Schema.Types.ObjectId, required: true, unique: true },
  rev: { type: Number, default: 0 },
});

export const PatientPlanLock = model('PatientPlanLock', patientPlanLockSchema);

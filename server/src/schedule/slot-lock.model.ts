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

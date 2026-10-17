import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

/** One row per held (chair, shift, weekday); the unique index is the booking race guard. */
const slotSchema = new Schema({
  centreId: { type: Schema.Types.ObjectId, ref: 'Centre', required: true, index: true },
  chairId: { type: Schema.Types.ObjectId, ref: 'Chair', required: true },
  shiftId: { type: Schema.Types.ObjectId, ref: 'Shift', required: true },
  weekday: { type: Number, required: true, min: 0, max: 6 },
  patternId: { type: Schema.Types.ObjectId, ref: 'Pattern', required: true, index: true },
});
slotSchema.index({ chairId: 1, shiftId: 1, weekday: 1 }, { unique: true });

export type SlotDoc = HydratedDocument<InferSchemaType<typeof slotSchema>>;
export const Slot = model('Slot', slotSchema);

import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

const hhmm = { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ };
const shiftSchema = new Schema({
  centreId: { type: Schema.Types.ObjectId, ref: 'Centre', required: true },
  name: { type: String, required: true, trim: true },
  start: hhmm,
  end: hhmm,
  active: { type: Boolean, default: true },
});

export type ShiftDoc = HydratedDocument<InferSchemaType<typeof shiftSchema>>;
export const Shift = model('Shift', shiftSchema);

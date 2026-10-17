import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

const patternSchema = new Schema({
  centreId: { type: Schema.Types.ObjectId, ref: 'Centre', required: true, index: true },
  patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
  chairId: { type: Schema.Types.ObjectId, ref: 'Chair', required: true },
  shiftId: { type: Schema.Types.ObjectId, ref: 'Shift', required: true },
  /** 1–3 distinct weekdays, JS numbering 0=Sunday … 6=Saturday. */
  weekdays: {
    type: [Number],
    required: true,
    validate: (v: number[]) => v.length >= 1 && v.length <= 3 && new Set(v).size === v.length,
  },
  /** First local date (YYYY-MM-DD) the pattern applies. */
  from: { type: String, required: true },
  /** Last local date it applies; null while open. */
  to: { type: String, default: null },
});

/** A patient can never have two open patterns, even under concurrent booking. */
patternSchema.index({ patientId: 1 }, { unique: true, partialFilterExpression: { to: { $type: 'null' } } });

export type PatternDoc = HydratedDocument<InferSchemaType<typeof patternSchema>>;
export const Pattern = model('Pattern', patternSchema);

import { Schema, model, type HydratedDocument, type InferSchemaType, type Types } from 'mongoose';

export const PLAN_REPEATS = ['weekly'] as const;
const ymd = /^\d{4}-\d{2}-\d{2}$/;

/** One weekly holding: machine `chairId` in session block `shiftId` on `weekday` (0=Sunday … 6=Saturday). */
const planItemSchema = new Schema(
  {
    weekday: { type: Number, required: true, min: 0, max: 6, validate: Number.isInteger },
    shiftId: { type: Schema.Types.ObjectId, ref: 'Shift', required: true },
    chairId: { type: Schema.Types.ObjectId, ref: 'Chair', required: true },
  },
  { _id: false },
);

/**
 * A patient's weekly booking. It holds every listed (chair, shift, weekday) on each matching working day
 * from `from` to `to` (inclusive; `to: null` = open-ended). Only `schedule/slots.ts` interprets it.
 * One-off bookings are plain sessions and never create a plan.
 */
const planSchema = new Schema({
  centreId: { type: Schema.Types.ObjectId, ref: 'Centre', required: true, index: true },
  patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
  items: {
    type: [planItemSchema],
    required: true,
    validate: {
      validator: (v: { weekday: number; shiftId: unknown }[]) =>
        v.length >= 1 && v.length <= 7 && new Set(v.map((i) => `${i.weekday}:${String(i.shiftId)}`)).size === v.length,
      message: 'items must hold 1–7 entries with a unique weekday and block',
    },
  },
  /** First local date (YYYY-MM-DD) the plan applies. */
  from: { type: String, required: true, match: ymd },
  /** Last local date it applies; null while open. */
  to: { type: String, default: null, match: ymd },
  repeat: { type: String, enum: PLAN_REPEATS, default: 'weekly' },
  createdAt: { type: Date, default: () => new Date() },
});

/** A patient can never have two open plans, even under concurrent booking. */
planSchema.index({ patientId: 1 }, { unique: true, partialFilterExpression: { to: { $type: 'null' } } });
planSchema.index({ 'items.chairId': 1, 'items.shiftId': 1, 'items.weekday': 1 });

export interface PlanItem {
  weekday: number;
  shiftId: string | Types.ObjectId;
  chairId: string | Types.ObjectId;
}
export type PlanData = InferSchemaType<typeof planSchema>;
export type PlanDoc = HydratedDocument<PlanData>;
export const Plan = model('Plan', planSchema);

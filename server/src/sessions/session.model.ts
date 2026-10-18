import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

export const SESSION_STATUSES = ['scheduled', 'active', 'completed', 'postponed', 'missed', 'did_not_come', 'cancelled'] as const;
export const FINAL_STATUSES = ['completed', 'postponed', 'missed', 'did_not_come', 'cancelled'] as const;
/** Statuses that occupy a chair for a shift and date. */
export const LIVE_STATUSES = ['scheduled', 'active', 'completed'] as const;
export const SESSION_KINDS = ['regular', 'makeup'] as const;

const sessionSchema = new Schema({
  centreId: { type: Schema.Types.ObjectId, ref: 'Centre', required: true, index: true },
  patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
  /** Local date YYYY-MM-DD in the app timezone. */
  date: { type: String, required: true },
  chairId: { type: Schema.Types.ObjectId, ref: 'Chair', required: true },
  shiftId: { type: Schema.Types.ObjectId, ref: 'Shift', required: true },
  /** Snapshots taken when the session is created, so later setup changes do not rewrite history. */
  shiftStart: { type: String, required: true },
  shiftEnd: { type: String, required: true },
  chairLabel: { type: String, required: true },
  planId: { type: Schema.Types.ObjectId },
  detached: { type: Boolean, default: false },
  /**
   * Where a moved session originally sat (set by Move). The plan's slot at (movedFrom.date, movedFrom.shiftId)
   * is released for that date only; see schedule/slots.ts.
   */
  movedFrom: {
    type: new Schema(
      {
        date: { type: String, required: true },
        shiftId: { type: Schema.Types.ObjectId, ref: 'Shift', required: true },
        chairId: { type: Schema.Types.ObjectId, ref: 'Chair', required: true },
      },
      { _id: false },
    ),
    default: undefined,
  },
  runBy: { type: Schema.Types.ObjectId, ref: 'User' },
  rosterNurseId: { type: Schema.Types.ObjectId, ref: 'User' },
  statusReason: String,
  kind: { type: String, enum: SESSION_KINDS, default: 'regular' },
  status: { type: String, enum: SESSION_STATUSES, default: 'scheduled' },
  openedAt: Date,
  openedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  closedAt: Date,
  closedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  vitals: {
    type: new Schema(
      {
        weightBefore: Number,
        weightAfter: Number,
        bp: {
          type: [
            new Schema(
              { at: { type: Date, required: true }, systolic: { type: Number, required: true }, diastolic: { type: Number, required: true } },
              { _id: false },
            ),
          ],
          default: [],
        },
      },
      { _id: false },
    ),
    default: () => ({ bp: [] }),
  },
  notes: {
    type: [
      new Schema(
        {
          at: { type: Date, required: true },
          by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
          text: { type: String, required: true },
        },
      ),
    ],
    default: [],
  },
  reminderSentAt: Date,
  /** Bumped by every guarded write so a concurrent status change conflicts with it. */
  rev: { type: Number, default: 0 },
});
sessionSchema.index({ patientId: 1, date: 1, shiftId: 1 }, { unique: true });
// hard double-booking guard: one live session per chair, shift and date
sessionSchema.index(
  { chairId: 1, shiftId: 1, date: 1 },
  { unique: true, partialFilterExpression: { status: { $in: [...LIVE_STATUSES] } } },
);
sessionSchema.index({ centreId: 1, date: 1 });
sessionSchema.index({ status: 1, date: 1 });

export type SessionData = InferSchemaType<typeof sessionSchema>;
export type SessionDoc = HydratedDocument<InferSchemaType<typeof sessionSchema>>;
// explicit collection name: the default `sessions` is the express-session (connect-mongo) store's collection
export const Session = model('Session', sessionSchema, 'treatment_sessions');

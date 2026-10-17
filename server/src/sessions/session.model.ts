import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

export const SESSION_STATUSES = ['scheduled', 'active', 'completed', 'postponed', 'missed'] as const;
export const SESSION_KINDS = ['regular', 'makeup'] as const;

const sessionSchema = new Schema({
  centreId: { type: Schema.Types.ObjectId, ref: 'Centre', required: true, index: true },
  patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
  /** Local date YYYY-MM-DD in the app timezone. */
  date: { type: String, required: true },
  chairId: { type: Schema.Types.ObjectId, ref: 'Chair', required: true },
  shiftId: { type: Schema.Types.ObjectId, ref: 'Shift', required: true },
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
sessionSchema.index({ centreId: 1, date: 1 });
sessionSchema.index({ status: 1, date: 1 });

export type SessionData = InferSchemaType<typeof sessionSchema>;
export type SessionDoc = HydratedDocument<InferSchemaType<typeof sessionSchema>>;
// explicit collection name: the default `sessions` is the express-session (connect-mongo) store's collection
export const Session = model('Session', sessionSchema, 'treatment_sessions');

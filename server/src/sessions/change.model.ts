import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

export const CHANGE_KINDS = [
  'usage.add',
  'usage.update',
  'usage.remove',
  'note.add',
  'note.update',
  'note.remove',
  'vitals.update',
] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

/** One edit made to a session after it was closed; `before`/`after` hold minimal snapshots. */
const changeSchema = new Schema({
  sessionId: { type: Schema.Types.ObjectId, ref: 'Session', required: true },
  at: { type: Date, required: true, default: () => new Date() },
  by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  kind: { type: String, enum: CHANGE_KINDS, required: true },
  before: { type: Schema.Types.Mixed, default: null },
  after: { type: Schema.Types.Mixed, default: null },
});
changeSchema.index({ sessionId: 1, at: -1 });

export type SessionChangeData = InferSchemaType<typeof changeSchema>;
export type SessionChangeDoc = HydratedDocument<SessionChangeData>;
export const SessionChange = model('SessionChange', changeSchema, 'session_changes');

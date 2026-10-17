import { Schema, model, type InferSchemaType } from 'mongoose';

const auditSchema = new Schema({
  at: { type: Date, required: true, default: () => new Date() },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  centreId: { type: Schema.Types.ObjectId, ref: 'Centre', default: null },
  action: { type: String, required: true },
  entity: { type: String, required: true },
  entityId: { type: String, required: true },
  details: { type: Schema.Types.Mixed },
});
auditSchema.index({ centreId: 1, at: -1 });

export type AuditEntryDoc = InferSchemaType<typeof auditSchema>;
export const AuditEntry = model('AuditEntry', auditSchema);

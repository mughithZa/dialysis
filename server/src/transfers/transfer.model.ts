import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

export const TRANSFER_STATUSES = ['pending', 'accepted', 'rejected', 'cancelled'] as const;

const transferSchema = new Schema({
  patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
  fromCentreId: { type: Schema.Types.ObjectId, ref: 'Centre', required: true },
  toCentreId: { type: Schema.Types.ObjectId, ref: 'Centre', required: true },
  status: { type: String, enum: TRANSFER_STATUSES, default: 'pending' },
  note: String,
  rejectReason: String,
  sentBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  sentAt: { type: Date, default: () => new Date() },
  decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  decidedAt: Date,
});
// at most one pending transfer per patient
transferSchema.index({ patientId: 1 }, { unique: true, partialFilterExpression: { status: 'pending' } });
transferSchema.index({ toCentreId: 1, status: 1 });
transferSchema.index({ fromCentreId: 1 });

export type TransferDoc = HydratedDocument<InferSchemaType<typeof transferSchema>>;
export const Transfer = model('Transfer', transferSchema);

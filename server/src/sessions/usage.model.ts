import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

const usageLineSchema = new Schema(
  {
    sessionId: { type: Schema.Types.ObjectId, ref: 'TreatmentSession', required: true },
    centreId: { type: Schema.Types.ObjectId, ref: 'Centre', required: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    /** Local date YYYY-MM-DD of the session. */
    date: { type: String, required: true },
    itemId: { type: Schema.Types.ObjectId, ref: 'Item', required: true },
    amount: { type: Number, required: true },
    by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
usageLineSchema.index({ sessionId: 1 });
usageLineSchema.index({ itemId: 1 });
usageLineSchema.index({ centreId: 1, date: 1 });

export type UsageLineData = InferSchemaType<typeof usageLineSchema>;
export type UsageLineDoc = HydratedDocument<UsageLineData>;
export const UsageLine = model('UsageLine', usageLineSchema);

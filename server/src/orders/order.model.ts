import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

export const ORDER_STATUSES = ['active', 'ended'] as const;

const orderSchema = new Schema(
  {
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    /** Centre the order was written in. */
    centreId: { type: Schema.Types.ObjectId, ref: 'Centre', required: true },
    doctorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true },
    /** Local date YYYY-MM-DD from which the order applies. */
    from: { type: String, required: true },
    status: { type: String, enum: ORDER_STATUSES, default: 'active' },
    endedAt: Date,
  },
  { timestamps: true },
);
orderSchema.index({ patientId: 1, status: 1 });

export type OrderDoc = HydratedDocument<InferSchemaType<typeof orderSchema>>;
export const Order = model('Order', orderSchema, 'orders');

import { Schema, model, type InferSchemaType } from 'mongoose';

const subscriptionSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  endpoint: { type: String, required: true, unique: true },
  keys: {
    p256dh: { type: String, required: true },
    auth: { type: String, required: true },
  },
});

export type PushSubscriptionData = InferSchemaType<typeof subscriptionSchema>;
export const PushSubscription = model('PushSubscription', subscriptionSchema);

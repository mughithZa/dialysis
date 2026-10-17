import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

const chairSchema = new Schema({
  centreId: { type: Schema.Types.ObjectId, ref: 'Centre', required: true },
  label: { type: String, required: true, trim: true },
  active: { type: Boolean, default: true },
});
chairSchema.index({ centreId: 1, label: 1 }, { unique: true });

export type ChairDoc = HydratedDocument<InferSchemaType<typeof chairSchema>>;
export const Chair = model('Chair', chairSchema);

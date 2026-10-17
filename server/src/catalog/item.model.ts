import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

export const ITEM_TYPES = ['medicine', 'supply'] as const;
export const ITEM_STATUSES = ['approved', 'pending', 'retired'] as const;

const itemSchema = new Schema({
  name: { type: String, required: true, trim: true },
  /** Lowercased, trimmed name; unique per type among non-retired items. */
  nameKey: { type: String, required: true },
  type: { type: String, enum: ITEM_TYPES, required: true },
  unitId: { type: Schema.Types.ObjectId, ref: 'Unit', required: true },
  status: { type: String, enum: ITEM_STATUSES, default: 'pending' },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  mergedInto: { type: Schema.Types.ObjectId, ref: 'Item' },
  /** True once any usage line references the item (locks its unit). */
  used: { type: Boolean, default: false },
});

itemSchema.pre('validate', function () {
  if (typeof this.name === 'string') this.nameKey = this.name.trim().toLowerCase();
});
itemSchema.index(
  { type: 1, nameKey: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['approved', 'pending'] } } },
);

export type ItemData = InferSchemaType<typeof itemSchema>;
export type ItemDoc = HydratedDocument<ItemData>;
export const Item = model('Item', itemSchema);

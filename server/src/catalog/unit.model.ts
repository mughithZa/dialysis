import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

const unitSchema = new Schema({
  name: { type: String, required: true, trim: true },
  /** Lowercased, trimmed name: enforces case-insensitive uniqueness. */
  nameKey: { type: String, required: true, unique: true },
});

unitSchema.pre('validate', function () {
  if (typeof this.name === 'string') this.nameKey = this.name.trim().toLowerCase();
});

export type UnitData = InferSchemaType<typeof unitSchema>;
export type UnitDoc = HydratedDocument<UnitData>;
export const Unit = model('Unit', unitSchema);

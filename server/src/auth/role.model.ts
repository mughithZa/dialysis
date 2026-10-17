import { Schema, model, type InferSchemaType } from 'mongoose';
import { GLOBAL_PERMISSIONS, PERMISSIONS, type Permission } from '@dialysis/shared';

const ALL: string[] = PERMISSIONS.map((p) => p.key);

const roleSchema = new Schema({
  key: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  scope: { type: String, enum: ['global', 'centre'], required: true },
  permissions: { type: [{ type: String, enum: ALL }], default: [] },
  system: { type: Boolean, default: false },
});

roleSchema.pre('validate', function () {
  if (this.scope === 'centre' && this.permissions.some((p) => GLOBAL_PERMISSIONS.includes(p as Permission))) {
    this.invalidate('permissions', 'global_perm_in_centre_role');
  }
});

export type RoleDoc = InferSchemaType<typeof roleSchema>;
export const Role = model('Role', roleSchema);

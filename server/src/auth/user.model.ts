import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { LANGUAGES } from '@dialysis/shared';

const userSchema = new Schema({
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  name: { type: String, required: true },
  phone: String,
  kind: { type: String, enum: ['staff', 'patient'], required: true },
  active: { type: Boolean, default: true },
  /** Interface language the user last chose; push reminders use it (English when unset). */
  language: { type: String, enum: LANGUAGES },
  globalRoleIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Role' }], default: [] },
  memberships: {
    type: [
      new Schema(
        {
          centreId: { type: Schema.Types.ObjectId, ref: 'Centre', required: true },
          roleIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Role' }], default: [] },
        },
        { _id: false },
      ),
    ],
    default: [],
  },
});

export type UserData = InferSchemaType<typeof userSchema>;
export type UserDoc = HydratedDocument<UserData>;
export const User = model('User', userSchema);

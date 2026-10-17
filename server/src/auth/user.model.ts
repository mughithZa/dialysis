import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

const userSchema = new Schema({
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  name: { type: String, required: true },
  phone: String,
  kind: { type: String, enum: ['staff', 'patient'], required: true },
  active: { type: Boolean, default: true },
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

import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

/** A nurse covering a block on some machines (empty `chairIds` = all active machines) from `from` to `to` inclusive. */
const rosterSchema = new Schema(
  {
    centreId: { type: Schema.Types.ObjectId, ref: 'Centre', required: true },
    nurseId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    shiftId: { type: Schema.Types.ObjectId, ref: 'Shift', required: true },
    from: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    to: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    chairIds: { type: [Schema.Types.ObjectId], ref: 'Chair', default: [] },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
rosterSchema.index({ centreId: 1, from: 1, to: 1 });

export type RosterEntryDoc = HydratedDocument<InferSchemaType<typeof rosterSchema>>;
export const RosterEntry = model('RosterEntry', rosterSchema);

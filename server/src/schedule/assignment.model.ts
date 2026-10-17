import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

/** The nurse responsible for a chair during a shift (standing assignment, not per date). */
const assignmentSchema = new Schema({
  centreId: { type: Schema.Types.ObjectId, ref: 'Centre', required: true, index: true },
  shiftId: { type: Schema.Types.ObjectId, ref: 'Shift', required: true },
  chairId: { type: Schema.Types.ObjectId, ref: 'Chair', required: true },
  nurseId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
});
assignmentSchema.index({ chairId: 1, shiftId: 1 }, { unique: true });

export type ChairAssignmentDoc = HydratedDocument<InferSchemaType<typeof assignmentSchema>>;
export const ChairAssignment = model('ChairAssignment', assignmentSchema);

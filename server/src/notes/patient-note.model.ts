import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

/** A doctor's patient-level note: not tied to any session. */
const patientNoteSchema = new Schema({
  patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
  /** Centre the note was written in. */
  centreId: { type: Schema.Types.ObjectId, ref: 'Centre', required: true },
  authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true, minlength: 1, maxlength: 2000 },
  at: { type: Date, required: true, default: () => new Date() },
});
patientNoteSchema.index({ patientId: 1, at: -1 });

export type PatientNoteDoc = HydratedDocument<InferSchemaType<typeof patientNoteSchema>>;
export const PatientNote = model('PatientNote', patientNoteSchema, 'patient_notes');

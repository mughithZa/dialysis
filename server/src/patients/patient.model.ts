import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

export const DISCHARGE_REASONS = ['transplant', 'death', 'moved', 'travelled', 'left_program'] as const;
export const PATIENT_STATUSES = ['active', 'transferring', 'discharged'] as const;

const patientSchema = new Schema({
  centreId: { type: Schema.Types.ObjectId, ref: 'Centre', required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  name: { type: String, required: true, trim: true },
  phone: String,
  emergencyContact: {
    type: new Schema({ name: String, phone: String, relation: String }, { _id: false }),
    default: () => ({}),
  },
  kidneyFailureCause: String,
  address: String,
  socialSituation: String,
  financialSituation: String,
  otherDiseases: String,
  notes: String,
  status: { type: String, enum: PATIENT_STATUSES, default: 'active' },
  discharge: {
    type: new Schema(
      { reason: { type: String, enum: DISCHARGE_REASONS, required: true }, date: { type: String, required: true } },
      { _id: false },
    ),
  },
  createdAt: { type: Date, default: () => new Date() },
});

export type PatientData = InferSchemaType<typeof patientSchema>;
export type PatientDoc = HydratedDocument<PatientData>;
export const Patient = model('Patient', patientSchema);

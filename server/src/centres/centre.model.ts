import { Schema, model, type InferSchemaType } from 'mongoose';

const centreSchema = new Schema({
  name: { type: String, required: true },
  status: { type: String, enum: ['active', 'closed'], default: 'active' },
  settings: {
    patientsSeeNotes: { type: Boolean, default: false },
    reminderHours: { type: Number, default: 24 },
  },
});

export type CentreDoc = InferSchemaType<typeof centreSchema>;
export const Centre = model('Centre', centreSchema);

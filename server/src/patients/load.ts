import mongoose from 'mongoose';
import { notFound } from '../lib/errors.js';
import { Patient, type PatientDoc } from './patient.model.js';

/** Loads a patient of this centre; a missing id or a patient of another centre is 404. */
export async function loadPatientInCentre(centreId: string, patientId: unknown): Promise<PatientDoc> {
  const patient =
    typeof patientId === 'string' && mongoose.isValidObjectId(patientId) ? await Patient.findById(patientId) : null;
  if (!patient || String(patient.centreId) !== String(centreId)) throw notFound();
  return patient;
}

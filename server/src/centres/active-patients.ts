import { Patient } from '../patients/patient.model.js';

/** Patients in `active` or `transferring` status at the centre. */
export async function countActivePatients(centreId: string): Promise<number> {
  return Patient.countDocuments({ centreId, status: { $in: ['active', 'transferring'] } });
}

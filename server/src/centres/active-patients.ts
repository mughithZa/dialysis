import mongoose from 'mongoose';

/**
 * Patients in `active` or `transferring` status at the centre. Reads the raw collection so it works
 * before the Patient model exists (Task 7); a missing collection simply counts as zero.
 */
export async function countActivePatients(centreId: string): Promise<number> {
  return mongoose.connection.collection('patients').countDocuments({
    centreId: new mongoose.Types.ObjectId(centreId),
    status: { $in: ['active', 'transferring'] },
  });
}

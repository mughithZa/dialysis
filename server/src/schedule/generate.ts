import type { ClientSession } from 'mongoose';

// Stubs: Task 9 implements session generation once the Session model exists.

/** Creates the scheduled sessions a patient's open pattern implies from `today` on. */
export async function regenerateSessions(_patientId: string, _today?: string): Promise<void> {}

/** Deletes `scheduled` sessions of the patient dated after `lastDate`. */
export async function deleteScheduledSessionsAfter(
  _patientId: string,
  _lastDate: string,
  _session?: ClientSession,
): Promise<void> {}

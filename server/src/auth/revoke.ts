import mongoose from 'mongoose';

/** Collection the connect-mongo session store writes login sessions to. */
export const SESSION_COLLECTION = 'sessions';

/** Deletes every stored login session of `userId` so the account is logged out everywhere at once. */
export async function revokeSessions(userId: string): Promise<void> {
  // connect-mongo stores the session as a JSON string; userId is an ObjectId hex string (no regex metacharacters).
  await mongoose.connection.collection(SESSION_COLLECTION).deleteMany({ session: { $regex: `"userId":"${userId}"` } });
}

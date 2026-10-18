/** Every status a session can have; mirrors the server's SESSION_STATUSES. */
export const SESSION_STATUSES = ['scheduled', 'active', 'completed', 'postponed', 'missed', 'did_not_come', 'cancelled'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

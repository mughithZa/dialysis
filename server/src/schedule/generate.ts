import type { ClientSession } from 'mongoose';
import { addDays, todayLocal, weekdayOf } from '../lib/dates.js';
import { Session } from '../sessions/session.model.js';
import { Pattern } from './pattern.model.js';

/** How many days ahead (including today) scheduled sessions are materialised. */
export const GENERATION_DAYS = 14;

/**
 * Upserts the `scheduled` regular sessions a patient's open pattern implies for
 * `[max(today, pattern.from), today + 13]`. Existing sessions (any status) are left untouched,
 * so it is safe to run repeatedly and concurrently (the unique index is the guard).
 */
export async function regenerateSessions(patientId: string, today: string = todayLocal()): Promise<void> {
  const pattern = await Pattern.findOne({ patientId, to: null });
  if (!pattern) return;
  const first = pattern.from > today ? pattern.from : today;
  const last = addDays(today, GENERATION_DAYS - 1);
  const ops = [];
  for (let date = first; date <= last; date = addDays(date, 1)) {
    if (!pattern.weekdays.includes(weekdayOf(date))) continue;
    ops.push({
      updateOne: {
        filter: { patientId: pattern.patientId, date, shiftId: pattern.shiftId },
        update: {
          $setOnInsert: {
            centreId: pattern.centreId,
            chairId: pattern.chairId,
            kind: 'regular' as const,
            status: 'scheduled' as const,
          },
        },
        upsert: true,
      },
    });
  }
  if (!ops.length) return;
  try {
    await Session.bulkWrite(ops, { ordered: false });
  } catch (e) {
    // a concurrent run inserted the same session first: that is the idempotent outcome we want
    const errs = (e as { writeErrors?: { err?: { code?: number } }[] }).writeErrors;
    if (!errs || errs.some((w) => w.err?.code !== 11000)) throw e;
  }
}

/**
 * Refreshes future `scheduled` sessions after a setup or roster change (block times, machine label,
 * rostered nurse). No-op placeholder until the session refresh is implemented.
 */
export async function refreshFutureSessions(_centreId: string, _today: string = todayLocal()): Promise<void> {
  // intentionally empty
}

/** Deletes `scheduled` sessions of the patient dated after `lastDate`. */
export async function deleteScheduledSessionsAfter(
  patientId: string,
  lastDate: string,
  session?: ClientSession,
): Promise<void> {
  await Session.deleteMany({ patientId, status: 'scheduled', date: { $gt: lastDate } }, { session });
}

import { DateTime } from 'luxon';
import { config } from '../config.js';

const zone = () => config.appTz;

/** Current local date (YYYY-MM-DD) in the app timezone. */
export function todayLocal(now: Date = new Date()): string {
  return DateTime.fromJSDate(now, { zone: zone() }).toISODate()!;
}

/** Current local time (HH:mm) in the app timezone. */
export function nowTimeLocal(now: Date = new Date()): string {
  return DateTime.fromJSDate(now, { zone: zone() }).toFormat('HH:mm');
}

/** Weekday of a local date, JS numbering: 0=Sunday … 6=Saturday. */
export function weekdayOf(date: string): number {
  return DateTime.fromISO(date, { zone: 'utc' }).weekday % 7;
}

export function addDays(date: string, n: number): string {
  return DateTime.fromISO(date, { zone: 'utc' }).plus({ days: n }).toISODate()!;
}

/** Instant for a local date + HH:mm in the app timezone. */
export function localDateTime(date: string, hhmm: string): Date {
  return DateTime.fromISO(`${date}T${hhmm}`, { zone: zone() }).toJSDate();
}

export function monthRange(month: string): { from: string; to: string } {
  const start = DateTime.fromISO(`${month}-01`, { zone: 'utc' });
  return { from: start.toISODate()!, to: start.endOf('month').toISODate()! };
}

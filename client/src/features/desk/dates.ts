/** Local-date string YYYY-MM-DD for a Date (browser-local; the server validates against its own clock). */
export function toLocalDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const todayLocal = () => toLocalDate(new Date());

/** Local date `days` after today. */
export function addDaysLocal(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toLocalDate(d);
}

/** Mirrors the server's MAKEUP_WINDOW_DAYS. */
export const MAKEUP_WINDOW_DAYS = 3;

/** Parses YYYY-MM-DD as a browser-local date. */
export function parseLocal(date: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

/** The date `days` after (or before, when negative) `date`. */
export function shiftDate(date: string, days: number): string {
  const d = parseLocal(date);
  d.setDate(d.getDate() + days);
  return toLocalDate(d);
}

/** The Saturday that starts the week containing `date` (the week runs Saturday to Friday). */
export const weekStartSat = (date: string) => shiftDate(date, -((parseLocal(date).getDay() + 1) % 7));

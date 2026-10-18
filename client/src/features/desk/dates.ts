/** Local-date string YYYY-MM-DD for a Date (browser-local; the server validates against its own clock). */
export function toLocalDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const todayLocal = () => toLocalDate(new Date());

/** Weekdays in display order, as JS numbers (0 = Sunday). */
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/** Local date `days` after today. */
export function addDaysLocal(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toLocalDate(d);
}

/** Mirrors the server's MAKEUP_WINDOW_DAYS. */
export const MAKEUP_WINDOW_DAYS = 3;

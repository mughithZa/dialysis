import i18n, { dateLocale } from '.';

/**
 * A local YYYY-MM-DD date for reading, e.g. "5 Oct 2026" / "5 تشرين الأول 2026". Raw ISO dates must not be shown in
 * Arabic text: the bidi algorithm reorders their hyphenated parts, so "2026-10-23" can read as "23-10-2026".
 */
export function formatDate(date: string, lng: string = i18n.language): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(dateLocale(lng), { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(y, m - 1, d));
}

/** A short local date for chart axes and compact rows, e.g. "5 Oct" / "5 تشرين الأول". */
export function formatShortDate(date: string, lng: string = i18n.language): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(dateLocale(lng), { day: 'numeric', month: 'short' }).format(new Date(y, m - 1, d));
}

/** Joins short items (machine labels, medicines) with the language's comma: "1, 2, 3" / "1، 2، 3". */
export const formatList = (items: string[], lng: string = i18n.language): string => items.join(lng === 'ar' ? '، ' : ', ');

/**
 * A time range such as "07:00–11:30". In right-to-left text the range is wrapped in a left-to-right isolate so it
 * always reads start to end, whatever text surrounds it (otherwise it can show as "11:30–07:00").
 */
export const timeRange = (start: string, end: string, lng: string = i18n.language): string =>
  i18n.dir(lng) === 'rtl' ? `⁦${start}–${end}⁩` : `${start}–${end}`;

const monthDate = (month: string) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(y, m - 1, 1);
};

/** A `YYYY-MM` month for reading, e.g. "October 2026" / "تشرين الأول 2026". */
export const formatMonth = (month: string, lng: string = i18n.language): string =>
  new Intl.DateTimeFormat(dateLocale(lng), { month: 'long', year: 'numeric' }).format(monthDate(month));

/** Only the month's name, e.g. "September" / "أيلول" (as in "vs September"). */
export const formatMonthName = (month: string, lng: string = i18n.language): string =>
  new Intl.DateTimeFormat(dateLocale(lng), { month: 'long' }).format(monthDate(month));

/** A timestamp's local calendar date as `YYYY-MM-DD` (to group rows by day, then show with `formatDate`). */
export const localDay = (iso: string): string => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** A timestamp's local clock time, e.g. "08:05". */
export const formatTime = (iso: string, lng: string = i18n.language): string =>
  new Intl.DateTimeFormat(dateLocale(lng), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

/** A short month name for table headers, e.g. "Sep" / "أيلول". */
export const formatMonthShort = (month: string, lng: string = i18n.language): string =>
  new Intl.DateTimeFormat(dateLocale(lng), { month: 'short' }).format(monthDate(month));

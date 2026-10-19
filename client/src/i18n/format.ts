import i18n, { dateLocale } from '.';

/**
 * A local YYYY-MM-DD date for reading, e.g. "5 Oct 2026" / "5 تشرين الأول 2026". Raw ISO dates must not be shown in
 * Arabic text: the bidi algorithm reorders their hyphenated parts, so "2026-10-23" can read as "23-10-2026".
 */
export function formatDate(date: string, lng: string = i18n.language): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(dateLocale(lng), { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(y, m - 1, d));
}

/** Joins short items (machine labels, medicines) with the language's comma: "1, 2, 3" / "1، 2، 3". */
export const formatList = (items: string[], lng: string = i18n.language): string => items.join(lng === 'ar' ? '، ' : ', ');

/**
 * A time range such as "07:00–11:30". In right-to-left text the range is wrapped in a left-to-right isolate so it
 * always reads start to end, whatever text surrounds it (otherwise it can show as "11:30–07:00").
 */
export const timeRange = (start: string, end: string, lng: string = i18n.language): string =>
  i18n.dir(lng) === 'rtl' ? `⁦${start}–${end}⁩` : `${start}–${end}`;

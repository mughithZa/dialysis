import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query';
import { apiGet } from '../api';
import { dateLocale } from '../i18n';
import type { SessionStatus } from '../sessionStatus';
import { shiftDate } from '../features/desk/dates';

export interface TimelineItem {
  id: string;
  date: string;
  start: string;
  end: string;
  block: string;
  chairLabel: string;
  centreId: string;
  centreName: string;
  status: SessionStatus;
  kind: 'regular' | 'makeup';
  detached: boolean;
  oneOff: boolean;
  nurse: { name: string } | null;
  medicines: { name: string; amount: number; unit: string }[];
  statusReason?: string;
  /** A make-up: date of the session it replaces. */
  makeupForDate?: string;
  /** A postponed, did-not-come or missed session: date of the make-up that replaces it. */
  madeUpOn?: string;
  /** Staff viewers only: the session belongs to the viewer's centre, so its page can be opened. */
  linkable?: boolean;
  /** The patient's own app, when the centre shares notes: the session's nurse notes. */
  notes?: { at: string; text: string }[];
  /** The patient's own app, when the centre shares notes: doctor orders in force on the session's date. */
  orders?: { text: string; from: string }[];
}

export interface TimelineNote {
  id: string;
  at: string;
  text: string;
  author: { name: string };
}

export interface TimelineData {
  upcoming: TimelineItem[];
  today: TimelineItem[];
  past: TimelineItem[];
  notes: TimelineNote[];
}

export type TimelineSource = { kind: 'staff'; centreId: string; patientId: string } | { kind: 'me' };

export const TIMELINE_PAGE = 20;

const pathOf = (s: TimelineSource) => (s.kind === 'me' ? '/me/timeline' : `/centres/${s.centreId}/patients/${s.patientId}/timeline`);

/** Staff timelines sit under the desk prefix, so every desk write refreshes them. */
const keyOf = (s: TimelineSource) => (s.kind === 'me' ? ['me', 'timeline'] : ['desk', s.centreId, 'timeline', s.patientId]);

const uniqueById = <T extends { id: string }>(rows: T[]): T[] => {
  const seen = new Set<string>();
  return rows.filter((r) => !seen.has(r.id) && !!seen.add(r.id));
};

function merge(data: InfiniteData<TimelineData>): TimelineData {
  const first = data.pages[0];
  return {
    upcoming: first?.upcoming ?? [],
    today: first?.today ?? [],
    past: uniqueById(data.pages.flatMap((p) => p.past)),
    notes: uniqueById(data.pages.flatMap((p) => p.notes)).sort((a, b) => b.at.localeCompare(a.at)),
  };
}

/**
 * The one timeline hook for both sources (a patient seen by staff, and the patient's own app). The first page holds
 * Upcoming and Today; later pages add older Past rows and the notes of their date span.
 */
export function useTimeline(source: TimelineSource, enabled = true) {
  const ready = source.kind === 'me' ? true : !!source.centreId && !!source.patientId;
  return useInfiniteQuery({
    queryKey: keyOf(source),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => apiGet<TimelineData>(`${pathOf(source)}?limit=${TIMELINE_PAGE}${pageParam ? `&before=${pageParam}` : ''}`),
    // `before` excludes its date, so continue from the day after the oldest row to keep a date split across pages whole;
    // rows seen twice are dropped by id.
    getNextPageParam: (last) => (last.past.length >= TIMELINE_PAGE ? shiftDate(last.past[last.past.length - 1]!.date, 1) : undefined),
    select: merge,
    enabled: enabled && ready,
  });
}

/** "Tuesday, Oct 20" (order per locale) for a YYYY-MM-DD date, in the UI language. */
export function formatDay(date: string, lng: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(dateLocale(lng), { weekday: 'long', day: 'numeric', month: 'short' }).format(new Date(y, m - 1, d));
}

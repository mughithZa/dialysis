import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { apiGet } from '../../api';

export interface MiniSession {
  id: string;
  date: string;
  start: string;
  end: string;
  centreName: string;
  kind: 'regular' | 'makeup';
  status: 'scheduled' | 'active' | 'completed' | 'postponed' | 'missed';
}
export interface OverviewDto {
  patient: { name: string };
  centre: { name: string };
  active: MiniSession | null;
  upcoming: MiniSession[];
}
export interface HistoryRow extends MiniSession {
  usage: Array<{ name: string; amount: number; unit: string }>;
  /** Present only when the centre lets patients see notes. */
  notes?: Array<{ at: string; text: string }>;
  orders?: Array<{ text: string; from: string }>;
}

export const PAGE_SIZE = 20;

export const useOverview = () => useQuery({ queryKey: ['me', 'overview'], queryFn: () => apiGet<OverviewDto>('/me/overview') });

export function useHistory() {
  return useInfiniteQuery({
    queryKey: ['me', 'sessions'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      apiGet<HistoryRow[]>(`/me/sessions?limit=${PAGE_SIZE}${pageParam ? `&before=${pageParam}` : ''}`),
    // The server pages by date (`before` is exclusive), so continue from the oldest date seen.
    getNextPageParam: (last) => (last.length < PAGE_SIZE ? undefined : last[last.length - 1]?.date),
  });
}

/** "Tuesday, Oct 20" (order per locale) for a YYYY-MM-DD date, in the UI language. */
export function formatDay(date: string, lng: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(lng, { weekday: 'long', day: 'numeric', month: 'short' }).format(new Date(y, m - 1, d));
}

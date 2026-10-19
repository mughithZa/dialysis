import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../api';
import type { SessionStatus } from '../../sessionStatus';

export interface MiniSession {
  id: string;
  date: string;
  start: string;
  end: string;
  /** Machine label (snapshot); absent from older servers. */
  chairLabel?: string;
  centreName: string;
  kind: 'regular' | 'makeup';
  status: SessionStatus;
}
export interface OverviewDto {
  patient: { name: string };
  centre: { name: string };
  active: MiniSession | null;
  upcoming: MiniSession[];
}
export const useOverview = () => useQuery({ queryKey: ['me', 'overview'], queryFn: () => apiGet<OverviewDto>('/me/overview') });

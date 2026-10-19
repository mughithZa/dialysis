import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../../api';
import type { SessionStatus } from '../../sessionStatus';
import { useCentreId } from '../centre/api';

export type BoardStatus = SessionStatus;

export interface BoardRow {
  id: string;
  date: string;
  status: BoardStatus;
  kind: 'regular' | 'makeup';
  chair: { id: string; label: string };
  chairLabel: string;
  shift: { id: string; name: string; start: string; end: string };
  patient: { id: string; name: string };
  hasActiveOrders: boolean;
  start: string;
  end: string;
  nurse: { id: string; name: string } | null;
  runBy: { id: string; name: string } | null;
  mine: boolean;
  /** When the session was opened and closed (ISO), null until then. */
  openedAt: string | null;
  closedAt: string | null;
}

export interface BoardDto {
  date: string;
  working: boolean;
  blocks: { id: string; name: string; start: string; end: string }[];
  shiftId: string | null;
  active: BoardRow[];
  waiting: BoardRow[];
  done: BoardRow[];
  didNotCome: BoardRow[];
  other: BoardRow[];
  emptyMachines: { id: string; label: string }[];
  /** Sessions still active from an earlier day (never closed), oldest first. */
  unclosed: BoardRow[];
}

export const BOARD_REFRESH_MS = 30_000;

// Keyed under the desk prefix so every desk write (postpone, did not come, make-up) refreshes the board too.
export function useBoard(shiftId: string | null) {
  const centreId = useCentreId();
  return useQuery({
    queryKey: ['desk', centreId, 'board', shiftId],
    queryFn: () => apiGet<BoardDto>(`/centres/${centreId}/board${shiftId ? `?shiftId=${encodeURIComponent(shiftId)}` : ''}`),
    enabled: !!centreId,
    refetchInterval: BOARD_REFRESH_MS,
  });
}

/** Opens (starts) a session from the board. */
export function useStartSession() {
  const centreId = useCentreId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => apiPost(`/centres/${centreId}/sessions/${sessionId}/open`),
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: ['desk', centreId] }), qc.invalidateQueries({ queryKey: ['nurse', centreId] })]),
  });
}

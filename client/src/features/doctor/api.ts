import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../../api';
import type { TimelineNote } from '../../components/timelineApi';
import { useCentreId } from '../centre/api';
import type { OrderDto } from '../desk/api';

// Orders are read through the desk `useOrders` hook (key ['desk', centre, 'orders', patient]); these mutations refresh it.
export function useCreateOrder(patientId: string) {
  const centreId = useCentreId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { text: string; from?: string }) => apiPost<OrderDto>(`/centres/${centreId}/patients/${patientId}/orders`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['desk', centreId, 'orders', patientId] }),
  });
}

export function useEndOrder(patientId: string) {
  const centreId = useCentreId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) => apiPost<OrderDto>(`/centres/${centreId}/patients/${patientId}/orders/${orderId}/end`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['desk', centreId, 'orders', patientId] }),
  });
}

// Patient-level doctor notes (orders.view to read, orders.write to add); the patient timeline shows them too.
export const useNotes = (patientId: string, enabled: boolean) => {
  const centreId = useCentreId();
  return useQuery({
    queryKey: ['desk', centreId, 'notes', patientId],
    queryFn: () => apiGet<TimelineNote[]>(`/centres/${centreId}/patients/${patientId}/notes`),
    enabled: enabled && !!centreId,
  });
};

export interface VitalsPoint {
  sessionId: string;
  date: string;
  centreName: string;
  weightBefore: number | null;
  weightAfter: number | null;
  weightLoss: number | null;
  /** Average of the session's BP readings. */
  systolic: number | null;
  diastolic: number | null;
  bpCount: number;
}

export const TREND_SESSIONS = 30;

/** Per-session weights and BP of the last sessions with vitals, oldest first (sessions.view). */
export const useVitals = (patientId: string, enabled = true) => {
  const centreId = useCentreId();
  return useQuery({
    queryKey: ['desk', centreId, 'vitals', patientId],
    queryFn: () => apiGet<{ points: VitalsPoint[] }>(`/centres/${centreId}/patients/${patientId}/vitals?limit=${TREND_SESSIONS}`),
    enabled: enabled && !!centreId,
  });
};

export function useCreateNote(patientId: string) {
  const centreId = useCentreId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => apiPost<TimelineNote>(`/centres/${centreId}/patients/${patientId}/notes`, { text }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['desk', centreId, 'notes', patientId] });
      return qc.invalidateQueries({ queryKey: ['desk', centreId, 'timeline', patientId] });
    },
  });
}

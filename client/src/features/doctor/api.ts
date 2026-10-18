import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost } from '../../api';
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

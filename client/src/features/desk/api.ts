import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch, apiPut } from '../../api';
import { useCentreId } from '../centre/api';

export type PatientStatus = 'active' | 'transferring' | 'discharged';
export type StatusFilter = 'default' | PatientStatus | 'all';
export const DISCHARGE_REASONS = ['transplant', 'death', 'moved', 'travelled', 'left_program'] as const;
export type DischargeReason = (typeof DISCHARGE_REASONS)[number];

export interface PatientDto {
  id: string;
  userId: string;
  name: string;
  phone: string | null;
  emergencyContact: { name: string | null; phone: string | null; relation: string | null };
  kidneyFailureCause: string | null;
  address: string | null;
  socialSituation: string | null;
  financialSituation: string | null;
  otherDiseases: string | null;
  notes: string | null;
  status: PatientStatus;
  discharge: { reason: DischargeReason; date: string } | null;
}
/** Record fields the form edits (all optional strings). */
export interface PatientRecord {
  name?: string;
  phone?: string;
  emergencyContact?: { name?: string; phone?: string; relation?: string };
  kidneyFailureCause?: string;
  address?: string;
  socialSituation?: string;
  financialSituation?: string;
  otherDiseases?: string;
  notes?: string;
}
export interface GridDto {
  chairs: { id: string; label: string; active: boolean }[];
  shifts: { id: string; name: string; start: string; end: string; active: boolean }[];
  slots: { chairId: string; shiftId: string; weekday: number; patient: { id: string; name: string } }[];
}
export interface AssignmentDto {
  shiftId: string;
  chairId: string;
  nurseId: string;
}
export interface SessionCardDto {
  id: string;
  date: string;
  status: 'scheduled' | 'active' | 'completed' | 'postponed' | 'missed';
  kind: 'regular' | 'makeup';
  chair: { id: string; label: string };
  shift: { id: string; name: string; start: string; end: string };
  patient: { id: string; name: string };
}
export interface OrderDto {
  id: string;
  text: string;
  from: string;
  status: 'active' | 'ended';
  doctor: { id: string; name: string };
}
export type TransferStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled';
export interface IncomingTransfer {
  id: string;
  status: TransferStatus;
  sentAt: string;
  note: string | null;
  fromCentre: { id: string; name: string };
  patient: { name: string; phone: string | null; kidneyFailureCause: string | null };
}
export interface OutgoingTransfer {
  id: string;
  status: TransferStatus;
  sentAt: string;
  note: string | null;
  toCentre: { id: string; name: string };
  rejectReason: string | null;
  /** null once accepted: the patient then belongs to the other centre. */
  patient: { id: string; name: string } | null;
}
export interface PatternBody {
  chairId: string;
  shiftId: string;
  weekdays: number[];
  from: string;
}

const base = (centreId: string) => `/centres/${centreId}`;

/** Every desk query is keyed under this prefix so one invalidation refreshes them all. */
const key = (centreId: string, ...rest: unknown[]) => ['desk', centreId, ...rest];

function useInvalidateDesk() {
  const centreId = useCentreId();
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['desk', centreId] });
}

// ---------- Patients ----------

export const usePatients = (q: string, status: StatusFilter) => {
  const centreId = useCentreId();
  const params = new URLSearchParams();
  if (q.trim()) params.set('q', q.trim());
  if (status !== 'default') params.set('status', status);
  const qs = params.toString();
  return useQuery({
    queryKey: key(centreId, 'patients', q.trim(), status),
    queryFn: () => apiGet<PatientDto[]>(`${base(centreId)}/patients${qs ? `?${qs}` : ''}`),
    enabled: !!centreId,
  });
};

export const usePatient = (id: string) => {
  const centreId = useCentreId();
  return useQuery({
    queryKey: key(centreId, 'patient', id),
    queryFn: () => apiGet<PatientDto>(`${base(centreId)}/patients/${id}`),
    enabled: !!centreId && !!id,
  });
};

export function useCreatePatient() {
  const centreId = useCentreId();
  const invalidate = useInvalidateDesk();
  return useMutation({
    mutationFn: (body: PatientRecord & { login: { username: string; password: string } }) =>
      apiPost<PatientDto>(`${base(centreId)}/patients`, body),
    onSuccess: invalidate,
  });
}

export function useEditPatient() {
  const centreId = useCentreId();
  const invalidate = useInvalidateDesk();
  return useMutation({
    mutationFn: ({ id, ...body }: PatientRecord & { id: string }) => apiPatch<PatientDto>(`${base(centreId)}/patients/${id}`, body),
    onSuccess: invalidate,
  });
}

export function useDischarge() {
  const centreId = useCentreId();
  const invalidate = useInvalidateDesk();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; reason: DischargeReason; date: string }) =>
      apiPost(`${base(centreId)}/patients/${id}/discharge`, body),
    onSuccess: invalidate,
  });
}

export function useResetPatientPassword() {
  const centreId = useCentreId();
  return useMutation({
    mutationFn: ({ userId, password }: { userId: string; password: string }) =>
      apiPost<{ ok: true }>(`${base(centreId)}/users/${userId}/reset-password`, { password }),
  });
}

export const useOrders = (patientId: string, enabled: boolean) => {
  const centreId = useCentreId();
  return useQuery({
    queryKey: key(centreId, 'orders', patientId),
    queryFn: () => apiGet<OrderDto[]>(`${base(centreId)}/patients/${patientId}/orders`),
    enabled: enabled && !!centreId,
  });
};

// ---------- Schedule ----------

export const useGrid = (enabled = true) => {
  const centreId = useCentreId();
  return useQuery({
    queryKey: key(centreId, 'grid'),
    queryFn: () => apiGet<GridDto>(`${base(centreId)}/schedule/grid`),
    enabled: enabled && !!centreId,
  });
};

/** Creates the patient's pattern, or replaces it when `change` is true. */
export function useBookPattern() {
  const centreId = useCentreId();
  const invalidate = useInvalidateDesk();
  return useMutation({
    mutationFn: ({ patientId, change, ...body }: PatternBody & { patientId: string; change: boolean }) =>
      (change ? apiPut : apiPost)(`${base(centreId)}/patients/${patientId}/pattern`, body),
    // Always refresh: on a 409 the grid the user acted on is stale.
    onSettled: invalidate,
  });
}

export const useAssignments = () => {
  const centreId = useCentreId();
  return useQuery({
    queryKey: key(centreId, 'assignments'),
    queryFn: () => apiGet<AssignmentDto[]>(`${base(centreId)}/assignments`),
    enabled: !!centreId,
  });
};

export function useAssignChairs() {
  const centreId = useCentreId();
  const invalidate = useInvalidateDesk();
  return useMutation({
    mutationFn: (body: { shiftId: string; nurseId: string; chairIds: string[] }) => apiPut(`${base(centreId)}/assignments`, body),
    onSettled: invalidate,
  });
}

// ---------- Sessions ----------

export const useDaySessions = (date: string) => {
  const centreId = useCentreId();
  return useQuery({
    queryKey: key(centreId, 'day', date),
    queryFn: async () => {
      const r = await apiGet<{ mine: SessionCardDto[]; unassigned: SessionCardDto[]; others: SessionCardDto[] }>(
        `${base(centreId)}/today?date=${date}`,
      );
      return [...r.mine, ...r.unassigned, ...r.others];
    },
    enabled: !!centreId && /^\d{4}-\d{2}-\d{2}$/.test(date),
  });
};

export function usePostpone() {
  const centreId = useCentreId();
  const invalidate = useInvalidateDesk();
  return useMutation({
    mutationFn: (sessionId: string) => apiPost(`${base(centreId)}/sessions/${sessionId}/postpone`),
    onSettled: invalidate,
  });
}

export function useMakeup() {
  const centreId = useCentreId();
  const invalidate = useInvalidateDesk();
  return useMutation({
    mutationFn: ({ patientId, ...body }: { patientId: string; date: string; chairId: string; shiftId: string }) =>
      apiPost(`${base(centreId)}/patients/${patientId}/makeup`, body),
    onSettled: invalidate,
  });
}

// ---------- Transfers ----------

export const useTransferTargets = (enabled: boolean) => {
  const centreId = useCentreId();
  return useQuery({
    queryKey: key(centreId, 'transfer-targets'),
    queryFn: () => apiGet<{ id: string; name: string }[]>(`${base(centreId)}/transfer-targets`),
    enabled: enabled && !!centreId,
  });
};

export function useSendTransfer() {
  const centreId = useCentreId();
  const invalidate = useInvalidateDesk();
  return useMutation({
    mutationFn: ({ patientId, ...body }: { patientId: string; toCentreId: string; note?: string }) =>
      apiPost(`${base(centreId)}/patients/${patientId}/transfer`, body),
    onSettled: invalidate,
  });
}

export function useTransfers<D extends 'incoming' | 'outgoing'>(direction: D, enabled: boolean) {
  const centreId = useCentreId();
  return useQuery({
    queryKey: key(centreId, 'transfers', direction),
    queryFn: () => apiGet<(D extends 'incoming' ? IncomingTransfer : OutgoingTransfer)[]>(`${base(centreId)}/transfers?direction=${direction}`),
    enabled: enabled && !!centreId,
  });
}

export function useTransferAction() {
  const centreId = useCentreId();
  const invalidate = useInvalidateDesk();
  return useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: 'accept' | 'reject' | 'cancel'; reason?: string }) =>
      apiPost(`${base(centreId)}/transfers/${id}/${action}`, action === 'reject' ? { reason } : undefined),
    onSettled: invalidate,
  });
}

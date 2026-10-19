import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPost, apiPatch, apiPut } from '../../api';
import type { SessionStatus } from '../../sessionStatus';
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
export interface SessionCardDto {
  id: string;
  date: string;
  status: SessionStatus;
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

const base = (centreId: string) => `/centres/${centreId}`;

/** Every desk query is keyed under this prefix so one invalidation refreshes them all. */
const key = (centreId: string, ...rest: unknown[]) => ['desk', centreId, ...rest];

function useInvalidateDesk() {
  const centreId = useCentreId();
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['desk', centreId] });
}

// ---------- Patients ----------

/** A patient list row: the record plus the next scheduled or active session from today. */
export interface PatientListItem extends PatientDto {
  nextSession: { date: string; start: string } | null;
}

export const usePatients = (q: string, status: StatusFilter) => {
  const centreId = useCentreId();
  const params = new URLSearchParams();
  if (q.trim()) params.set('q', q.trim());
  if (status !== 'default') params.set('status', status);
  const qs = params.toString();
  return useQuery({
    queryKey: key(centreId, 'patients', q.trim(), status),
    queryFn: () => apiGet<PatientListItem[]>(`${base(centreId)}/patients${qs ? `?${qs}` : ''}`),
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

export interface PlanItem {
  weekday: number;
  shiftId: string;
  chairId: string;
}
export interface PlanDto {
  id: string;
  patientId: string;
  items: PlanItem[];
  from: string;
  to: string | null;
  repeat: 'once' | 'weekly';
}
export interface PlanBody {
  items: PlanItem[];
  from: string;
  to?: string | null;
}

/** The patient's plan in force today, else the next one to start (null when none). */
export const usePlan = (patientId: string, enabled = true) => {
  const centreId = useCentreId();
  return useQuery({
    queryKey: key(centreId, 'plan', patientId),
    queryFn: async () => (await apiGet<{ plan: PlanDto | null }>(`${base(centreId)}/patients/${patientId}/plan`)).plan,
    enabled: enabled && !!centreId && !!patientId,
  });
};

/** Machines free in a block on a date; with `patientId` that patient's own holds count as free. */
export const useFreeMachines = (date: string, shiftId: string | null, patientId?: string) => {
  const centreId = useCentreId();
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && !!shiftId;
  return useQuery({
    queryKey: key(centreId, 'free', date, shiftId, patientId ?? null),
    queryFn: () => {
      const qs = new URLSearchParams({ date, shiftId: shiftId ?? '', ...(patientId ? { patientId } : {}) });
      return apiGet<{ id: string; label: string }[]>(`${base(centreId)}/schedule/free?${qs}`);
    },
    enabled: !!centreId && valid,
  });
};

/** Books a plan: weekly (`repeat: 'weekly'`) or one-off sessions (`'once'`). */
export function useBookPlan() {
  const centreId = useCentreId();
  const invalidate = useInvalidateDesk();
  return useMutation({
    mutationFn: ({ patientId, ...body }: PlanBody & { patientId: string; repeat: 'once' | 'weekly' }) =>
      apiPost(`${base(centreId)}/patients/${patientId}/plan`, body),
    // Always refresh: on a 409 the free lists the user acted on are stale.
    onSettled: invalidate,
  });
}

/** Replaces the weekly plan from a date. */
export function useChangePlan() {
  const centreId = useCentreId();
  const invalidate = useInvalidateDesk();
  return useMutation({
    mutationFn: ({ patientId, ...body }: PlanBody & { patientId: string }) =>
      apiPut(`${base(centreId)}/patients/${patientId}/plan`, body),
    onSettled: invalidate,
  });
}

// ---------- Nurse roster ----------

export interface RosterEntryDto {
  id: string;
  /** `active` is false once the nurse is deactivated or leaves the centre: the entry then covers nothing. */
  nurse: { id: string; name: string; active: boolean };
  shiftId: string;
  from: string;
  to: string;
  chairs: { id: string; label: string }[];
}
export interface RosterBody {
  nurseId: string;
  shiftIds: string[];
  from: string;
  to: string;
  /** Empty means every machine. */
  chairIds: string[];
}

/** Roster entries overlapping from..to. */
export const useRoster = (from: string, to: string) => {
  const centreId = useCentreId();
  return useQuery({
    queryKey: key(centreId, 'roster', from, to),
    queryFn: () => apiGet<RosterEntryDto[]>(`${base(centreId)}/roster?from=${from}&to=${to}`),
    enabled: !!centreId,
  });
};

export function useCreateRoster() {
  const centreId = useCentreId();
  const invalidate = useInvalidateDesk();
  return useMutation({
    mutationFn: (body: RosterBody) => apiPost<RosterEntryDto[]>(`${base(centreId)}/roster`, body),
    onSettled: invalidate,
  });
}

export function useDeleteRoster() {
  const centreId = useCentreId();
  const invalidate = useInvalidateDesk();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`${base(centreId)}/roster/${id}`),
    onSettled: invalidate,
  });
}

// ---------- Sessions ----------

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
    mutationFn: ({ patientId, ...body }: { patientId: string; date: string; chairId: string; shiftId: string; forSessionId?: string }) =>
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

// ---------- Schedule setup and calendar ----------

export interface SetupDto {
  machines: { id: string; label: string; active: boolean }[];
  blocks: { id: string; name: string; start: string; end: string }[];
  workingDays: number[];
}
export interface SetupBody {
  machineCount: number;
  blocks: { id?: string; name: string; start: string; end: string }[];
  workingDays: number[];
}
export type CalendarCard = SessionCardDto;
export interface CalendarDto {
  days: {
    date: string;
    working: boolean;
    blocks: {
      shiftId: string;
      nurseByChair: Record<string, { id: string; name: string } | null>;
      cells: { chairId: string; session: CalendarCard | null; heldBy: { patientId: string; name: string } | null }[];
    }[];
  }[];
}

export const useSetup = () => {
  const centreId = useCentreId();
  return useQuery({
    queryKey: key(centreId, 'setup'),
    queryFn: () => apiGet<SetupDto>(`${base(centreId)}/schedule/setup`),
    enabled: !!centreId,
  });
};

export function useSaveSetup() {
  const centreId = useCentreId();
  const invalidate = useInvalidateDesk();
  return useMutation({
    mutationFn: (body: SetupBody) => apiPut<SetupDto>(`${base(centreId)}/schedule/setup`, body),
    onSettled: invalidate,
  });
}

export function useRenameMachine() {
  const centreId = useCentreId();
  const invalidate = useInvalidateDesk();
  return useMutation({
    mutationFn: ({ id, label }: { id: string; label: string }) => apiPatch(`${base(centreId)}/chairs/${id}`, { label }),
    onSuccess: invalidate,
  });
}

export const useCalendar = (from: string, to: string) => {
  const centreId = useCentreId();
  return useQuery({
    queryKey: key(centreId, 'calendar', from, to),
    queryFn: () => apiGet<CalendarDto>(`${base(centreId)}/schedule/calendar?from=${from}&to=${to}`),
    enabled: !!centreId,
  });
};

// ---------- Front-desk session actions (the timeline itself is components/timelineApi) ----------

export function useMoveSession() {
  const centreId = useCentreId();
  const invalidate = useInvalidateDesk();
  return useMutation({
    mutationFn: ({ sessionId, ...body }: { sessionId: string; date: string; shiftId: string; chairId: string }) =>
      apiPost(`${base(centreId)}/sessions/${sessionId}/move`, body),
    onSettled: invalidate,
  });
}

export function useCancelSession() {
  const centreId = useCentreId();
  const invalidate = useInvalidateDesk();
  return useMutation({
    mutationFn: ({ sessionId, reason }: { sessionId: string; reason: string }) =>
      apiPost(`${base(centreId)}/sessions/${sessionId}/cancel`, { reason }),
    onSettled: invalidate,
  });
}

export function useDidNotCome() {
  const centreId = useCentreId();
  const invalidate = useInvalidateDesk();
  return useMutation({
    mutationFn: ({ sessionId, reason }: { sessionId: string; reason?: string }) =>
      apiPost(`${base(centreId)}/sessions/${sessionId}/did-not-come`, reason ? { reason } : {}),
    onSettled: invalidate,
  });
}

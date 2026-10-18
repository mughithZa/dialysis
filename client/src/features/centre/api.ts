import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch, apiPost } from '../../api';
import { useCentre } from '../../auth/AuthProvider';
import type { CentreStats } from '../../components/StatsCard';
import type { RoleDto } from '../pm/api';

export interface UserRow {
  id: string;
  username: string;
  name: string;
  phone: string | null;
  active: boolean;
  roleKeys: string[];
}
export interface CentreSettings {
  patientsSeeNotes: boolean;
  reminderHours: number;
}
export interface AuditRow {
  at: string;
  user: { id: string; name: string };
  action: string;
  entity: string;
  entityId: string;
  details: unknown;
}

/** The current centre's id; centre screens are only mounted with one. */
export const useCentreId = () => useCentre().centreId ?? '';

const base = (centreId: string) => `/centres/${centreId}`;

// ---------- Users ----------

export const useCentreUsers = (enabled = true) => {
  const centreId = useCentreId();
  return useQuery({ queryKey: ['users', centreId], queryFn: () => apiGet<UserRow[]>(`${base(centreId)}/users`), enabled: enabled && !!centreId });
};

/** Centre-scope roles only (global roles can never be granted here). */
export const useCentreRoles = () =>
  useQuery({
    queryKey: ['roles'],
    queryFn: () => apiGet<RoleDto[]>('/roles'),
    select: (roles) => roles.filter((r) => r.scope === 'centre'),
  });

export interface NewUser {
  username: string;
  password: string;
  name: string;
  phone?: string;
  roleKeys: string[];
}

export function useCreateUser() {
  const centreId = useCentreId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NewUser) => apiPost<UserRow>(`${base(centreId)}/users`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users', centreId] }),
  });
}

export function useEditUser() {
  const centreId = useCentreId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string; name?: string; phone?: string; active?: boolean; roleKeys?: string[] }) =>
      apiPatch<UserRow>(`${base(centreId)}/users/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users', centreId] }),
  });
}

export function useResetUserPassword() {
  const centreId = useCentreId();
  return useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      apiPost<{ ok: true }>(`${base(centreId)}/users/${id}/reset-password`, { password }),
  });
}

export function useLookupDoctor() {
  const centreId = useCentreId();
  return useMutation({
    mutationFn: (phone: string) =>
      apiGet<{ id: string; name: string }[]>(`${base(centreId)}/users/lookup?phone=${encodeURIComponent(phone)}`),
  });
}

export function useLinkDoctor() {
  const centreId = useCentreId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, roleKeys }: { id: string; roleKeys: string[] }) =>
      apiPost<UserRow>(`${base(centreId)}/users/${id}/link`, { roleKeys }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users', centreId] }),
  });
}

// ---------- Settings ----------

export const useSettings = () => {
  const centreId = useCentreId();
  return useQuery({ queryKey: ['settings', centreId], queryFn: () => apiGet<CentreSettings>(`${base(centreId)}/settings`), enabled: !!centreId });
};

export function useSaveSettings() {
  const centreId = useCentreId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<CentreSettings>) => apiPatch<CentreSettings>(`${base(centreId)}/settings`, body),
    onSuccess: (data) => qc.setQueryData(['settings', centreId], data),
  });
}

// ---------- Audit & stats ----------

export const useAudit = (userId: string) => {
  const centreId = useCentreId();
  const qs = userId ? `?userId=${encodeURIComponent(userId)}` : '';
  return useQuery({ queryKey: ['audit', centreId, userId], queryFn: () => apiGet<AuditRow[]>(`${base(centreId)}/audit${qs}`), enabled: !!centreId });
};

export const useCentreStats = (month: string) => {
  const centreId = useCentreId();
  return useQuery({
    queryKey: ['centre-stats', centreId, month],
    queryFn: () => apiGet<CentreStats>(`${base(centreId)}/stats?month=${month}`),
    enabled: !!centreId && /^\d{4}-\d{2}$/.test(month),
  });
};

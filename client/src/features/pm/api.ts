import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch, apiPost } from '../../api';
import type { CentreStats } from '../../components/StatsCard';

export interface Centre {
  id: string;
  name: string;
  status: 'active' | 'closed';
}
export interface Manager {
  id: string;
  username: string;
  name: string;
  phone?: string;
  active: boolean;
}
export interface NewCentre {
  name: string;
  manager: { username: string; password: string; name: string; phone?: string };
}
export interface RoleDto {
  id: string;
  key: string;
  name: string;
  scope: 'global' | 'centre';
  permissions: string[];
  system: boolean;
}
export interface PermissionDto {
  key: string;
  category: string;
}
export type ItemType = 'medicine' | 'supply';
export interface UnitDto {
  id: string;
  name: string;
}
export interface ItemDto {
  id: string;
  name: string;
  type: ItemType;
  unitId: string;
  status: 'pending' | 'approved' | 'retired';
  mergedInto: string | null;
  used: boolean;
}

// ---------- Centres ----------

export const useCentres = () => useQuery({ queryKey: ['centres'], queryFn: () => apiGet<Centre[]>('/centres') });

export function useCreateCentre() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NewCentre) => apiPost<{ centre: Centre; managerId: string }>('/centres', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['centres'] }),
  });
}

export function useSetCentreStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'close' | 'reopen' }) => apiPost<Centre>(`/centres/${id}/${action}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['centres'] }),
  });
}

export const useManagers = (centreId: string, enabled: boolean) =>
  useQuery({ queryKey: ['managers', centreId], queryFn: () => apiGet<Manager[]>(`/centres/${centreId}/managers`), enabled });

export const useResetManagerPassword = (centreId: string) =>
  useMutation({
    mutationFn: ({ userId, password }: { userId: string; password: string }) =>
      apiPost<{ ok: true }>(`/centres/${centreId}/managers/${userId}/reset-password`, { password }),
  });

// ---------- Roles ----------

export const useRoles = () => useQuery({ queryKey: ['roles'], queryFn: () => apiGet<RoleDto[]>('/roles') });
export const usePermissions = () => useQuery({ queryKey: ['permissions'], queryFn: () => apiGet<PermissionDto[]>('/permissions') });

/** `id` null creates a new centre role. */
export function useSaveRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name, permissions }: { id: string | null; name: string; permissions: string[] }) =>
      id ? apiPatch<RoleDto>(`/roles/${id}`, { name, permissions }) : apiPost<RoleDto>('/roles', { name, permissions }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roles'] }),
  });
}

// ---------- Catalogue ----------

export const useUnits = () => useQuery({ queryKey: ['units'], queryFn: () => apiGet<UnitDto[]>('/catalog/units') });
export const useItems = () => useQuery({ queryKey: ['items'], queryFn: () => apiGet<ItemDto[]>('/catalog/items') });

export function useAddUnit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => apiPost<UnitDto>('/catalog/units', { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['units'] }),
  });
}

export function useUpdateItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string; name?: string; unitId?: string; status?: ItemDto['status'] }) =>
      apiPatch<ItemDto>(`/catalog/items/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['items'] }),
  });
}

export function useMergeItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, intoId }: { id: string; intoId: string }) => apiPost(`/catalog/items/${id}/merge`, { intoId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['items'] }),
  });
}

// ---------- Dashboard ----------

export const useStats = (month: string) =>
  useQuery({ queryKey: ['stats', month], queryFn: () => apiGet<CentreStats[]>(`/stats?month=${month}`), enabled: /^\d{4}-\d{2}$/.test(month) });

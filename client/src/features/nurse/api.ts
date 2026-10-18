import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPatch, apiPost } from '../../api';
import { useCentreId } from '../centre/api';
import type { ItemDto, ItemType, UnitDto } from '../pm/api';

import type { SessionStatus } from '../../sessionStatus';

export type { SessionStatus };

export interface SessionCard {
  id: string;
  date: string;
  status: SessionStatus;
  kind: 'regular' | 'makeup';
  chair: { id: string; label: string };
  shift: { id: string; name: string; start: string; end: string };
  /** Snapshots taken when the session was booked (refreshed only while it is still scheduled). */
  chairLabel: string;
  start: string;
  end: string;
  patient: { id: string; name: string };
  hasActiveOrders: boolean;
}
export interface UsageLineDto {
  id: string;
  item: { id: string; name: string; type: ItemType; unit: string };
  amount: number;
  by: { id: string; name: string };
  at: string;
}
export interface NoteDto {
  id: string;
  at: string;
  by: { id: string; name: string };
  text: string;
}
export interface OrderDto {
  id: string;
  text: string;
  from: string;
  doctor: { id: string; name: string };
}
export interface SessionDetail extends SessionCard {
  vitals: { weightBefore: number | null; weightAfter: number | null; bp: { at: string; systolic: number; diastolic: number }[] };
  notes: NoteDto[];
  usage: UsageLineDto[];
  orders: OrderDto[];
  /** Patient-level doctor notes from the last 30 days, newest first. */
  recentNotes: { id: string; at: string; text: string; author: { name: string } }[];
}
export interface ChangeDto {
  id: string;
  at: string;
  kind: string;
  by: { id: string; name: string };
  before: unknown;
  after: unknown;
}

const ROOT = 'nurse';
const CATALOG = 'nurse-catalog';

export function useSession(id: string) {
  const centreId = useCentreId();
  return useQuery({
    queryKey: [ROOT, centreId, 'session', id],
    queryFn: () => apiGet<SessionDetail>(`/centres/${centreId}/sessions/${id}`),
    enabled: !!centreId && !!id,
  });
}

export function useHistory(id: string, enabled: boolean) {
  const centreId = useCentreId();
  return useQuery({
    queryKey: [ROOT, centreId, 'session', id, 'history'],
    queryFn: () => apiGet<ChangeDto[]>(`/centres/${centreId}/sessions/${id}/history`),
    enabled: enabled && !!centreId && !!id,
  });
}

/** A write on one session; afterwards today's list and the session are refetched. */
function useSessionWrite<V>(id: string, fn: (base: string, v: V) => Promise<unknown>) {
  const centreId = useCentreId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: V) => fn(`/centres/${centreId}/sessions/${id}`, v),
    onSuccess: () => qc.invalidateQueries({ queryKey: [ROOT, centreId] }),
  });
}

export const useSessionAction = (id: string) => useSessionWrite<'open' | 'close' | 'postpone'>(id, (base, action) => apiPost(`${base}/${action}`));
export const useAddUsage = (id: string) =>
  useSessionWrite<{ itemId: string; amount: number }>(id, (base, v) => apiPost(`${base}/usage`, v));
export const useUpdateUsage = (id: string) =>
  useSessionWrite<{ lineId: string; amount: number }>(id, (base, v) => apiPatch(`${base}/usage/${v.lineId}`, { amount: v.amount }));
export const useRemoveUsage = (id: string) => useSessionWrite<string>(id, (base, lineId) => apiDelete(`${base}/usage/${lineId}`));
export const useSaveWeights = (id: string) =>
  useSessionWrite<{ weightBefore?: number; weightAfter?: number }>(id, (base, v) => apiPatch(`${base}/vitals`, v));
export const useAddBp = (id: string) =>
  useSessionWrite<{ systolic: number; diastolic: number }>(id, (base, v) => apiPost(`${base}/vitals/bp`, v));
export const useAddNote = (id: string) => useSessionWrite<string>(id, (base, text) => apiPost(`${base}/notes`, { text }));
export const useUpdateNote = (id: string) =>
  useSessionWrite<{ noteId: string; text: string }>(id, (base, v) => apiPatch(`${base}/notes/${v.noteId}`, { text: v.text }));
export const useRemoveNote = (id: string) => useSessionWrite<string>(id, (base, noteId) => apiDelete(`${base}/notes/${noteId}`));

// ---------- Catalogue (read for the picker; nurses may propose items) ----------

export const useCatalogItems = () => useQuery({ queryKey: [CATALOG, 'items'], queryFn: () => apiGet<ItemDto[]>('/catalog/items') });
export const useCatalogUnits = () => useQuery({ queryKey: [CATALOG, 'units'], queryFn: () => apiGet<UnitDto[]>('/catalog/units') });

export function useAddItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; type: ItemType; unitId: string }) => apiPost<ItemDto>('/catalog/items', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: [CATALOG, 'items'] }),
  });
}

export function useAddUnit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => apiPost<UnitDto>('/catalog/units', { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [CATALOG, 'units'] }),
  });
}

/** True for any item whose name contains "heparin" (case-insensitive), e.g. "Heparin sodium". */
export const isHeparin = (name: string) => name.trim().toLowerCase().includes('heparin');
export const hasHeparin = (usage: UsageLineDto[]) => usage.some((u) => isHeparin(u.item.name));

/** Up to 5 quick chips: Heparin first (when in the catalogue), then the items used most recently in this session. */
export function quickItems(items: ItemDto[], usage: UsageLineDto[]): ItemDto[] {
  const out: ItemDto[] = [];
  const add = (i: ItemDto | undefined) => {
    if (i && !out.some((o) => o.id === i.id)) out.push(i);
  };
  add(items.find((i) => isHeparin(i.name)));
  for (const u of [...usage].reverse()) add(items.find((i) => i.id === u.item.id));
  return out.slice(0, 5);
}

import type { CentreStats, ItemTotal } from '../StatsCard';

/** This month as `YYYY-MM` (device clock). */
export const currentMonth = (now = new Date()): string =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

/** `YYYY-MM` moved by `by` months, e.g. shiftMonth('2026-01', -1) = '2025-12'. */
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(y, m - 1 + by, 1);
  return currentMonth(d);
}

/** The change from the previous month: absolute and, when there was something before, in percent. */
export interface Delta {
  diff: number;
  /** null when the previous value was 0 (no meaningful percentage). */
  pct: number | null;
}

export const delta = (current: number, previous: number): Delta => ({
  diff: current - previous,
  pct: previous > 0 ? Math.round(((current - previous) / previous) * 100) : null,
});

/** Network-wide totals for the dashboard's headline cards. */
export interface NetworkTotals {
  centres: number;
  sessions: number;
  patients: number;
  /** Distinct medicines given (units differ between items, so amounts are not added up). */
  medicines: number;
}

export function networkTotals(stats: CentreStats[]): NetworkTotals {
  const meds = new Set<string>();
  for (const s of stats) for (const m of s.medicines) if (m.total > 0) meds.add(m.item.id);
  return {
    centres: stats.length,
    sessions: stats.reduce((a, s) => a + s.sessions, 0),
    patients: stats.reduce((a, s) => a + s.patients, 0),
    medicines: meds.size,
  };
}

/** One centre's sessions this month and last month. */
export interface CentreComparison {
  id: string;
  name: string;
  current: number;
  previous: number;
}

/** Every centre of either month (a centre created this month has 0 last month), in this month's order. */
export function compareCentres(current: CentreStats[], previous: CentreStats[] | undefined): CentreComparison[] {
  const prev = new Map((previous ?? []).map((s) => [s.centre.id, s.sessions]));
  return current.map((s) => ({ id: s.centre.id, name: s.centre.name, current: s.sessions, previous: prev.get(s.centre.id) ?? 0 }));
}

/** An item's bar: its share of the largest total in the same unit (amounts in different units cannot be compared). */
export interface UsageBar extends ItemTotal {
  share: number;
}

export function usageBars(rows: ItemTotal[]): UsageBar[] {
  const maxByUnit = new Map<string, number>();
  for (const r of rows) maxByUnit.set(r.unit, Math.max(maxByUnit.get(r.unit) ?? 0, r.total));
  return rows
    .map((r) => ({ ...r, share: (maxByUnit.get(r.unit) ?? 0) > 0 ? r.total / maxByUnit.get(r.unit)! : 0 }))
    .sort((a, b) => b.total - a.total || a.item.name.localeCompare(b.item.name));
}

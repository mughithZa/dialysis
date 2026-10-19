import { useEffect, useState } from 'react';
import type { TFunction } from 'i18next';

/** Whole minutes from `fromIso` to `to` (never negative). */
export function elapsedMinutes(fromIso: string, to: Date = new Date()): number {
  const ms = to.getTime() - new Date(fromIso).getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 60_000)) : 0;
}

/** "45 min", "2 h", "1 h 20 min" (and the Arabic equivalents). */
export function formatElapsed(t: TFunction, minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return t('nurse.elapsed.min', { m });
  if (m === 0) return t('nurse.elapsed.h', { h });
  return t('nurse.elapsed.hMin', { h, m });
}

/** The current time, refreshed every `everyMs` (default one minute) so running timers tick. */
export function useNow(everyMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

/** Weight lost during dialysis (ultrafiltration), before minus after, to 0.1 kg; null unless both are known. */
export function weightLoss(before: number | null | undefined, after: number | null | undefined): number | null {
  if (before == null || after == null || !Number.isFinite(before) || !Number.isFinite(after)) return null;
  return Math.round((before - after) * 10) / 10;
}

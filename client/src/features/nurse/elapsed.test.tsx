import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import i18n from '../../i18n';
import { elapsedMinutes, formatElapsed, useNow, weightLoss } from './elapsed';

describe('elapsed time', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts whole minutes and never goes negative', () => {
    const now = new Date('2026-10-19T10:00:00Z');
    expect(elapsedMinutes('2026-10-19T08:40:00Z', now)).toBe(80);
    expect(elapsedMinutes('2026-10-19T09:59:01Z', now)).toBe(0);
    expect(elapsedMinutes('2026-10-19T10:05:00Z', now)).toBe(0);
    expect(elapsedMinutes('not a date', now)).toBe(0);
  });

  it('formats minutes, hours, and both, in English and Arabic', async () => {
    const t = i18n.getFixedT('en');
    expect(formatElapsed(t, 0)).toBe('0 min');
    expect(formatElapsed(t, 45)).toBe('45 min');
    expect(formatElapsed(t, 120)).toBe('2 h');
    expect(formatElapsed(t, 80)).toBe('1 h 20 min');
    const ar = i18n.getFixedT('ar');
    expect(formatElapsed(ar, 80)).toBe('1 ساعة و20 دقيقة');
    expect(formatElapsed(ar, 45)).toBe('45 دقيقة');
  });

  it('useNow ticks every minute', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T10:00:00Z'));
    const { result, unmount } = renderHook(() => useNow());
    expect(result.current.toISOString()).toBe('2026-10-19T10:00:00.000Z');
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current.toISOString()).toBe('2026-10-19T10:01:00.000Z');
    unmount();
  });
});

describe('weightLoss', () => {
  it('is before minus after, rounded to 0.1 kg', () => {
    expect(weightLoss(74.1, 71.8)).toBe(2.3);
    expect(weightLoss(70, 70)).toBe(0);
    expect(weightLoss(70, 70.4)).toBe(-0.4);
  });

  it('is unknown until both weights are known', () => {
    expect(weightLoss(74.1, null)).toBeNull();
    expect(weightLoss(null, 71)).toBeNull();
    expect(weightLoss(undefined, undefined)).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { todayLocal, weekdayOf, addDays, localDateTime, monthRange } from './dates.js';

describe('dates (APP_TZ=Asia/Damascus, UTC+3)', () => {
  it('todayLocal uses Damascus date late in the evening', () => {
    expect(todayLocal(new Date('2026-10-18T21:30:00Z'))).toBe('2026-10-19');
  });
  it('weekdayOf', () => {
    expect(weekdayOf('2026-10-17')).toBe(6); // Saturday
    expect(weekdayOf('2026-10-18')).toBe(0); // Sunday
  });
  it('addDays', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('localDateTime', () => {
    expect(localDateTime('2026-10-19', '07:00').toISOString()).toBe('2026-10-19T04:00:00.000Z');
  });
  it('monthRange', () => {
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });
});

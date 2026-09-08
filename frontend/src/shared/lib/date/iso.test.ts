import { describe, it, expect } from 'vitest';
import {
  addDaysIso,
  isIsoDate,
  isRealIsoDate,
  formatLongDate,
  formatWeekday,
  formatShortDate,
} from './iso';

describe('iso dates', () => {
  it('adds days across month and year boundaries without touching time zones', () => {
    expect(addDaysIso('2026-09-08', -1)).toBe('2026-09-07');
    expect(addDaysIso('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('recognises only YYYY-MM-DD', () => {
    expect(isIsoDate('2026-09-08')).toBe(true);
    expect(isIsoDate('8.9.2026')).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });
  it('tells a real calendar day from one that is merely shaped like one', () => {
    expect(isRealIsoDate('2026-09-08')).toBe(true);
    // Shaped right but rolls over (31 February does not exist).
    expect(isRealIsoDate('2026-02-31')).toBe(false);
    // Shaped right but not even parseable (month 00).
    expect(isRealIsoDate('2026-00-10')).toBe(false);
    expect(isRealIsoDate('not-a-date')).toBe(false);
  });
  it('formats for people in uk and en', () => {
    expect(formatLongDate('2026-09-08', 'uk')).toBe('8 вересня 2026');
    expect(formatWeekday('2026-09-08', 'uk')).toBe('вівторок');
    expect(formatShortDate('2026-09-08', 'uk')).toBe('08.09');
    expect(formatLongDate('2026-09-08', 'en')).toBe('September 8, 2026');
  });
});

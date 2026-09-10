import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  addDaysIso,
  isIsoDate,
  isRealIsoDate,
  formatLongDate,
  formatWeekday,
  formatShortDate,
  formatTime,
  formatDateTime,
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

  // `formatTime`/`formatDateTime` take a full timestamp (a transfer's
  // `sent_at`), not a business-date string — unlike every helper above they
  // deliberately go through the LOCAL time zone (no `timeZone: 'UTC'`), the
  // same way `TransferHistory` formatted `sent_at` by hand before this file
  // existed. Pinned to `TZ=UTC` here so the expectation is a fixed literal
  // regardless of the machine running the suite.
  describe('time formatting (local time zone, on purpose — full timestamps, not business dates)', () => {
    const originalTz = process.env.TZ;
    beforeAll(() => {
      process.env.TZ = 'UTC';
    });
    afterAll(() => {
      process.env.TZ = originalTz;
    });

    it('formats a full ISO timestamp as a 2-digit hour:minute', () => {
      expect(formatTime('2026-09-10T08:05:00.000Z', 'uk')).toBe('08:05');
      expect(formatTime('2026-09-10T21:05:00.000Z', 'uk')).toBe('21:05');
    });

    it('formats short day.month, then the time — exactly what TransferHistory renders for sent_at', () => {
      expect(formatDateTime('2026-09-10T08:05:00.000Z', 'uk')).toBe('10.09 · 08:05');
    });
  });
});

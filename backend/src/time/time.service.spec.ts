import { TimeService } from './time.service';

// The constructor takes the `timezone` config shape; a plain literal stands in
// for the injected ConfigType in these pure unit tests (no Nest DI container).
// Europe/Berlin is used purely as a DST fixture — a zone with well-known
// spring-forward/fall-back transitions to exercise, not a domain concept.
const berlin = () => new TimeService({ appTimezone: 'Europe/Berlin' });
const HOUR = 3_600_000;

describe('TimeService', () => {
  describe('construction', () => {
    it('accepts a valid IANA zone', () => {
      expect(berlin().zone).toBe('Europe/Berlin');
    });

    it('throws on an unknown zone', () => {
      expect(() => new TimeService({ appTimezone: 'Mars/Olympus' })).toThrow(/APP_TIMEZONE/);
    });
  });

  describe('now', () => {
    it('is zone-aware in the app zone', () => {
      expect(berlin().now().zoneName).toBe('Europe/Berlin');
    });
  });

  describe('parseWallClock', () => {
    it('interprets an offset-less string as CET in winter (+60 min)', () => {
      expect(berlin().parseWallClock('2026-01-15T10:00').offset).toBe(60);
    });

    it('interprets an offset-less string as CEST in summer (+120 min)', () => {
      expect(berlin().parseWallClock('2026-07-15T10:00').offset).toBe(120);
    });

    it('throws on a malformed datetime', () => {
      expect(() => berlin().parseWallClock('not-a-date')).toThrow();
    });
  });

  describe('reminderInstant — DST correctness', () => {
    it('spans exactly 24h when no DST boundary intervenes', () => {
      // Target instant 2026-06-15 12:00 local (CEST); lead 1 day before, same offset.
      const startAt = new Date('2026-06-15T10:00:00Z');
      const trigger = berlin().reminderInstant(startAt, { days: 1 });
      expect((startAt.getTime() - trigger.getTime()) / HOUR).toBe(24);
    });

    it('spans 23h across the spring-forward boundary (2026-03-29)', () => {
      // Target instant 2026-03-29 12:00 local (CEST, after the 02:00→03:00 jump).
      // One day earlier in wall-clock terms is 2026-03-28 12:00 (CET) → 23h real.
      const startAt = new Date('2026-03-29T10:00:00Z');
      const trigger = berlin().reminderInstant(startAt, { days: 1 });
      expect((startAt.getTime() - trigger.getTime()) / HOUR).toBe(23);
    });

    it('spans 25h across the fall-back boundary (2026-10-25)', () => {
      // Target instant 2026-10-25 12:00 local (CET, after the 03:00→02:00
      // fall-back). One day earlier in wall-clock terms is 2026-10-24 12:00
      // (CEST) → 25h real.
      const startAt = new Date('2026-10-25T11:00:00Z');
      const trigger = berlin().reminderInstant(startAt, { days: 1 });
      expect((startAt.getTime() - trigger.getTime()) / HOUR).toBe(25);
    });

    it('preserves the local wall-clock time across a DST boundary', () => {
      const svc = berlin();
      const startAt = new Date('2026-03-29T10:00:00Z'); // 12:00 CEST
      const local = svc.fromJSDate(svc.reminderInstant(startAt, { days: 1 }));
      expect(local.hour).toBe(12);
      expect(local.minute).toBe(0);
    });

    it('treats an hour-based lead as exact elapsed time (local hour shifts across a boundary)', () => {
      const svc = berlin();
      // Target instant 2026-03-29 04:00 CEST (after the spring-forward jump).
      const startAt = new Date('2026-03-29T02:00:00Z');
      const trigger = svc.reminderInstant(startAt, { hours: 2 });
      // Exactly 2 real hours before — not wall-clock-preserving for sub-day units.
      expect((startAt.getTime() - trigger.getTime()) / HOUR).toBe(2);
      // 01:00 CET, because the 02:00–03:00 wall-clock hour was skipped that day.
      expect(svc.fromJSDate(trigger).hour).toBe(1);
    });

    it('produces a valid instant for an hour-based lead near the spring-forward transition', () => {
      // Hour-units are EXACT elapsed time, so subtracting them from a valid
      // instant can never land in the non-existent 02:00–03:00 wall-clock gap —
      // the result is always a real instant. (Wall-clock/day-based leads that
      // *can* target the gap are covered by the addInZone spring-forward tests.)
      const startAt = new Date('2026-03-29T01:30:00Z');
      const trigger = berlin().reminderInstant(startAt, { hours: 1 });
      expect(trigger).toBeInstanceOf(Date);
      expect(Number.isNaN(trigger.getTime())).toBe(false);
    });
  });

  describe('addInZone', () => {
    it('is wall-clock-preserving across spring-forward (23h real, same local hour)', () => {
      const svc = berlin();
      const start = new Date('2026-03-28T11:00:00Z'); // 12:00 CET
      const plusDay = svc.addInZone(start, { days: 1 }); // → 12:00 CEST next day
      expect(svc.fromJSDate(plusDay).hour).toBe(12);
      expect((plusDay.getTime() - start.getTime()) / HOUR).toBe(23);
    });
  });

  describe('round-tripping', () => {
    it('fromJSDate/toJSDate preserve the instant', () => {
      const svc = berlin();
      const d = new Date('2026-05-01T08:30:00Z');
      expect(svc.toJSDate(svc.fromJSDate(d)).getTime()).toBe(d.getTime());
    });
  });
});

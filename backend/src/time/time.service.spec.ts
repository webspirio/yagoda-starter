import { DateTime } from 'luxon';
import { TimeService } from './time.service';

// The constructor takes the `timezone` config shape; a plain literal stands in
// for the injected ConfigType in these pure unit tests (no Nest DI container).
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
      // Event 2026-06-15 12:00 Berlin (CEST); reminder 1 day before, same offset.
      const eventStart = new Date('2026-06-15T10:00:00Z');
      const reminder = berlin().reminderInstant(eventStart, { days: 1 });
      expect((eventStart.getTime() - reminder.getTime()) / HOUR).toBe(24);
    });

    it('spans 23h across the spring-forward boundary (2026-03-29)', () => {
      // Event 2026-03-29 12:00 Berlin (CEST, after the 02:00→03:00 jump). One day
      // earlier in wall-clock terms is 2026-03-28 12:00 (CET) → 23h of real time.
      const eventStart = new Date('2026-03-29T10:00:00Z');
      const reminder = berlin().reminderInstant(eventStart, { days: 1 });
      expect((eventStart.getTime() - reminder.getTime()) / HOUR).toBe(23);
    });

    it('spans 25h across the fall-back boundary (2026-10-25)', () => {
      // Event 2026-10-25 12:00 Berlin (CET, after the 03:00→02:00 fall-back). One
      // day earlier in wall-clock terms is 2026-10-24 12:00 (CEST) → 25h real.
      const eventStart = new Date('2026-10-25T11:00:00Z');
      const reminder = berlin().reminderInstant(eventStart, { days: 1 });
      expect((eventStart.getTime() - reminder.getTime()) / HOUR).toBe(25);
    });

    it('preserves the local wall-clock time across a DST boundary', () => {
      const svc = berlin();
      const eventStart = new Date('2026-03-29T10:00:00Z'); // 12:00 CEST
      const local = svc.fromJSDate(svc.reminderInstant(eventStart, { days: 1 }));
      expect(local.hour).toBe(12);
      expect(local.minute).toBe(0);
    });

    it('treats an hour-based lead as exact elapsed time (local hour shifts across a boundary)', () => {
      const svc = berlin();
      // Event 2026-03-29 04:00 CEST (after the spring-forward jump).
      const eventStart = new Date('2026-03-29T02:00:00Z');
      const reminder = svc.reminderInstant(eventStart, { hours: 2 });
      // Exactly 2 real hours before — not wall-clock-preserving for sub-day units.
      expect((eventStart.getTime() - reminder.getTime()) / HOUR).toBe(2);
      // 01:00 CET, because the 02:00–03:00 wall-clock hour was skipped that day.
      expect(svc.fromJSDate(reminder).hour).toBe(1);
    });

    it('produces a valid instant for an hour-based lead near the spring-forward transition', () => {
      // Hour-units are EXACT elapsed time, so subtracting them from a valid
      // instant can never land in the non-existent 02:00–03:00 wall-clock gap —
      // the result is always a real instant. (Wall-clock/day-based leads that
      // *can* target the gap are covered by the addInZone spring-forward tests.)
      const eventStart = new Date('2026-03-29T01:30:00Z');
      const reminder = berlin().reminderInstant(eventStart, { hours: 1 });
      expect(reminder).toBeInstanceOf(Date);
      expect(Number.isNaN(reminder.getTime())).toBe(false);
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

  describe('calendarRange — half-open calendar periods', () => {
    describe('month', () => {
      it('starts at local midnight on the 1st and ends at local midnight on the next 1st', () => {
        const svc = berlin();
        const { start, endExclusive } = svc.calendarRange(
          svc.parseWallClock('2026-08-15T13:45'),
          'month',
        );
        expect(start.toISO()).toBe('2026-08-01T00:00:00.000+02:00');
        expect(endExclusive.toISO()).toBe('2026-09-01T00:00:00.000+02:00');
      });

      it('spans 743 real hours for the month containing spring-forward (2026-03-29)', () => {
        const svc = berlin();
        const { start, endExclusive } = svc.calendarRange(
          svc.parseWallClock('2026-03-15T12:00'),
          'month',
        );
        // A fixed 31×24h window would overrun the month by the skipped hour and
        // pull 2026-04-01T00:00 CEST into March's bucket.
        expect((endExclusive.toMillis() - start.toMillis()) / HOUR).toBe(743);
        expect(start.offset).toBe(60); // CET on 1 March …
        expect(endExclusive.offset).toBe(120); // … CEST at the exclusive end
      });

      it('spans 745 real hours for the month containing fall-back (2026-10-25)', () => {
        const svc = berlin();
        const { start, endExclusive } = svc.calendarRange(
          svc.parseWallClock('2026-10-15T12:00'),
          'month',
        );
        expect((endExclusive.toMillis() - start.toMillis()) / HOUR).toBe(745);
        expect(start.offset).toBe(120);
        expect(endExclusive.offset).toBe(60);
      });

      it('keeps the doubled fall-back hour inside its own month', () => {
        const svc = berlin();
        const { start, endExclusive } = svc.calendarRange(
          svc.parseWallClock('2026-10-25T02:30'),
          'month',
        );
        expect(start.month).toBe(10);
        expect(endExclusive.month).toBe(11);
      });
    });

    describe('quarter', () => {
      it('bounds Q1 as [1 Jan, 1 Apr) — 2159 hours, because the 2026-03-29 spring-forward sits inside it', () => {
        const svc = berlin();
        const { start, endExclusive } = svc.calendarRange(
          svc.parseWallClock('2026-02-10T09:00'),
          'quarter',
        );
        expect(start.toISO()).toBe('2026-01-01T00:00:00.000+01:00');
        expect(endExclusive.toISO()).toBe('2026-04-01T00:00:00.000+02:00');
        expect((endExclusive.toMillis() - start.toMillis()) / HOUR).toBe(2159); // 90×24 − 1
      });

      it('tiles Q1 and Q2 with no gap and no overlap at the shared boundary', () => {
        const svc = berlin();
        const q1 = svc.calendarRange(svc.parseWallClock('2026-02-10T09:00'), 'quarter');
        const q2 = svc.calendarRange(svc.parseWallClock('2026-05-10T09:00'), 'quarter');
        // The whole point of the half-open bound: one shared instant, owned by Q2.
        expect(q1.endExclusive.toMillis()).toBe(q2.start.toMillis());
      });

      it('spans 2209 hours for Q4, which contains the fall-back', () => {
        const svc = berlin();
        const { start, endExclusive } = svc.calendarRange(
          svc.parseWallClock('2026-11-10T09:00'),
          'quarter',
        );
        expect(start.toISO()).toBe('2026-10-01T00:00:00.000+02:00');
        expect(endExclusive.toISO()).toBe('2027-01-01T00:00:00.000+01:00');
        expect((endExclusive.toMillis() - start.toMillis()) / HOUR).toBe(2209); // 92×24 + 1
      });
    });

    describe('year', () => {
      it('starts an hour before UTC midnight, because the boundary is a Berlin wall-clock fact', () => {
        const svc = berlin();
        const { start, endExclusive } = svc.calendarRange(
          svc.parseWallClock('2026-06-01T12:00'),
          'year',
        );
        // The trap: a UTC-naive startOf('year') would return 2026-01-01T00:00Z,
        // an hour late, silently moving New Year's Eve into the wrong year.
        expect(start.toUTC().toISO()).toBe('2025-12-31T23:00:00.000Z');
        expect(endExclusive.toUTC().toISO()).toBe('2026-12-31T23:00:00.000Z');
      });
    });

    describe('input handling', () => {
      it('re-zones a UTC input before finding the boundary', () => {
        const svc = berlin();
        // 2025-12-31T23:00Z IS 2026-01-01T00:00 Berlin — it belongs to 2026.
        const { start } = svc.calendarRange(
          DateTime.fromISO('2025-12-31T23:00:00Z', { zone: 'utc' }),
          'year',
        );
        expect(start.year).toBe(2026);
      });

      it('is idempotent — re-ranging a start instant returns the same range', () => {
        const svc = berlin();
        const first = svc.calendarRange(svc.parseWallClock('2026-08-15T13:45'), 'quarter');
        const again = svc.calendarRange(first.start, 'quarter');
        expect(again.start.toMillis()).toBe(first.start.toMillis());
        expect(again.endExclusive.toMillis()).toBe(first.endExclusive.toMillis());
      });

      it("never returns luxon's endOf() — the exclusive end is a clean midnight, not …23:59:59.999", () => {
        const svc = berlin();
        const at = svc.parseWallClock('2026-08-15T13:45');
        const { endExclusive } = svc.calendarRange(at, 'month');
        expect(endExclusive.millisecond).toBe(0);
        // The 1ms hole a `<=` endOf() bound would leave: any timestamptz value
        // in it (…23:59:59.999123) would be dropped from every bucket.
        expect(endExclusive.toMillis() - at.endOf('month').toMillis()).toBe(1);
      });
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

import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { DateTime, IANAZone, type DurationLike } from 'luxon';
import { timezoneConfig } from '../config/timezone.config';

/**
 * The single seam for timezone-aware time in the backend. Every feature that
 * reasons about wall-clock time (scheduled tasks, deferred jobs, reminders)
 * injects this instead of touching `luxon` or raw `Date` arithmetic directly,
 * so the canonical zone (configured via `APP_TIMEZONE`) and its DST rules are
 * applied consistently across the app.
 *
 * Storage stays UTC (`timestamptz` → JS `Date`); this service is the read/compute
 * layer that projects those instants into the app zone and back.
 */
@Injectable()
export class TimeService {
  /** The resolved IANA zone, e.g. `Europe/Berlin`. */
  readonly zone: string;

  constructor(@Inject(timezoneConfig.KEY) config: ConfigType<typeof timezoneConfig>) {
    if (!IANAZone.isValidZone(config.appTimezone)) {
      throw new Error(`Invalid APP_TIMEZONE: "${config.appTimezone}" is not a known IANA zone`);
    }
    this.zone = config.appTimezone;
  }

  /** Current instant, as a zone-aware `DateTime` in the app zone. */
  now(): DateTime {
    return DateTime.now().setZone(this.zone);
  }

  /** Interpret a stored UTC instant in the app zone. */
  fromJSDate(date: Date): DateTime {
    return DateTime.fromJSDate(date, { zone: this.zone });
  }

  /** Project a zone-aware `DateTime` back to a UTC `Date` for storage. */
  toJSDate(dt: DateTime): Date {
    return dt.toJSDate();
  }

  /**
   * Parse an offset-less local datetime (e.g. `2026-03-29T10:00`) as a wall-clock
   * time in the app zone. Times in a spring-forward gap shift forward and
   * ambiguous fall-back times resolve deterministically (Luxon defaults), so this
   * never returns an invalid result for a syntactically valid string.
   */
  parseWallClock(isoLocal: string): DateTime {
    const dt = DateTime.fromISO(isoLocal, { zone: this.zone });
    if (!dt.isValid) {
      throw new Error(`Invalid wall-clock datetime "${isoLocal}": ${dt.invalidReason}`);
    }
    return dt;
  }

  /**
   * DST-correct "fire `lead` before `eventStart`", returning the instant a
   * scheduler would store as the trigger timestamp for a delayed action.
   *
   * `lead` is a Luxon duration, applied with the semantics that fit its unit —
   * which is exactly what you want on either side of a DST change:
   *   - calendar units ({days}, {weeks}, {months}) are wall-clock-preserving, so
   *     "1 day before" a 10:00 event stays at 10:00 local and spans 23h/25h of
   *     real time across a boundary rather than a naive fixed 24h;
   *   - exact units ({hours}, {minutes}) are fixed elapsed time, so "2h before"
   *     is always 2 real hours — its local wall-clock shifts by an hour when a
   *     transition falls between (a 2h lead before 04:00 CEST lands at 01:00 CET).
   * Choose the unit that matches the intent (a "day before" vs. a "2 hours before"
   * reminder).
   */
  reminderInstant(eventStart: Date, lead: DurationLike): Date {
    return this.fromJSDate(eventStart).minus(lead).toJSDate();
  }

  /** DST-correct wall-clock addition of a duration in the app zone. */
  addInZone(instant: Date, duration: DurationLike): Date {
    return this.fromJSDate(instant).plus(duration).toJSDate();
  }

  /**
   * Half-open calendar range `[start, endExclusive)` containing `at`, in the app
   * zone — the single source of month/quarter/year boundaries for any
   * reporting or analytics feature built on this starter. It lives on
   * TimeService rather than being reimplemented per feature so that no module
   * sprinkles a `startOf('quarter')` of its own and drifts off the canonical
   * zone.
   *
   * HALF-OPEN on purpose. The REJECTED shape was the obvious
   * `{ start: startOf(unit), end: endOf(unit) }` behind a `BETWEEN` / `<=`
   * bound: luxon's `endOf()` returns `…T23:59:59.999`, while a `TIMESTAMPTZ`
   * column this bounds keeps MICROSECONDS, so every instant inside the
   * period's final millisecond (`…23:59:59.999123`) sits above a `<=` bound
   * and is SILENTLY dropped from its own period — no error, just a row
   * missing from one bucket and present in neither. A `< endExclusive` bound
   * cannot lose a row, and consecutive ranges tile the timeline with no gap
   * and no overlap, which is what lets a period-based aggregation partition
   * history by construction.
   *
   * `at` is re-zoned before `startOf` because a period boundary is a WALL-CLOCK
   * fact, not a UTC one: 2026-01-01T00:00 Berlin is 2025-12-31T23:00Z, so a
   * caller handing in a `utc`-zoned `DateTime` (or host-local math) buckets New
   * Year's midnight into the wrong year. DST is left entirely to luxon's zone
   * arithmetic — never a fixed hour count — because the ranges are genuinely
   * uneven: March 2026 spans 743h, October 2026 745h, Q1 2026 2159h.
   */
  calendarRange(
    at: DateTime,
    unit: 'month' | 'quarter' | 'year',
  ): { start: DateTime; endExclusive: DateTime } {
    const start = at.setZone(this.zone).startOf(unit);
    return { start, endExclusive: start.plus({ [unit]: 1 }) };
  }
}

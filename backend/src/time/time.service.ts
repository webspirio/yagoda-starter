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
   * DST-correct "fire `lead` before `startAt`", returning the instant a
   * scheduler would store as the trigger timestamp for a delayed action.
   *
   * `lead` is a Luxon duration, applied with the semantics that fit its unit —
   * which is exactly what you want on either side of a DST change:
   *   - calendar units ({days}, {weeks}, {months}) are wall-clock-preserving, so
   *     "1 day before" a 10:00 instant stays at 10:00 local and spans 23h/25h
   *     of real time across a boundary rather than a naive fixed 24h;
   *   - exact units ({hours}, {minutes}) are fixed elapsed time, so "2h before"
   *     is always 2 real hours — its local wall-clock shifts by an hour when a
   *     transition falls between (a 2h lead before 04:00 CEST lands at 01:00 CET).
   * Choose the unit that matches the intent (a "day before" vs. a "2 hours before"
   * trigger).
   */
  reminderInstant(startAt: Date, lead: DurationLike): Date {
    return this.fromJSDate(startAt).minus(lead).toJSDate();
  }

  /** DST-correct wall-clock addition of a duration in the app zone. */
  addInZone(instant: Date, duration: DurationLike): Date {
    return this.fromJSDate(instant).plus(duration).toJSDate();
  }
}

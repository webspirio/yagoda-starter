/**
 * Business dates are `YYYY-MM-DD` strings on the wire (a shift's
 * `business_date`). These helpers keep them strings: arithmetic goes through
 * UTC-noon Date objects so a DST switch can never shift the calendar day.
 */
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export const isIsoDate = (v: unknown): v is string => typeof v === 'string' && ISO.test(v);

/**
 * A `YYYY-MM-DD` that is a REAL calendar day, not merely shaped like one.
 *
 * `isIsoDate` checks the shape only, and the two ways a shaped-but-impossible
 * date fails are both silent from there:
 *   - `2026-02-31` parses and ROLLS OVER to 3 March, so a page titling itself
 *     from the value would show one date while asking the API for another;
 *   - `2026-00-10` / `0000-00-00` parse to an Invalid Date, and the first
 *     `Intl` call on it throws a RangeError — one hand-edited query param
 *     blanking a screen.
 *
 * Only a date that survives a round trip through `addDaysIso` is real. The
 * try/catch is not defensive padding: `addDaysIso` calls `toISOString()`,
 * which is exactly what throws on the Invalid Date case above.
 */
export function isRealIsoDate(value: unknown): value is string {
  if (!isIsoDate(value)) return false;
  try {
    return addDaysIso(value, 0) === value;
  } catch {
    return false;
  }
}

const toUtcNoon = (iso: string): Date => new Date(`${iso}T12:00:00Z`);
const fromDate = (d: Date): string => d.toISOString().slice(0, 10);

/** The browser's local calendar date — the operator's «today». */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * The LOCAL `YYYY-MM-DD` of a full timestamp (a document's `sent_at`) — built
 * the exact same way `todayIso()` builds today's date, from local `Date`
 * getters, zero-padded. Exists because `formatShortDate` is UTC-only by
 * design (a business date is a calendar day, deliberately immune to DST —
 * see the file doc comment), but `sent_at` is a real instant and a business
 * day HERE is the viewer's own local day: a transfer sent at 22:00 UTC is
 * already tomorrow in Kyiv (UTC+2/+3). Slicing `sent_at` to its first ten
 * characters and handing that to `formatShortDate` reads the UTC day
 * instead, which can print a date one day behind the LOCAL time shown next
 * to it. Use this first, then `formatShortDate(toLocalIsoDate(iso), locale)`.
 */
export function toLocalIsoDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDaysIso(iso: string, days: number): string {
  const d = toUtcNoon(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return fromDate(d);
}

export const formatLongDate = (iso: string, locale = 'uk'): string =>
  new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
    .format(toUtcNoon(iso))
    .replace(/\s*р\.$/, ''); // uk adds «р.» — the mock prints «8 вересня 2026»

export const formatWeekday = (iso: string, locale = 'uk'): string =>
  new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(toUtcNoon(iso));

export const formatShortDate = (iso: string, locale = 'uk'): string =>
  new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(
    toUtcNoon(iso),
  );

const TIME_PARTS: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
const DAY_MONTH_PARTS: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit' };

/**
 * `iso` here is a full timestamp (a document's `sent_at`), not a business
 * date — unlike every helper above, this deliberately reads the LOCAL time
 * zone (no `timeZone: 'UTC'`): a person needs to know what the clock on the
 * wall said, not what UTC said.
 */
export const formatTime = (iso: string, locale: string): string =>
  new Date(iso).toLocaleTimeString(locale, TIME_PARTS);

/**
 * What `TransferHistory` rendered for `sent_at` by hand before this existed:
 * short day.month, then ` · `, then the time. One `Date` parse per call —
 * not one for the date half and another for the time half.
 */
export const formatDateTime = (iso: string, locale: string): string => {
  const d = new Date(iso);
  return `${d.toLocaleDateString(locale, DAY_MONTH_PARTS)} · ${d.toLocaleTimeString(locale, TIME_PARTS)}`;
};

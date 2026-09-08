/**
 * Business dates are `YYYY-MM-DD` strings on the wire (a shift's
 * `business_date`). These helpers keep them strings: arithmetic goes through
 * UTC-noon Date objects so a DST switch can never shift the calendar day.
 */
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export const isIsoDate = (v: unknown): v is string => typeof v === 'string' && ISO.test(v);

const toUtcNoon = (iso: string): Date => new Date(`${iso}T12:00:00Z`);
const fromDate = (d: Date): string => d.toISOString().slice(0, 10);

/** The browser's local calendar date — the operator's «today». */
export function todayIso(): string {
  const d = new Date();
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

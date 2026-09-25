import { addDaysIso, isRealIsoDate, toLocalIsoDate } from '@/shared/lib/date';

/**
 * #151's follow-up — the period the «Зміни» feed reads. Mirrors the backend's
 * `PriceChangesQueryDto`: both bounds are inclusive dates, a `null` bound is
 * «let the server pick» (`from` null → `to`'s day, `to` null → today), and the
 * span is capped at the same 31 days `GradePricesService` enforces.
 *
 * Pure functions, so the component only wires them to the URL.
 *
 * `today` is the BROWSER's date, while the server filters by `APP_TIMEZONE`.
 * Both are Kyiv in practice; a viewer in another zone near midnight could see
 * «Вчора» ask for a neighbouring day. «Сьогодні» sends no bounds at all, so the
 * default view is always the server's own today.
 */
export const MAX_CHANGES_DAYS = 31;

/** The earliest date the inputs accept. Anything before it is a year still
 *  being typed (`0002-…`, `0202-…`), never a period anyone means. */
export const MIN_CHANGES_DATE = '2020-01-01';

export interface ChangesPeriod {
  from: string | null;
  to: string | null;
}

export type ChangesPreset = 'today' | 'yesterday' | 'week';

const TODAY_PERIOD: ChangesPeriod = { from: null, to: null };

const fitsCap = (from: string, to: string) =>
  from <= to && addDaysIso(from, MAX_CHANGES_DAYS - 1) >= to;

/**
 * The URL is hand-editable and shareable, so a period the backend would answer
 * with a 400 stops here and becomes today — a list, never an error page.
 * `YYYY-MM-DD` strings order correctly as text.
 */
export function readPeriod(from: string | null, to: string | null, today: string): ChangesPeriod {
  if ((from !== null && !isRealIsoDate(from)) || (to !== null && !isRealIsoDate(to))) {
    return TODAY_PERIOD;
  }
  // `from` alone runs to TODAY on the server, so a «7 днів» link opened a month
  // later is too long, and a future `from` is reversed — both checked here.
  if (from !== null && !fitsCap(from, to ?? today)) return TODAY_PERIOD;
  return { from, to };
}

/** Whether a period covers one day — from the period itself, so the title does
 *  not flip while the next period is still loading. */
export function isOneDay(period: ChangesPeriod, today: string): boolean {
  const to = period.to ?? today;
  return (period.from ?? to) === to;
}

/** A value from a date input worth committing: on the calendar and within
 *  `[MIN_CHANGES_DATE, today]`. */
export function isPickableDate(value: string, today: string): boolean {
  return isRealIsoDate(value) && value >= MIN_CHANGES_DATE && value <= today;
}

/** «Сьогодні» is NO period, so the server's today still decides the day. */
export function periodOfPreset(preset: ChangesPreset, today: string): ChangesPeriod {
  switch (preset) {
    case 'today':
      return TODAY_PERIOD;
    case 'yesterday': {
      const yesterday = addDaysIso(today, -1);
      return { from: yesterday, to: yesterday };
    }
    case 'week':
      return { from: addDaysIso(today, -6), to: null };
  }
}

export function presetOf(period: ChangesPeriod, today: string): ChangesPreset | null {
  const to = period.to ?? today;
  const from = period.from ?? to;
  const presets: ChangesPreset[] = ['today', 'yesterday', 'week'];
  return (
    presets.find((preset) => {
      const p = periodOfPreset(preset, today);
      const pTo = p.to ?? today;
      return (p.from ?? pTo) === from && pTo === to;
    }) ?? null
  );
}

/** A new `from`; `to` follows it when it would otherwise be reversed or too long. */
export function withFrom(period: ChangesPeriod, from: string, today: string): ChangesPeriod {
  const to = period.to ?? today;
  if (fitsCap(from, to)) return { from, to };
  return { from, to: from > to ? from : addDaysIso(from, MAX_CHANGES_DAYS - 1) };
}

/** A new `to`; `from` follows it when it would otherwise be reversed or too long. */
export function withTo(period: ChangesPeriod, to: string, today: string): ChangesPeriod {
  const from = period.from ?? period.to ?? today;
  if (fitsCap(from, to)) return { from, to };
  return { from: from > to ? to : addDaysIso(to, -(MAX_CHANGES_DAYS - 1)), to };
}

/**
 * Consecutive rows under one heading per LOCAL date — the viewer's calendar,
 * matching the clock each row shows. Rows keep the server's newest-first order.
 */
export function groupByLocalDay<T extends { created_at: string }>(
  rows: T[],
): { date: string; rows: T[] }[] {
  const groups: { date: string; rows: T[] }[] = [];
  for (const row of rows) {
    const date = toLocalIsoDate(row.created_at);
    const last = groups[groups.length - 1];
    if (last && last.date === date) last.rows.push(row);
    else groups.push({ date, rows: [row] });
  }
  return groups;
}

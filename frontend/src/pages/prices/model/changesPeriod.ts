import { addDaysIso, isRealIsoDate, toLocalIsoDate } from '@/shared/lib/date';

/**
 * #151's follow-up — the period the «Зміни» feed reads. Mirrors the backend's
 * `PriceChangesQueryDto`: both bounds are inclusive dates, a `null` bound is
 * «let the server pick» (`from` null → `to`'s day, `to` null → today), and the
 * span is capped at the same 31 days `GradePricesService` enforces.
 *
 * Pure functions, so the component only wires them to the URL.
 */
export const MAX_CHANGES_DAYS = 31;

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
export function readPeriod(from: string | null, to: string | null): ChangesPeriod {
  if ((from !== null && !isRealIsoDate(from)) || (to !== null && !isRealIsoDate(to))) {
    return TODAY_PERIOD;
  }
  if (from !== null && to !== null && !fitsCap(from, to)) return TODAY_PERIOD;
  return { from, to };
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

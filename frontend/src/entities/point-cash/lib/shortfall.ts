import { cmp, formatUah } from '@/shared/lib/money';

/** `null` carries no tone at all — colour-coding «—» would claim a value that doesn't exist. */
export type ShortfallTone = 'amber' | 'leaf' | null;

/**
 * §7.10's amber/leaf convention, shared between `PointDebtTable`
 * (`pages/transfers`) and `PointCashPage`'s shortfall tile
 * (`pages/point-cash`): an amount still owed (> 0) reads amber, a settled or
 * overfunded point (<= 0) reads leaf. `shortfall === null` means «no target
 * assigned» (§6.9) — never a defaulted zero — so it gets no tone at all.
 */
export function shortfallTone(shortfall: string | null): ShortfallTone {
  if (shortfall == null) return null;
  return cmp(shortfall, '0') === 1 ? 'amber' : 'leaf';
}

/** `target_cash`/`shortfall` are `null` = «not assigned», never `0.00` (§6.9, §7.10). */
export function formatNullableUah(value: string | null, locale: string): string {
  return value == null ? '—' : formatUah(value, locale);
}

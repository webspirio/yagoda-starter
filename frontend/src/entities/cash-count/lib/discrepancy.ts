import type { TFunction } from 'i18next';
import { cmp, formatUah, sub } from '@/shared/lib/money';

type DiscrepancyKind = 'matched' | 'shortage' | 'surplus';

export interface Discrepancy {
  kind: DiscrepancyKind;
  /** The magnitude, never signed — the WORD carries the direction. */
  amount: string;
  /** Shortage reads bad, surplus amber, a match leaf (audit 2026-10-24, rule 5). */
  tone: 'bad' | 'amber' | 'leaf';
}

/**
 * THE one reading of a count difference — a drawer count's `discrepancy`, a
 * closed day's `difference`, a disputed transfer's arrived-minus-sent — so
 * every place a count is compared names it the same way: «Недостача 90,00 ₴»,
 * «Надлишок 50,00 ₴» or «Зійшлося», never a bare signed figure under a
 * «Розбіжність» label that agrees with neither sign.
 *
 * `difference` is ALWAYS «what is there − what should be there» (counted −
 * expected): negative is a shortage. A caller whose figure runs the other way
 * (`Transfer.cash_discrepancy` is sent − arrived) negates it first.
 *
 * A DISPLAY reading only: a discrepancy never blocks anything (§7.7).
 */
export function describeDiscrepancy(difference: string): Discrepancy {
  const c = cmp(difference, '0');
  if (c === 0) return { kind: 'matched', amount: '0.00', tone: 'leaf' };
  if (c < 0) return { kind: 'shortage', amount: sub('0', difference), tone: 'bad' };
  return { kind: 'surplus', amount: difference, tone: 'amber' };
}

/**
 * «Недостача 90,00 ₴» / «Надлишок 50,00 ₴» / «Зійшлося» as plain text — for a
 * sentence (a result title). A plain function, not a hook, so a caller can
 * reach for it only once it actually has a figure to name.
 */
export function formatDiscrepancy(t: TFunction, difference: string, locale: string): string {
  const d = describeDiscrepancy(difference);
  return d.kind === 'matched'
    ? t('discrepancy.matched')
    : t(`discrepancy.${d.kind}`, { amount: formatUah(d.amount, locale) });
}

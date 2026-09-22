import { cmp, formatDecimal } from '@/shared/lib/money';

/**
 * The bonus half of a preview line: a leading `+` unless the bonus is already
 * negative, in which case `formatDecimal`'s own typographic minus (U+2212) is
 * the only sign — a literal `+` glued in front of it would render as `+−5,00`.
 * Kept as `+`-for-non-negative rather than mirroring `widgets/receipt`'s
 * `formatBonus` exactly (`+` only when strictly positive): that dialog OMITS a
 * zero bonus row outright, which reads fine there, but `LineEditor` concatenates
 * price and bonus with no separator of its own — dropping the `+` for zero would
 * glue them into one unreadable number, and `LinesTable`'s price cell reuses the
 * same rule so the committed table and the draft line agree on how a bonus reads.
 */
export function formatBonusSign(bonus: string, locale: string): string {
  const formatted = formatDecimal(bonus, locale);
  return cmp(bonus, '0') === -1 ? formatted : `+${formatted}`;
}

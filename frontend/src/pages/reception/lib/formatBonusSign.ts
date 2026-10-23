import { cmp, formatDecimal } from '@/shared/lib/money';

/**
 * A bonus with its sign: a leading `+` unless the bonus is already negative,
 * in which case `formatDecimal`'s own typographic minus (U+2212) is the only
 * sign — a literal `+` glued in front of it would render as `+−5,00`. Used by
 * `LinesTable`'s price cell and by `LineEditor`'s «+3,00 до ціни сорту» hint.
 * Kept as `+`-for-non-negative rather than mirroring `widgets/receipt`'s
 * `formatBonus` exactly (`+` only when strictly positive): that dialog OMITS a
 * zero bonus row outright, while the table prints the sign beside the price.
 */
export function formatBonusSign(bonus: string, locale: string): string {
  const formatted = formatDecimal(bonus, locale);
  return cmp(bonus, '0') === -1 ? formatted : `+${formatted}`;
}

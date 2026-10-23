import { cmp, formatDecimal } from '@/shared/lib/money';

/**
 * A bonus with its sign: a leading `+` unless the bonus is already negative,
 * in which case `formatDecimal`'s own typographic minus (U+2212) is the only
 * sign — a literal `+` glued in front of it would render as `+−5,00`. Used by
 * `LineEditor`'s «+3,00 до ціни сорту» hint.
 */
export function formatBonusSign(bonus: string, locale: string): string {
  const formatted = formatDecimal(bonus, locale);
  return cmp(bonus, '0') === -1 ? formatted : `+${formatted}`;
}

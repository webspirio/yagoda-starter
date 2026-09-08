/**
 * Formatting only — a decimal string becomes a localized string. Grouping and
 * the decimal separator come from `Intl.NumberFormat` applied to the INTEGER
 * and FRACTION parts separately, so no value is ever parsed into a float.
 * The minus is the typographic U+2212, as the mock's `uah()` prints it.
 */
const DECIMAL = /^(-)?(\d+)(?:\.(\d{1,2}))?$/;

export function formatDecimal(value: string, locale = 'uk'): string {
  const m = DECIMAL.exec(value);
  if (!m) throw new Error(`Not a decimal string: "${value}"`);
  const [, sign, whole, frac = ''] = m;
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
  let group = parts.find((p) => p.type === 'group')?.value ?? ' ';
  const decimal = parts.find((p) => p.type === 'decimal')?.value ?? '.';
  // Normalize U+00A0 (non-breaking space) to U+202F (narrow no-break space)
  if (group.charCodeAt(0) === 0xa0) {
    group = ' ';
  }
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  return `${sign ? '−' : ''}${grouped}${decimal}${frac.padEnd(2, '0')}`;
}

export const formatUah = (value: string, locale = 'uk'): string =>
  `${formatDecimal(value, locale)} ₴`;

export const formatKg = (value: string, locale = 'uk'): string =>
  `${formatDecimal(value, locale)} ${locale.startsWith('uk') ? 'кг' : 'kg'}`;

/**
 * Formatting only — a decimal string becomes a localized string. Grouping and
 * the decimal separator come from `Intl.NumberFormat` applied to the INTEGER
 * and FRACTION parts separately, so no value is ever parsed into a float.
 * The minus is the typographic U+2212, as the mock's `uah()` prints it.
 */
const DECIMAL = /^(-)?(\d+)(?:\.(\d{1,2}))?$/;

/**
 * `formatDecimal` runs on every money value rendered — a busy table can
 * call it hundreds of times per render. The group/decimal separators
 * depend only on `locale`, never on `value`, so they are looked up once
 * per locale and cached here instead of re-running
 * `Intl.NumberFormat(...).formatToParts()` on every call.
 */
const separatorCache = new Map<string, { group: string; decimal: string }>();

function separatorsFor(locale: string): { group: string; decimal: string } {
  const cached = separatorCache.get(locale);
  if (cached) return cached;
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
  let group = parts.find((p) => p.type === 'group')?.value ?? ' ';
  const decimal = parts.find((p) => p.type === 'decimal')?.value ?? '.';
  // Normalize U+00A0 (non-breaking space) to U+202F (narrow no-break space)
  if (group.charCodeAt(0) === 0xa0) {
    group = ' ';
  }
  const separators = { group, decimal };
  separatorCache.set(locale, separators);
  return separators;
}

export function formatDecimal(value: string, locale = 'uk'): string {
  const m = DECIMAL.exec(value);
  if (!m) throw new Error(`Not a decimal string: "${value}"`);
  const [, sign, whole, frac = ''] = m;
  const { group, decimal } = separatorsFor(locale);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  return `${sign ? '−' : ''}${grouped}${decimal}${frac.padEnd(2, '0')}`;
}

export const formatUah = (value: string, locale = 'uk'): string =>
  `${formatDecimal(value, locale)} ₴`;

export const formatKg = (value: string, locale = 'uk'): string =>
  `${formatDecimal(value, locale)} ${locale.startsWith('uk') ? 'кг' : 'kg'}`;

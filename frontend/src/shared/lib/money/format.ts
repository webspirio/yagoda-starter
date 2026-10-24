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

/**
 * A canonical decimal string as a prefilled `DecimalInput` should SHOW it:
 * '1234.50' → '1234,50' in uk, unchanged in en. Only the separator changes —
 * no thousands grouping, no typographic minus, no padding — so the field's
 * mask accepts it as given. Anything that is not a canonical decimal ('' for
 * «no value», a malformed string) comes back untouched.
 *
 * A form default or `setValue` is stored as given (`decimalRules`' `setValueAs`
 * runs only on an edit), so a form prefilled with this must read the value
 * back through `parseDecimal` before it compares or sends it.
 */
export function toDecimalField(value: string, locale = 'uk'): string {
  const m = DECIMAL.exec(value);
  if (!m) return value;
  const [, sign = '', whole, frac] = m;
  return frac === undefined
    ? `${sign}${whole}`
    : `${sign}${whole}${separatorsFor(locale).decimal}${frac}`;
}

export const formatUah = (value: string, locale = 'uk'): string =>
  `${formatDecimal(value, locale)} ₴`;

/** Same caching reason as `separatorCache`: the unit depends only on `locale`. */
const kgUnitCache = new Map<string, string>();

function kgUnitFor(locale: string): string {
  let unit = kgUnitCache.get(locale);
  if (unit === undefined) {
    unit =
      new Intl.NumberFormat(locale, { style: 'unit', unit: 'kilogram' })
        .formatToParts(1)
        .find((p) => p.type === 'unit')?.value ?? 'kg';
    kgUnitCache.set(locale, unit);
  }
  return unit;
}

export const formatKg = (value: string, locale = 'uk'): string =>
  `${formatDecimal(value, locale)} ${kgUnitFor(locale)}`;

/** A price per kilogram — «189,42 ₴/кг», «189.42 ₴/kg»: the unit of every
 *  price operand in a written-out formula. */
export const formatUahPerKg = (value: string, locale = 'uk'): string =>
  `${formatDecimal(value, locale)} ₴/${kgUnitFor(locale)}`;

/**
 * One operand of a written-out formula, held on one line: each plain space
 * becomes a no-break space, so «113 044,20 ₴ ÷ 596,80 кг = 189,42 ₴/кг» may
 * wrap between terms but never strands «₴/кг» at the start of the next line.
 * (The thousands group is already U+202F, which never breaks.)
 */
export const unbreakable = (term: string): string => term.replace(/ /g, ' ');

/**
 * A whole count — crates, receipts, positions — grouped like money («1 250», «−14»),
 * never with decimals. `n` is a count, so anything fractional is a caller bug.
 */
export function formatCount(n: number, locale = 'uk'): string {
  if (!Number.isInteger(n)) throw new Error(`Not a whole count: ${n}`);
  const { group } = separatorsFor(locale);
  const digits = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, group);
  return `${n < 0 ? '−' : ''}${digits}`;
}

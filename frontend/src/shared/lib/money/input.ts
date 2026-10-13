import { add, cmp } from './decimal';

/** Ціле число ящиків, 0 або більше — дзеркалить `@IsInt() @Min(0)` DTO. */
export const CRATES_INPUT = /^\d{1,7}$/;

/**
 * A crate count typed into a field that may stay empty (reception's tare row):
 * `''` is 0, «not counted yet»; a whole number is itself; anything else —
 * «0,5», «2,0», «1.2.3» — is `null`, refused, never read as some other count.
 */
export function parseCrateCount(raw: string): number | null {
  const value = raw.trim();
  if (value === '') return 0;
  return CRATES_INPUT.test(value) ? Number(value) : null;
}

/**
 * Граматика грошового чи вагового поля: необовʼязковий мінус (лише там, де поле
 * його дозволяє), до 8 цифр цілої частини, кома або крапка і не більше двох
 * знаків після неї. Кому `parseDecimal` міняє на крапку ще до відправки — DTO
 * бачать лише крапку. Мінус доходить до бекенду лише в `bonus` (надбавка
 * приймальника), і там він навмисний: його DTO — `/^-?\d{1,8}(\.\d{1,2})?$/`.
 * Ціни дня, `bonus` і ваги — `\d{1,8}` і в своїх DTO, тут те саме. Грошові
 * колонки каси й застава тари (`deposit_price`) — `\d{1,10}` на бекенді, тут
 * вужче на два розряди: 99 999 999,99 ₴ не буває ні за зміну, ні за ящик, а
 * зайвий нуль у полі це найчастіше промах по клавіші.
 */
const DECIMAL_SHAPE = /^(-?)(\d{1,8})(?:[.,](\d{1,2}))?$/;

/**
 * THE grammar of a money or weight field (#72): whitespace of any kind removed
 * (the field's mask never lets it in; this is the backstop for a default value
 * or a paste that bypassed the mask), then up to 8 integer digits, comma or dot,
 * up to 2 decimals. Returns the canonical dot form, or `null` when refused.
 */
export function parseDecimal(
  raw: string,
  { allowNegative = false }: { allowNegative?: boolean } = {},
): string | null {
  const match = DECIMAL_SHAPE.exec(raw.replace(/\s/g, ''));
  if (!match || (match[1] === '-' && !allowNegative)) return null;
  const [, sign, int, frac] = match;
  return `${sign}${int}${frac === undefined ? '' : `.${frac}`}`;
}

/**
 * What a decimal field lets through WHILE TYPING (#72): digits and separators
 * (a comma is stored as a dot), plus a leading minus when `allowNegative`.
 * Everything else — whitespace of any kind, letters — never gets in.
 *
 * It removes only characters that cannot be part of a number; it never drops
 * a digit or a separator. Truncating `12,000.00` to `12.00`, `1,234` to `1.23`
 * or a 9th digit away would be the same silent hundred- or thousand-fold
 * change #72 exists to remove — so what does not fit the grammar stays
 * visible in the field and `parseDecimal` refuses it with the shared message.
 */
export function maskDecimalInput(
  raw: string,
  { allowNegative = false }: { allowNegative?: boolean } = {},
): string {
  const negative = allowNegative && raw.trimStart().startsWith('-');
  let body = '';
  for (const ch of raw) {
    if (ch >= '0' && ch <= '9') body += ch;
    else if (ch === '.' || ch === ',') body += '.';
  }
  return `${negative ? '-' : ''}${body}`;
}

/** `value` clamped into [min, max]; a malformed value is returned unchanged. */
export function clampDecimal(value: string, min: string, max: string): string {
  const normalized = parseDecimal(value, { allowNegative: true });
  if (normalized === null) return value;
  // Re-canonicalise through add(x, '0') so '5' becomes '5.00' like the server would store it.
  const canonical = add(normalized, '0');
  if (cmp(canonical, min) === -1) return add(min, '0');
  if (cmp(canonical, max) === 1) return add(max, '0');
  return canonical;
}

/**
 * '5497.37' → '5400.00'; '87.50' → '0.00'. `value` must be non-negative — its
 * only planned caller is the «До сотні» chip over a non-negative cap, so a
 * negative amount here is a caller bug, refused the way `div` refuses its own
 * invalid input, rather than silently losing the sign.
 *
 * `value` must also be CANONICAL (`add(value, '0') === value`) — a leading
 * zero (`'0100.00'`) or garbage (`'abc'`) used to fall through the string
 * slicing below into a value that merely LOOKED like money (`'100.00'` for
 * the former; letters spliced into the hundreds place for the latter,
 * `add('abc', '0')` itself throws before this check would even run). Every
 * planned caller already hands this a canonical cap (`suggestedPaid`'s
 * output, or `'0'` normalized through `clampDecimal`), so this is a caller
 * bug the same way negative is.
 */
export function floorToHundreds(value: string): string {
  if (value.startsWith('-')) {
    throw new Error('money: floorToHundreds needs a non-negative amount');
  }
  if (add(value, '0') !== value) {
    throw new Error('money: floorToHundreds needs a canonical amount');
  }
  const int = value.split('.')[0];
  const hundreds = int.length > 2 ? `${int.slice(0, -2)}00` : '0';
  return `${hundreds}.00`;
}

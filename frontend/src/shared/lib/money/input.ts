import { add, cmp } from './decimal';

/**
 * Що людина має право надрукувати в грошовому полі: до 8 цифр цілої частини і
 * не більше двох після коми. Дзеркалить `@Matches(/^\d{1,10}(\.\d{1,2})?$/)`
 * бекендових DTO, але вужче на два розряди — 99 999 999,99 ₴ за зміну не буває,
 * а зайвий нуль у полі це найчастіше промах по клавіші.
 */
export const DECIMAL_INPUT = /^\d{1,8}(\.\d{1,2})?$/;

/** Ціле число ящиків, 0 або більше — дзеркалить `@IsInt() @Min(0)` DTO. */
export const CRATES_INPUT = /^\d{1,7}$/;

/**
 * Приводить надруковане до канонічного вигляду ПЕРЕД перевіркою: українська
 * розкладка дає кому, а звичка з паперу — пробіл між тисячами. Ні те, ні те не
 * помилка користувача, тому це нормалізація, а не відмова.
 */
export function normalizeAmount(value: string): string {
  return value.replace(/\s/g, '').replace(',', '.');
}

/**
 * Keeps what a decimal field may hold WHILE TYPING: digits, one separator
 * (comma or dot, stored as dot), at most `decimals` places, an optional
 * leading minus when `allowNegative`. Never adds digits.
 */
export function maskDecimalInput(
  raw: string,
  { decimals = 2, allowNegative = false }: { decimals?: number; allowNegative?: boolean } = {},
): string {
  const negative = allowNegative && raw.trimStart().startsWith('-');
  let seen = false;
  let body = '';
  for (const ch of raw) {
    if (ch >= '0' && ch <= '9') body += ch;
    else if ((ch === '.' || ch === ',') && !seen) {
      seen = true;
      body += '.';
    }
  }
  const [int, frac = ''] = body.split('.');
  const fraction = seen ? `.${frac.slice(0, decimals)}` : '';
  return `${negative ? '-' : ''}${int}${fraction}`;
}

/** `value` clamped into [min, max]; a malformed value is returned unchanged. */
export function clampDecimal(value: string, min: string, max: string): string {
  const normalized = normalizeAmount(value);
  if (!/^-?\d{1,10}(\.\d{1,2})?$/.test(normalized)) return value;
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
 */
export function floorToHundreds(value: string): string {
  const normalized = normalizeAmount(value);
  if (normalized.startsWith('-')) {
    throw new Error('money: floorToHundreds needs a non-negative amount');
  }
  const int = normalized.split('.')[0];
  const hundreds = int.length > 2 ? `${int.slice(0, -2)}00` : '0';
  return `${hundreds}.00`;
}

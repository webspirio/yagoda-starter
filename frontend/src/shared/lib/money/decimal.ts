/**
 * Decimal-string arithmetic in integer kopiykas — the client-side twin of the
 * backend's `common/money.ts`, with the same contract: strings in, scale-2
 * strings out, nothing ever passes through a binary float. Used for DISPLAY
 * totals only (a day's «нараховано», «N позицій · кг»); every value sent to
 * the server is what the operator typed or what the server previewed.
 */
const DECIMAL = /^(-)?(\d+)(?:\.(\d{1,2}))?$/;

function toKopiykas(value: string): bigint {
  const m = DECIMAL.exec(value);
  if (!m) throw new Error(`Not a decimal string: "${value}"`);
  const [, sign, whole, frac = ''] = m;
  const k = BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0'));
  return sign ? -k : k;
}

function fromKopiykas(k: bigint): string {
  const sign = k < 0n ? '-' : '';
  const abs = k < 0n ? -k : k;
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

export const add = (a: string, b: string): string => fromKopiykas(toKopiykas(a) + toKopiykas(b));
export const sub = (a: string, b: string): string => fromKopiykas(toKopiykas(a) - toKopiykas(b));
export const sum = (values: readonly string[]): string =>
  fromKopiykas(values.reduce((acc, v) => acc + toKopiykas(v), 0n));
export function cmp(a: string, b: string): -1 | 0 | 1 {
  const x = toKopiykas(a);
  const y = toKopiykas(b);
  return x < y ? -1 : x > y ? 1 : 0;
}
/**
 * Splits a decimal string over a whole count — «скільки в одному ящику»: the
 * reception screen's per-crate sanity check divides a previewed net weight by
 * the number of tare units. `by` is a COUNT, not money, so it is a `number`;
 * anything but a positive integer is a caller bug, not a value to round.
 *
 * Half-up at 2 decimals BY MAGNITUDE (−0.005 → −0.01, like +0.005 → +0.01),
 * the same rounding the backend's `money.mul` applies. The quotient is taken
 * in kopiykas with `BigInt` — `floor(abs/d + 1/2)` written as
 * `(2·abs + d) / (2·d)` so the halfway test itself never leaves integer
 * arithmetic and no value passes through a binary float.
 */
export function div(a: string, by: number): string {
  if (!Number.isInteger(by) || by <= 0) {
    throw new Error(`Not a positive whole divisor: ${by}`);
  }
  const k = toKopiykas(a);
  const d = BigInt(by);
  const negative = k < 0n;
  const abs = negative ? -k : k;
  const q = (abs * 2n + d) / (d * 2n);
  return fromKopiykas(negative ? -q : q);
}

export const isNegative = (v: string): boolean => toKopiykas(v) < 0n;
export const isZero = (v: string): boolean => toKopiykas(v) === 0n;

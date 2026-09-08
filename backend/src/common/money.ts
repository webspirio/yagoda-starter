/**
 * THE ONLY PLACE IN THE BACKEND WHERE A DECIMAL STRING IS TAKEN APART.
 *
 * Foundation §5.1: `numeric` values are strings end to end and no arithmetic
 * operator is ever applied to one. This module is the seam that makes that
 * rule keepable — everything else calls these functions and never touches a
 * digit.
 *
 * INTERNALS ARE bigint KOPIYKAS (scale 2), and that is deliberately NOT the
 * storage model: foundation §5.1 rejected integer kopiykas as a schema choice
 * because they contradict the DBML's `numeric(12,2)` and invalidate the SQL
 * formulas in the `suppliers` and `cash_counts` Notes. Here they are a private
 * implementation detail behind a string boundary, which is a different claim.
 *
 * `Number`, `parseFloat` and `toFixed` appear NOWHERE below, on purpose. A
 * double cannot round-trip every value `numeric(12,2)` can hold, and the
 * failure is silent — exactly the class of bug §5.1 exists to forbid.
 *
 * WHY NOT `decimal.js`: deferred by the owner's decision of 2026-09-08 on the
 * grounds that this slice's business logic is provisional. When it stops being
 * provisional, the replacement is the internals of THIS FILE and nothing else.
 * That is the whole reason the seam exists — see spec §6.8.
 *
 * NOT THE ONLY ROUNDING IN THE DOMAIN. §12.1 defines a SECOND one for the
 * suggested payout — to whole hryvnia, with exactly 0.50 going DOWN — which is
 * neither implemented here nor a replacement for `mul`'s half-up at scale 2.
 * It is unresolved at the source («→ Правка: точно???») and arrives with the
 * slice that suggests a payout.
 */

const SCALE = 2;
const UNIT = 100n;
const DECIMAL = /^-?\d+(?:\.\d{1,2})?$/;

/** `'-12.3'` → `-1230n`. Throws on anything that is not a scale-≤2 decimal. */
function parse(value: string): bigint {
  if (typeof value !== 'string' || !DECIMAL.test(value)) {
    throw new Error(`money: ${JSON.stringify(value)} is not a decimal with at most 2 places`);
  }
  const negative = value.startsWith('-');
  const magnitude = negative ? value.slice(1) : value;
  const [whole, fraction = ''] = magnitude.split('.');
  const units = BigInt(whole) * UNIT + BigInt(fraction.padEnd(SCALE, '0'));
  return negative ? -units : units;
}

/** `-1230n` → `'-12.30'`. Always exactly two decimal places. */
function format(units: bigint): string {
  const negative = units < 0n;
  const magnitude = negative ? -units : units;
  const whole = magnitude / UNIT;
  const fraction = (magnitude % UNIT).toString().padStart(SCALE, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

export function add(a: string, b: string): string {
  return format(parse(a) + parse(b));
}

export function sub(a: string, b: string): string {
  return format(parse(a) - parse(b));
}

/**
 * Multiplies two scale-2 values and rounds the scale-4 product back to scale 2,
 * HALF-UP AWAY FROM ZERO.
 *
 * Half-up is foundation §5.1's stated policy, «applied where paper shows a
 * number» — and this is that place: `amount = net × (price + bonus)` is printed
 * on the supplier's copy. Away-from-zero (rather than half-up toward positive
 * infinity) keeps a negative line the mirror image of its positive twin, which
 * matters because `bonus` is legitimately negative for «м'ята чи цвіла ягода».
 */
export function mul(a: string, b: string): string {
  const raw = parse(a) * parse(b); // scale 4
  const negative = raw < 0n;
  const magnitude = negative ? -raw : raw;
  const rounded = (magnitude + UNIT / 2n) / UNIT; // +50, floor -> half-up
  return format(negative ? -rounded : rounded);
}

/** Exact addition of already-rounded values. NEVER rounds — see money.spec.ts's
 *  «Σ round(each) differs from round(Σ)». */
export function sum(values: string[]): string {
  return format(values.reduce((acc, v) => acc + parse(v), 0n));
}

export function cmp(a: string, b: string): -1 | 0 | 1 {
  const ua = parse(a);
  const ub = parse(b);
  return ua < ub ? -1 : ua > ub ? 1 : 0;
}

export const gt = (a: string, b: string): boolean => cmp(a, b) === 1;
export const gte = (a: string, b: string): boolean => cmp(a, b) >= 0;
export const lt = (a: string, b: string): boolean => cmp(a, b) === -1;
export const lte = (a: string, b: string): boolean => cmp(a, b) <= 0;
export const isNegative = (value: string): boolean => parse(value) < 0n;
export const isZero = (value: string): boolean => parse(value) === 0n;

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

/**
 * Scale-2 quotient, HALF-UP AWAY FROM ZERO — the same policy `mul` uses, for
 * the same reason (foundation §5.1, «applied where paper shows a number»).
 *
 * THROWS ON ZERO rather than returning '0.00'. §8.6 is explicit that a day
 * with no weight is «—» and «Це не нуль», and a function that quietly answers
 * zero is how that distinction gets lost three call sites later. Every caller
 * checks the empty case first and renders the dash itself.
 *
 * §8.5's paper arithmetic prints `166,9114` at scale 4. That belongs to the
 * «усе на один товар» strategy this slice does not implement; §8.4's own
 * numbers are scale 2, and so is this.
 */
export function div(a: string, b: string): string {
  const ua = parse(a);
  const ub = parse(b);
  if (ub === 0n) throw new Error('money: divide by zero');

  // Scale the dividend by UNIT once, plus one more digit to round on. Once
  // is enough because both operands carry the same scale-2 factor and it
  // cancels in the ratio: what is left to supply is the ANSWER's own scale,
  // which is one UNIT, and the `10n` is the guard digit `rounded` below
  // consumes to round half-up.
  const negative = ua < 0n !== ub < 0n;
  const magnitude = (ua < 0n ? -ua : ua) * UNIT * 10n;
  const divisor = ub < 0n ? -ub : ub;
  const scaled = magnitude / divisor; // scale 3
  const rounded = (scaled + 5n) / 10n; // +0.0005, floor -> half-up
  return format(negative ? -rounded : rounded);
}

/**
 * Split `total` across `weights` pro-rata, LARGEST REMAINDER.
 *
 * The parts sum exactly to the total — that is the whole point, and it is what
 * §8.4's звірка checks on screen: «жодна гривня не загубилася і не з'явилася з
 * нічого». Multiplying each weight by a rounded ratio drifts by a kopiyka per
 * line, which is invisible on a fixture and wrong on a real day.
 *
 * All-zero weights split EVENLY rather than throwing: a доплата against a
 * receipt whose lines are all free (bonus −price) is degenerate but real, and
 * refusing to allocate it would lose the money entirely.
 */
export function allocate(total: string, weights: string[]): string[] {
  if (weights.length === 0) return [];

  const target = parse(total);
  const negative = target < 0n;
  const magnitude = negative ? -target : target;

  const parsed = weights.map((w) => {
    const u = parse(w);
    return u < 0n ? -u : u;
  });
  const totalWeight = parsed.reduce((acc, w) => acc + w, 0n);

  // Even split when there is nothing to be proportional to.
  const basis = totalWeight === 0n ? parsed.map(() => 1n) : parsed;
  const basisTotal = basis.reduce((acc, w) => acc + w, 0n);

  const floors = basis.map((w) => (magnitude * w) / basisTotal);
  const remainders = basis.map((w) => (magnitude * w) % basisTotal);

  let left = magnitude - floors.reduce((acc, f) => acc + f, 0n);
  const order = remainders
    .map((r, i) => ({ r, i }))
    .sort((x, y) => (y.r === x.r ? x.i - y.i : y.r > x.r ? 1 : -1));

  const result = [...floors];
  for (const { i } of order) {
    if (left <= 0n) break;
    result[i] += 1n;
    left -= 1n;
  }

  return result.map((u) => format(negative ? -u : u));
}

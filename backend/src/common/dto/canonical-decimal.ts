import { Transform } from 'class-transformer';

/**
 * `numeric(10,2)`/`numeric(12,2)` columns store `'1.2'` as `1.20`. TypeORM's
 * `save()` returns the in-memory entity rather than re-reading the row, so
 * without this the API echoes back whatever shape the caller sent: `POST`
 * answers `{"weight_kg":"1.2"}` while the very next `GET` answers
 * `{"weight_kg":"1.20"}` for the same row — unequal as strings, which matters
 * because these values are compared as strings, never as numbers (§5.1). Worse,
 * `PATCH {"weight_kg":"1.2"}` against a row already holding `1.20` makes
 * `diffFields` see a change that never happened, writing a phantom
 * `tare-type.updated` audit entry — the only record anywhere that a deposit
 * price changed.
 *
 * The fix is to canonicalise the STRING to the scale Postgres will store it
 * at, before it ever reaches TypeORM, so what's held in memory already matches
 * what a fresh `SELECT` would return.
 *
 * This is pure string surgery — no `Number()`, `parseFloat`, `toFixed`, or
 * arithmetic of any kind. That is the exact hazard §5.1 exists to forbid:
 * JS's `number` type cannot round-trip every value `numeric(12,2)` can hold
 * without silently losing precision at the edges of what a float can
 * represent exactly, and a canonicaliser that "fixed" that by going through
 * `Number` would just be re-introducing the bug it exists to close.
 */
export function canonicalizeDecimalString(value: unknown): unknown {
  if (typeof value !== 'string') return value;

  // Anything that doesn't already look like a plain decimal is left
  // completely alone. This transform runs inside the ValidationPipe's
  // transform phase, which completes in full BEFORE `@Matches` ever runs — so
  // a malformed value must fall through unchanged and let `@Matches` reject
  // it with the usual 400, rather than being force-fit into canonical
  // nonsense in here.
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return value;

  const [, sign, integerPart, fractionPart = ''] = match;

  // Strip leading zeros from the integer part, but never past a single "0"
  // ("007" -> "7", "0" -> "0", "000" -> "0"). The lookahead requires another
  // digit to follow, which is what stops a bare "0" from being eaten away to
  // nothing.
  const normalizedInteger = integerPart.replace(/^0+(?=\d)/, '');

  // Pad the fractional part out to exactly 2 digits with trailing zeros so
  // '1.2' and '1.20' land on the same string ("2" -> "20"); an absent
  // fraction pads from '' straight to "00". Never truncates — `@Matches`
  // already capped the input at 2 decimal digits, so there is never more than
  // 2 to pad.
  const normalizedFraction = fractionPart.padEnd(2, '0');

  // `bonus` (§2.8) is signed — a discount is a negative bonus — so the sign has
  // to survive the round trip. Negative ZERO does not: Postgres `numeric` has
  // no such value, so '-0' would canonicalise to a string no `SELECT` could
  // ever return, which is exactly the POST/GET mismatch this function exists to
  // close.
  const isZero = normalizedInteger === '0' && normalizedFraction === '00';

  return `${isZero ? '' : sign}${normalizedInteger}.${normalizedFraction}`;
}

/** Normalises an already-`@Matches`-shaped decimal string to a fixed scale of
 *  2, matching how Postgres will actually store it. See
 *  `canonicalizeDecimalString` for why this has to be string manipulation and
 *  never arithmetic. */
export const CanonicalDecimal = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }) => canonicalizeDecimalString(value));

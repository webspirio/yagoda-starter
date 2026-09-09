import { plainToInstance } from 'class-transformer';
import { CanonicalDecimal, canonicalizeDecimalString } from './canonical-decimal';

class Dto {
  @CanonicalDecimal()
  weight_kg?: string;
}

describe('canonicalizeDecimalString', () => {
  it.each([
    ['1.2', '1.20'],
    ['120', '120.00'],
    ['007.5', '7.50'],
    ['7.50', '7.50'], // already canonical
    ['0', '0.00'],
    ['0.5', '0.50'],
    ['00', '0.00'],
  ])('normalises %j to %j', (raw, expected) => {
    expect(canonicalizeDecimalString(raw)).toBe(expected);
  });

  /**
   * `bonus` (§2.8) is the one SIGNED decimal in the schema — «мінус» is half of
   * what a bonus is for — and an earlier revision of this function left every
   * signed value untouched, so `POST /intakes` answered `bonus: "-2"` while the
   * very next `GET` answered `"-2.00"` for the same row: verbatim the mismatch
   * the doc comment above says this exists to prevent.
   *
   * `-0` canonicalises to `0.00`, not `-0.00`: Postgres `numeric` has no
   * negative zero, so re-emitting the sign here would produce a string no
   * `SELECT` could ever return.
   */
  it.each([
    ['-1.2', '-1.20'],
    ['-2', '-2.00'],
    ['-007.5', '-7.50'],
    ['-0.50', '-0.50'],
    ['-0', '0.00'],
    ['-0.00', '0.00'],
  ])('normalises the signed %j to %j', (raw, expected) => {
    expect(canonicalizeDecimalString(raw)).toBe(expected);
  });

  // Not a string at all — passed through untouched rather than coerced.
  it('leaves a non-string value unchanged', () => {
    expect(canonicalizeDecimalString(undefined)).toBeUndefined();
    expect(canonicalizeDecimalString(null)).toBeNull();
  });

  // Malformed shapes fall through unchanged so `@Matches` is the one that
  // rejects them with a 400 — this function never throws.
  it.each(['abc', '1.234', '-1.234', '--1', '+1', ''])(
    'leaves %j unchanged for the validator to reject',
    (raw) => {
      expect(canonicalizeDecimalString(raw)).toBe(raw);
    },
  );
});

describe('@CanonicalDecimal()', () => {
  it('canonicalises a non-canonical decimal string on a class instance', () => {
    const dto = plainToInstance(Dto, { weight_kg: '1.2' });
    expect(dto.weight_kg).toBe('1.20');
  });

  it('leaves an absent field alone', () => {
    const dto = plainToInstance(Dto, {});
    expect(dto.weight_kg).toBeUndefined();
  });
});

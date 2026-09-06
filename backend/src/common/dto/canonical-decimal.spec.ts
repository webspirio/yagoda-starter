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

  // Not a string at all — passed through untouched rather than coerced.
  it('leaves a non-string value unchanged', () => {
    expect(canonicalizeDecimalString(undefined)).toBeUndefined();
    expect(canonicalizeDecimalString(null)).toBeNull();
  });

  // Malformed shapes fall through unchanged so `@Matches` is the one that
  // rejects them with a 400 — this function never throws.
  it.each(['abc', '1.234', '-1.2', ''])('leaves %j unchanged for the validator to reject', (raw) => {
    expect(canonicalizeDecimalString(raw)).toBe(raw);
  });
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

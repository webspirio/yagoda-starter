import { describe, it, expect } from 'vitest';
import {
  CRATES_INPUT,
  normalizeAmount,
  parseDecimal,
  maskDecimalInput,
  clampDecimal,
  floorToHundreds,
} from './input';

describe('normalizeAmount', () => {
  it('accepts a comma as the decimal separator and trims', () => {
    expect(normalizeAmount(' 1 234,50 ')).toBe('1234.50');
  });
  it('strips spaces used as thousands separators', () => {
    expect(normalizeAmount('12 000')).toBe('12000');
  });
  it('leaves an already-canonical string alone', () => {
    expect(normalizeAmount('0.05')).toBe('0.05');
  });
});

describe('parseDecimal', () => {
  it.each([
    ['12000', '12000'],
    ['12 000', '12000'],
    ['1 234 567,50', '1234567.50'],
    ['980,40', '980.40'],
    ['980.40', '980.40'],
    ['980 40', '98040'],
    ['12\u202f000,00', '12000.00'],
    ['12\u00a0000', '12000'],
    [' 7 ', '7'],
    ['99999999.99', '99999999.99'],
  ])('accepts %j as %s', (raw, out) => {
    expect(parseDecimal(raw)).toBe(out);
  });
  it.each(['', '.', '12.', '1.234', 'abc', '123456789', '1,2,3', '-5'])('refuses %j', (raw) => {
    expect(parseDecimal(raw)).toBeNull();
  });
  it('allows a minus only when asked', () => {
    expect(parseDecimal('-5,5', { allowNegative: true })).toBe('-5.5');
  });
});

describe('CRATES_INPUT', () => {
  it.each(['0', '7', '1234567'])('accepts %s', (v) => {
    expect(CRATES_INPUT.test(v)).toBe(true);
  });
  it.each(['', '-1', '1.5', 'abc', '12345678'])('rejects %s', (v) => {
    expect(CRATES_INPUT.test(v)).toBe(false);
  });
});

describe('maskDecimalInput', () => {
  it('drops letters and whitespace of any kind, stores a comma as a dot', () => {
    expect(maskDecimalInput('12a,5')).toBe('12.5');
    expect(maskDecimalInput('12 000')).toBe('12000');
    expect(maskDecimalInput('980 40')).toBe('98040');
    expect(maskDecimalInput('12\u202f000,00')).toBe('12000.00');
  });
  it('never drops a digit or a separator — the grammar refuses what does not fit (#72)', () => {
    expect(maskDecimalInput('12,000.00')).toBe('12.000.00');
    expect(maskDecimalInput('1,234')).toBe('1.234');
    expect(maskDecimalInput('123456789')).toBe('123456789');
    expect(parseDecimal(maskDecimalInput('12,000.00'))).toBeNull();
    expect(parseDecimal(maskDecimalInput('1,234'))).toBeNull();
    expect(parseDecimal(maskDecimalInput('123456789'))).toBeNull();
  });
  it('allows a leading minus only when asked', () => {
    expect(maskDecimalInput('-5')).toBe('5');
    expect(maskDecimalInput('-5', { allowNegative: true })).toBe('-5');
    expect(maskDecimalInput('--5', { allowNegative: true })).toBe('-5');
    expect(maskDecimalInput('5-', { allowNegative: true })).toBe('5');
  });
  it('lets a half-typed value through untouched', () => {
    expect(maskDecimalInput('12.')).toBe('12.');
    expect(maskDecimalInput('')).toBe('');
  });
});

describe('clampDecimal', () => {
  it('clamps into the range and leaves a malformed value alone', () => {
    expect(clampDecimal('31', '-20', '30')).toBe('30.00');
    expect(clampDecimal('-25', '-20', '30')).toBe('-20.00');
    expect(clampDecimal('5', '-20', '30')).toBe('5.00');
    expect(clampDecimal('12.', '-20', '30')).toBe('12.');
  });
});

describe('floorToHundreds', () => {
  it('rounds DOWN to whole hundreds', () => {
    expect(floorToHundreds('5497.37')).toBe('5400.00');
    expect(floorToHundreds('100.00')).toBe('100.00');
    expect(floorToHundreds('87.50')).toBe('0.00');
  });
  it('refuses a negative amount', () => {
    expect(() => floorToHundreds('-1.00')).toThrow(/non-negative/);
  });
  it('refuses a non-canonical leading zero instead of silently re-canonicalising it', () => {
    // Before the guard, this fell through the string slicing to '100.00' —
    // the RIGHT-looking answer for the wrong reason, since nothing here is
    // meant to re-canonicalise a caller's already-formatted cap.
    expect(() => floorToHundreds('0100.00')).toThrow(/canonical/);
  });
  it('refuses garbage instead of splicing letters into a money-shaped string', () => {
    expect(() => floorToHundreds('abc')).toThrow();
  });
});

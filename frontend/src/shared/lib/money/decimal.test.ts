import { describe, it, expect } from 'vitest';
import { add, sub, sum, cmp, div, isNegative, isZero } from './decimal';

describe('decimal-string arithmetic (integer kopiykas, never floats)', () => {
  it('adds and subtracts at scale 2', () => {
    expect(add('140.00', '-5')).toBe('135.00');
    expect(add('0.10', '0.2')).toBe('0.30'); // 0.1 + 0.2 in floats is 0.30000000000000004
    expect(sub('1.05', '1.05')).toBe('0.00');
    expect(sub('1.00', '2.50')).toBe('-1.50');
  });
  it('sums rounded lines so the total equals the printed lines', () => {
    expect(sum(['10944.00', '1827.00', '0.50'])).toBe('12771.50');
    expect(sum([])).toBe('0.00');
  });
  it('compares as numbers, not strings', () => {
    expect(cmp('9.00', '10.00')).toBe(-1);
    expect(cmp('10', '10.00')).toBe(0);
    expect(cmp('-0.01', '0')).toBe(-1);
    expect(isNegative('-0.01')).toBe(true);
    expect(isZero('0.00')).toBe(true);
  });
  it('rejects anything that is not a plain decimal', () => {
    expect(() => add('1e3', '0')).toThrow(/decimal/);
    expect(() => add('1.005', '0')).toThrow(/decimal/);
    expect(() => add('', '0')).toThrow(/decimal/);
  });
});

describe('div — a decimal string split over a whole count (per-crate weights)', () => {
  it('divides exactly when it can', () => {
    expect(div('126.40', 2)).toBe('63.20');
    expect(div('10.00', 1)).toBe('10.00');
    expect(div('0.00', 7)).toBe('0.00');
  });
  it('rounds half-up at 2 decimals, never through a float', () => {
    // 1/8 = 0.125 and 3/8 = 0.375 — both land exactly on the half.
    expect(div('1.00', 8)).toBe('0.13');
    expect(div('3.00', 8)).toBe('0.38');
    // 10/3 = 3.3333… rounds down; 20/3 = 6.6666… rounds up.
    expect(div('10.00', 3)).toBe('3.33');
    expect(div('20.00', 3)).toBe('6.67');
    // The real reason this exists: 126.40 kg over 12 crates = 10.5333…
    expect(div('126.40', 12)).toBe('10.53');
  });
  it('rounds a negative half away from zero, mirroring the positive case', () => {
    expect(div('-1.00', 8)).toBe('-0.13');
    expect(div('-10.00', 3)).toBe('-3.33');
  });
  it('refuses a divisor that is not a whole count above zero', () => {
    expect(() => div('10.00', 0)).toThrow(/divisor/);
    expect(() => div('10.00', -2)).toThrow(/divisor/);
    expect(() => div('10.00', 1.5)).toThrow(/divisor/);
    expect(() => div('10.00', Number.NaN)).toThrow(/divisor/);
  });
  it('still rejects a value that is not a plain decimal', () => {
    expect(() => div('1e3', 2)).toThrow(/decimal/);
  });
});

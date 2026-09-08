import { describe, it, expect } from 'vitest';
import { add, sub, sum, cmp, isNegative, isZero } from './decimal';

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

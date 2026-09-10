import { describe, it, expect } from 'vitest';
import { DECIMAL_INPUT, normalizeAmount } from './input';

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

describe('DECIMAL_INPUT', () => {
  it.each(['0', '0.5', '0.05', '99999999.99'])('accepts %s', (v) => {
    expect(DECIMAL_INPUT.test(v)).toBe(true);
  });
  it.each(['', '-1', '1.234', 'abc', '1.'])('rejects %s', (v) => {
    expect(DECIMAL_INPUT.test(v)).toBe(false);
  });
});

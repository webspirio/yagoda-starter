import { describe, it, expect } from 'vitest';
import { formatWholeHryvnia } from './formatWholeHryvnia';

describe('formatWholeHryvnia', () => {
  it('drops the «,00» of a whole amount, keeping the grouping', () => {
    expect(formatWholeHryvnia('1431.00', 'en')).toBe('1,431');
    expect(formatWholeHryvnia('27170.00', 'uk')).toBe('27\u202f170');
  });

  it('prints an amount with kopiykas in full, never cut', () => {
    expect(formatWholeHryvnia('1430.80', 'uk')).toBe('1\u202f430,80');
  });
});

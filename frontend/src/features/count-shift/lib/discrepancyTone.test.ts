import { describe, it, expect } from 'vitest';
import { discrepancyTone } from './discrepancyTone';

describe('discrepancyTone — §7.6/§7.7', () => {
  it('reads leaf when the count matched exactly', () => {
    expect(discrepancyTone('0.00')).toBe('leaf');
  });

  it('reads destructive when the count came in short', () => {
    expect(discrepancyTone('-50.00')).toBe('destructive');
  });

  it('reads destructive when the count came in over, not just under', () => {
    expect(discrepancyTone('25.00')).toBe('destructive');
  });
});

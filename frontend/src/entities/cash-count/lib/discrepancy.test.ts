import { describe, it, expect } from 'vitest';
import { describeDiscrepancy } from './discrepancy';

describe('describeDiscrepancy — one name for a count difference (rule 5)', () => {
  it('names an exact match, leaf', () => {
    expect(describeDiscrepancy('0.00')).toEqual({ kind: 'matched', amount: '0.00', tone: 'leaf' });
  });

  it('names a shortage by its magnitude, bad', () => {
    expect(describeDiscrepancy('-90.00')).toEqual({ kind: 'shortage', amount: '90.00', tone: 'bad' });
  });

  it('names a surplus by its magnitude, amber', () => {
    expect(describeDiscrepancy('50.00')).toEqual({ kind: 'surplus', amount: '50.00', tone: 'amber' });
  });
});

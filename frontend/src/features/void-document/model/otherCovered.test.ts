import { describe, it, expect } from 'vitest';
import type { SupplierSettlement } from '@/entities/supplier';
import { otherCovered } from './otherCovered';

const line = (id: string, kind: 'intake' | 'top_up', intake_id: string) => ({
  kind, id, code: 'C', intake_id, business_date: '2026-09-25', created_at: '', amount: '0.00',
  paid: '0.00', open: '0.00', covered_by: [],
});

const settlement: SupplierSettlement = {
  supplier_id: 's',
  debt: '0.00',
  unallocated: '0.00',
  lines: [line('old', 'intake', 'old'), line('r', 'intake', 'r'), line('t', 'top_up', 'r')],
  payouts: [
    {
      id: 'p', code: 'P', business_date: '2026-09-25', created_at: '', amount: '1500.00',
      intake_id: 'r', unallocated: '0.00',
      covers: [
        { line_id: 'r', kind: 'intake', amount: '400.00' },
        { line_id: 't', kind: 'top_up', amount: '100.00' },
        { line_id: 'old', kind: 'intake', amount: '1000.00' },
      ],
    },
  ],
};

describe('otherCovered', () => {
  it('sums what the payout covers outside the receipt and its top-ups', () => {
    expect(otherCovered(settlement, 'p', 'r')).toBe('1000.00');
  });

  it('seen from another receipt, counts this receipt and its top-up as "other"', () => {
    expect(otherCovered(settlement, 'p', 'old')).toBe('500.00');
  });

  it('is zero when the payout is not in the settlement', () => {
    expect(otherCovered({ ...settlement, payouts: [] }, 'p', 'r')).toBe('0.00');
  });
});

import { describe, it, expect } from 'vitest';
import type { SupplierSettlement } from '@/entities/supplier';
import { reopenedCodes } from './reopenedCodes';

// A top-up line carries its parent receipt's code, as the settlement does.
const line = (id: string, kind: 'intake' | 'top_up', intake_id: string) => ({
  kind, id, code: `ПР-${intake_id}`, intake_id, business_date: '2026-09-25', created_at: '', amount: '0.00',
  paid: '0.00', open: '0.00', covered_by: [],
});

const settlement: SupplierSettlement = {
  supplier_id: 's',
  debt: '0.00',
  intakes_total: '0.00',
  top_ups_total: '0.00',
  payouts_total: '0.00',
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

describe('reopenedCodes', () => {
  it('lists the codes the payout covers outside the receipt, oldest first, once each', () => {
    expect(reopenedCodes(settlement, 'p', 'r')).toEqual(['ПР-old']);
  });

  it('with no receipt excluded, lists everything the payout covers, a top-up folded into its parent', () => {
    expect(reopenedCodes(settlement, 'p', null)).toEqual(['ПР-old', 'ПР-r']);
  });

  it('is empty when the payout is not in the settlement', () => {
    expect(reopenedCodes({ ...settlement, payouts: [] }, 'p', null)).toEqual([]);
  });
});

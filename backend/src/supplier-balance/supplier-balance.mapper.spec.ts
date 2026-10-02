import { toSupplierSettlementResponse } from './supplier-balance.mapper';

describe('toSupplierSettlementResponse', () => {
  it('maps field by field and resolves payout codes onto covered_by', () => {
    const out = toSupplierSettlementResponse('sup', {
      debt: '-50.00',
      intakes_total: '100.00',
      top_ups_total: '0.00',
      payouts_total: '150.00',
      unallocated: '50.00',
      lines: [
        {
          id: 'r1', kind: 'intake', code: 'R1', intake_id: 'r1',
          business_date: '2026-07-12', created_at: '2026-07-12 08:00:00+00',
          amount: '100.00', paid: '100.00', open: '0.00',
          covered_by: [{ payout_id: 'p1', amount: '100.00' }],
          // a stray field a later SELECT might add must not leak
          ...({ supplier_secret: 'x' } as object),
        },
      ],
      payouts: [
        {
          id: 'p1', code: 'P1', business_date: '2026-08-04', created_at: '2026-08-04 10:00:00+00',
          amount: '150.00', intake_id: null,
          covers: [{ line_id: 'r1', kind: 'intake', amount: '100.00' }],
          unallocated: '50.00',
        },
      ],
    });

    expect(out).toEqual({
      supplier_id: 'sup',
      debt: '-50.00',
      intakes_total: '100.00',
      top_ups_total: '0.00',
      payouts_total: '150.00',
      unallocated: '50.00',
      lines: [
        {
          kind: 'intake', id: 'r1', code: 'R1', intake_id: 'r1',
          business_date: '2026-07-12', created_at: '2026-07-12 08:00:00+00',
          amount: '100.00', paid: '100.00', open: '0.00',
          covered_by: [{ payout_id: 'p1', payout_code: 'P1', amount: '100.00' }],
        },
      ],
      payouts: [
        {
          id: 'p1', code: 'P1', business_date: '2026-08-04', created_at: '2026-08-04 10:00:00+00',
          amount: '150.00', intake_id: null,
          covers: [{ line_id: 'r1', kind: 'intake', amount: '100.00' }],
          unallocated: '50.00',
        },
      ],
    });
    expect(out.lines[0]).not.toHaveProperty('supplier_secret');
  });
});

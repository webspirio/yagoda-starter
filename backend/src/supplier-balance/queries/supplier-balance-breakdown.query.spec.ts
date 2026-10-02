import { SupplierBalanceBreakdownQuery } from './supplier-balance-breakdown.query';

const SUPPLIER = '44444444-4444-4444-4444-444444444444';

/**
 * `debt` plus the season counters, in one read (#103). The three terms of
 * `debt` are NOT projected here — they ride on `/settlement` so the card's
 * breakdown line shares the balance tile's snapshot (#153); this read is also
 * the reception screen's payout ceiling, which wants only `debt`.
 */
describe('SupplierBalanceBreakdownQuery', () => {
  const row = {
    debt: '4200.00',
    intakes_count: 3,
    kg_total: '250.50',
    last_intake_date: '2026-09-20',
  };

  it('returns the debt and the season counters', async () => {
    const query = jest.fn().mockResolvedValue([row]);
    const service = new SupplierBalanceBreakdownQuery({ manager: { query } } as never);

    await expect(service.breakdownFor(SUPPLIER)).resolves.toEqual(row);
  });

  it('does not project the three terms of the debt', async () => {
    const query = jest.fn().mockResolvedValue([row]);
    const service = new SupplierBalanceBreakdownQuery({ manager: { query } } as never);

    await service.breakdownFor(SUPPLIER);

    const [sql] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toMatch(/intakes_total|top_ups_total|payouts_total/);
  });
});

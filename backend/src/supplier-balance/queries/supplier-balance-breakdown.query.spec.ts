import { SupplierBalanceBreakdownQuery } from './supplier-balance-breakdown.query';
import { add, sub } from '../../common/money';

const SUPPLIER = '44444444-4444-4444-4444-444444444444';

/**
 * The balance AND what it is made of, in one read (#103). `SupplierDebtQuery.debtFor`
 * and `breakdownFor` here must never be able to disagree, because `breakdownFor`'s
 * `debt` column is `debtSql` itself, composed from the same three term builders —
 * this test proves that composition arithmetically rather than by re-reading the SQL text.
 */
describe('SupplierBalanceBreakdownQuery', () => {
  it('returns three terms that add up to the debt it returns with them', async () => {
    const row = {
      debt: '4200.00',
      intakes_total: '10000.00',
      top_ups_total: '200.00',
      payouts_total: '6000.00',
      intakes_count: 3,
      kg_total: '250.50',
      last_intake_date: '2026-09-20',
    };
    const query = jest.fn().mockResolvedValue([row]);
    const service = new SupplierBalanceBreakdownQuery({ manager: { query } } as never);

    const result = await service.breakdownFor(SUPPLIER);

    expect(result).toEqual(row);
    expect(add(result.intakes_total, result.top_ups_total)).toBe('10200.00');
    expect(sub('10200.00', result.payouts_total)).toBe(result.debt);
  });
});

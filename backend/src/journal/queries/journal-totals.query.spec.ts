import { JournalTotalsQuery } from './journal-totals.query';
import { UserRole } from '../../users/user-role.enum';

const POINT_A = '11111111-1111-1111-1111-111111111111';
const POINT_B = '22222222-2222-2222-2222-222222222222';
const SUPPLIER = '33333333-3333-3333-3333-333333333333';
const owner = { sub: 'u-owner', username: 'owner', role: UserRole.NetworkOwner, collection_point_id: null };
const operator = { sub: 'u-op', username: 'op', role: UserRole.PointOperator, collection_point_id: POINT_A };

describe('JournalTotalsQuery', () => {
  let query: jest.Mock;
  let totals: JournalTotalsQuery;

  beforeEach(() => {
    query = jest.fn().mockResolvedValue([{ accrued: '1500.00', paid: '900.00' }]);
    totals = new JournalTotalsQuery({ query } as never);
  });

  it('returns both sums from one statement', async () => {
    await expect(totals.totals(owner, { from: '2026-10-01', to: '2026-10-31' })).resolves.toEqual({
      accrued: '1500.00',
      paid: '900.00',
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('passes the owner’s point and supplier through, null when absent', async () => {
    await totals.totals(owner, { from: '2026-10-01', to: '2026-10-31' });
    expect(query.mock.calls[0][1]).toEqual(['2026-10-01', '2026-10-31', null, null]);

    await totals.totals(owner, {
      from: '2026-10-01',
      to: '2026-10-31',
      collection_point_id: POINT_B,
      supplier_id: SUPPLIER,
    });
    expect(query.mock.calls[1][1]).toEqual(['2026-10-01', '2026-10-31', POINT_B, SUPPLIER]);
  });

  it('pins an operator to their own point, ignoring the requested one', async () => {
    await totals.totals(operator, { from: '2026-10-01', to: '2026-10-31', collection_point_id: POINT_B });
    expect(query.mock.calls[0][1]).toEqual(['2026-10-01', '2026-10-31', POINT_A, null]);
  });
});

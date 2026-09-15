import { PointCashService } from './point-cash.service';
import { toPointCashRowResponse, PointCashRow } from './point-cash.mapper';
import { TransferStatus } from '../transfers/transfer-status.enum';

/**
 * THE CRATES FIGURE, UNIT-LEVEL. What needs proving here is not the SQL's
 * arithmetic (that is `CrateBalanceService`'s and its db-spec's job) but that
 * `point-cash` surfaces it as its OWN field, on BOTH reads, without folding it
 * into `cash` and without letting `as_of` anywhere near it — see
 * `point-cash.service.ts`'s and `point-cash.mapper.ts`'s doc comments.
 */
describe('PointCashService — crate deposits book', () => {
  let query: jest.Mock;
  let dataSource: { manager: { query: jest.Mock } };
  let service: PointCashService;

  beforeEach(() => {
    query = jest.fn();
    dataSource = { manager: { query } };
    service = new PointCashService(dataSource as never, { appTimezone: 'Europe/Kyiv' });
  });

  describe('crateDepositsFor', () => {
    it('reports the crates book as its own figure, never folded into cash', async () => {
      query.mockResolvedValue([{ crate_deposits: '2400.00' }]);

      await expect(service.crateDepositsFor('point-1')).resolves.toBe('2400.00');
    });

    it('splices CRATE_BOOK_SQL and binds the point id as $1, nothing else', async () => {
      query.mockResolvedValue([{ crate_deposits: '0.00' }]);

      await service.crateDepositsFor('point-1');

      const [sql, params] = query.mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/crate_issuances/);
      expect(sql).toMatch(/crate_returns/);
      expect(sql).toMatch(/deposit_taken/);
      expect(sql).toMatch(/deposit_refund/);
      expect(params).toEqual(['point-1']);
    });

    it('reads inside a caller’s transaction when given a manager', async () => {
      const managerQuery = jest.fn().mockResolvedValue([{ crate_deposits: '10.00' }]);

      await service.crateDepositsFor('point-1', { query: managerQuery } as never);

      expect(managerQuery).toHaveBeenCalled();
      expect(query).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    const row: PointCashRow = {
      collection_point_id: 'point-1',
      name: 'Точка',
      target_cash: '500.00',
      cash: '500.00',
      shortfall: '0.00',
      unexplained_difference: '0.00',
      crate_deposits: '2400.00',
      latest_transfer_status: null,
      latest_transfer_sent_at: null,
    };

    beforeEach(() => {
      query.mockReset();
      query.mockResolvedValueOnce([row]).mockResolvedValueOnce([{ total: 1 }]);
    });

    const listQuery = (over: Record<string, unknown> = {}) => ({
      page: 1,
      limit: 20,
      ...over,
    });

    it('selects the crates figure in the SAME query as the rest of the row — no N+1', async () => {
      await service.list({ sub: 'u', username: 'owner', role: 'network_owner', collection_point_id: null } as never, listQuery() as never);

      // Exactly one query for the page, one for the count — never one per row.
      expect(query).toHaveBeenCalledTimes(2);
      const [pageSql] = query.mock.calls[0] as [string, unknown[]];
      expect(pageSql).toMatch(/AS crate_deposits/);
      expect(pageSql).toMatch(/crate_issuances/);
    });

    it('maps crate_deposits onto the response as its own field', async () => {
      const result = await service.list(
        { sub: 'u', username: 'owner', role: 'network_owner', collection_point_id: null } as never,
        listQuery() as never,
      );

      expect(result.data[0]?.crate_deposits).toBe('2400.00');
      expect(result.data[0]?.cash).not.toBe('2400.00');
    });
  });
});

describe('toPointCashRowResponse — crate deposits stay separate', () => {
  const row: PointCashRow = {
    collection_point_id: 'point-1',
    name: 'Точка',
    target_cash: '500.00',
    cash: '500.00',
    shortfall: '0.00',
    unexplained_difference: '0.00',
    crate_deposits: '2400.00',
    latest_transfer_status: TransferStatus.Accepted,
    latest_transfer_sent_at: new Date('2026-09-01T00:00:00Z'),
  };

  it('reports the crates book as its own field, never folded into cash', () => {
    const response = toPointCashRowResponse(row);

    expect(response.crate_deposits).toBe('2400.00');
    expect(response.cash).not.toBe('2400.00');
    expect(response.cash).toBe('500.00');
  });
});

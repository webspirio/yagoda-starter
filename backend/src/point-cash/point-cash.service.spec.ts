import { PointCashService } from './point-cash.service';
import { crateBookSql, crateUnitsSql } from '../crates/crate-balance.service';
import { toPointCashRowResponse, PointCashRow } from './point-cash.mapper';
import { TransferStatus } from '../transfers/transfer-status.enum';

/**
 * THE FUNCTION, PINNED. `crateBookSql` used to be a `$1`-only string
 * constant that `point-cash.service.ts` rewrote by TEXT SUBSTITUTION for its
 * correlated list CTE — real SQL parameterisation now: the caller passes the
 * point expression it wants (`'$1'` for a bound parameter, `'cp.id'` for a
 * correlated column) and gets that expression spliced into both predicates.
 * These tests pin BOTH call shapes' output directly, in place of the old
 * canary that counted `$1` occurrences in a shared constant — there is no
 * longer a shared constant whose shape a rewrite could drift out from under.
 */
describe('crateBookSql — both call shapes', () => {
  it('produces a bound-parameter predicate for pointDepositBook / crateDepositsFor', () => {
    const sql = crateBookSql('$1');

    expect(sql).toContain('cs.collection_point_id = $1');
    expect(sql).toContain('rs.collection_point_id = $1');
    expect(sql).not.toContain('cp.id');
  });

  it('produces a correlated-column predicate for the list CTE', () => {
    const sql = crateBookSql('cp.id');

    expect(sql).toContain('cs.collection_point_id = cp.id');
    expect(sql).toContain('rs.collection_point_id = cp.id');
    expect(sql).not.toMatch(/\$1/);
  });
});

/**
 * R8 — SAME PINNING, FOR THE UNITS COUNTER. `crateUnitsSql` is a SEPARATE
 * function from `crateBookSql` (see that function's own doc comment), so it
 * needs its own canary rather than inheriting the money one's coverage.
 */
describe('crateUnitsSql — both call shapes', () => {
  it('produces a bound-parameter predicate for crateUnitsFor', () => {
    const sql = crateUnitsSql('$1');

    expect(sql).toContain('cs.collection_point_id = $1');
    expect(sql).not.toContain('cp.id');
    // Only deposit-mode issuances count units — R8's whole point.
    expect(sql).toContain("ci.mode = 'deposit'");
    expect(sql).toMatch(/::int\s*$/);
  });

  it('produces a correlated-column predicate for the list CTE', () => {
    const sql = crateUnitsSql('cp.id');

    expect(sql).toContain('cs.collection_point_id = cp.id');
    expect(sql).not.toMatch(/\$1/);
  });
});

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

    it('splices crateBookSql(\'$1\') and binds the point id as $1, nothing else', async () => {
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

  describe('crateUnitsFor', () => {
    it('reports the crate units figure as its own integer, never folded into crate_deposits', async () => {
      query.mockResolvedValue([{ crate_deposit_units: 13 }]);

      await expect(service.crateUnitsFor('point-1')).resolves.toBe(13);
    });

    it("splices crateUnitsSql('$1') and binds the point id as $1, nothing else", async () => {
      query.mockResolvedValue([{ crate_deposit_units: 0 }]);

      await service.crateUnitsFor('point-1');

      const [sql, params] = query.mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/crate_issuances/);
      expect(sql).toMatch(/crate_return_allocations/);
      expect(sql).toMatch(/mode = 'deposit'/);
      expect(params).toEqual(['point-1']);
    });

    it('reads inside a caller’s transaction when given a manager', async () => {
      const managerQuery = jest.fn().mockResolvedValue([{ crate_deposit_units: 5 }]);

      await service.crateUnitsFor('point-1', { query: managerQuery } as never);

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
      crate_deposit_units: 13,
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
      expect(pageSql).toMatch(/AS crate_deposit_units/);
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

    it('maps crate_deposit_units onto the response as its own integer field (R8)', async () => {
      const result = await service.list(
        { sub: 'u', username: 'owner', role: 'network_owner', collection_point_id: null } as never,
        listQuery() as never,
      );

      expect(result.data[0]?.crate_deposit_units).toBe(13);
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
    crate_deposit_units: 13,
    latest_transfer_status: TransferStatus.Accepted,
    latest_transfer_sent_at: new Date('2026-09-01T00:00:00Z'),
  };

  it('reports the crates book as its own field, never folded into cash', () => {
    const response = toPointCashRowResponse(row);

    expect(response.crate_deposits).toBe('2400.00');
    expect(response.cash).not.toBe('2400.00');
    expect(response.cash).toBe('500.00');
  });

  it('reports the crate units figure as its own integer field (R8)', () => {
    const response = toPointCashRowResponse(row);

    expect(response.crate_deposit_units).toBe(13);
  });
});

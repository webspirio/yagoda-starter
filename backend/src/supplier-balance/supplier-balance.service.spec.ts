import { SupplierBalanceService } from './supplier-balance.service';
import { UserRole } from '../users/user-role.enum';

const SUPPLIER = '44444444-4444-4444-4444-444444444444';
const POINT_A = '11111111-1111-1111-1111-111111111111';
const POINT_B = '22222222-2222-2222-2222-222222222222';

const owner = {
  sub: 'u-owner',
  username: 'owner',
  role: UserRole.NetworkOwner,
  collection_point_id: null,
};
const oksana = {
  sub: 'u-oksana',
  username: 'oksana',
  role: UserRole.PointOperator,
  collection_point_id: POINT_A,
};

describe('SupplierBalanceService', () => {
  let query: jest.Mock;
  let dataSource: { manager: { query: jest.Mock } };
  let service: SupplierBalanceService;

  beforeEach(() => {
    query = jest.fn().mockResolvedValue([{ debt: '380.00' }]);
    dataSource = { manager: { query } };
    service = new SupplierBalanceService(dataSource as never);
  });

  const sql = () => (query.mock.calls[0] as [string, unknown[]])[0];

  it('is Σ intakes − Σ payouts', async () => {
    await expect(service.debtFor(SUPPLIER)).resolves.toBe('380.00');

    expect(sql()).toMatch(/SUM\(i\.amount\)[\s\S]*intakes/);
    expect(sql()).toMatch(/SUM\(p\.amount\)[\s\S]*payouts/);
  });

  /**
   * The two filters are asserted INDEPENDENTLY because that is the failure the
   * `suppliers` Note warns about: «забути його на будь-якій означає або гасити
   * борг грошима, яких не видали, або тримати борг за ягоду, якої не брали».
   * One test covering "there is a voided_at somewhere in the SQL" would pass
   * with either half missing.
   */
  it('EXCLUDES voided intakes', async () => {
    await service.debtFor(SUPPLIER);

    expect(sql()).toMatch(/FROM intakes i\s+WHERE i\.supplier_id = \$1 AND i\.voided_at IS NULL/);
  });

  it('EXCLUDES voided payouts', async () => {
    await service.debtFor(SUPPLIER);

    expect(sql()).toMatch(/FROM payouts p\s+WHERE p\.supplier_id = \$1 AND p\.voided_at IS NULL/);
  });

  it('does NOT filter by point', async () => {
    // §3.9 — `supplier_id` already means the point, and the Note calls a point
    // filter «не треба й не можна».
    await service.debtFor(SUPPLIER);

    expect(sql()).not.toMatch(/collection_point_id/);
  });

  it('returns 0.00 for a supplier with no documents at all', async () => {
    // «Перший день роботи показує всім нуль — це очікуваний стан, а не втрата
    // даних.» There is no opening-balance mechanism and there will not be one,
    // which is why COALESCE(..., 0.00) is on all three terms.
    query.mockResolvedValue([{ debt: '0.00' }]);

    await expect(service.debtFor(SUPPLIER)).resolves.toBe('0.00');
    expect(sql()).toMatch(/COALESCE[\s\S]*COALESCE[\s\S]*COALESCE/);
    // The fallback literal is `0.00`, not `0`: `COALESCE(NULL, 0)` is an
    // integer zero Postgres renders as '0', and a mock cannot see that — so
    // the literal itself is asserted, once per term. Proven against a real
    // Postgres by supplier-balance-list.db-spec.ts's «Петро».
    expect(sql().match(/, 0\.00\)/g)).toHaveLength(3);
  });

  it('correlates top-ups through their parent intake and filters BOTH void columns', async () => {
    await service.debtFor(SUPPLIER);

    expect(sql()).toContain('FROM intake_top_ups t');
    expect(sql()).toContain('JOIN intakes ti ON ti.id = t.intake_id');
    // Regexes, not literals: these assert the two filters exist, not how the
    // SQL happens to be indented.
    expect(sql()).toMatch(/ti\.voided_at\s+IS NULL/);
    expect(sql()).toMatch(/\bt\.voided_at\s+IS NULL/);
  });

  it('passes a negative balance through unclamped', async () => {
    // The one legitimate route below zero: a voided receipt that had already
    // been paid for. «інваріанта борг >= 0 в цій схемі немає» — a clamp here
    // would be asserting a rule the schema explicitly refuses.
    query.mockResolvedValue([{ debt: '-120.00' }]);

    await expect(service.debtFor(SUPPLIER)).resolves.toBe('-120.00');
  });

  it('reads inside a caller’s transaction when given a manager', async () => {
    // What makes the payout ceiling correct: the debt must be read under the
    // same lock as the insert that follows it.
    const managerQuery = jest.fn().mockResolvedValue([{ debt: '1.00' }]);

    await service.debtFor(SUPPLIER, { query: managerQuery } as never);

    expect(managerQuery).toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  /**
   * `GET /supplier-balances` — the «Залишки» screen: every supplier's
   * outstanding balance at a point, on one page. The formula is asserted here
   * in the SAME shape the single-supplier tests above use, because the whole
   * point of the list living in this module is that it cannot have a formula
   * of its own.
   */
  describe('list', () => {
    const row = {
      supplier_id: SUPPLIER,
      first_name: 'Іван',
      last_name: 'Коваль',
      is_active: true,
      collection_point_id: POINT_A,
      debt: '380.00',
    };
    const listQuery = (over: Record<string, unknown> = {}) => ({
      page: 1,
      limit: 20,
      include_zero: false,
      ...over,
    });

    const call = (n: number) => query.mock.calls[n] as [string, unknown[]];
    const pageSql = () => call(0)[0];
    const pageParams = () => call(0)[1];
    const countSql = () => call(1)[0];
    const countParams = () => call(1)[1];

    beforeEach(() => {
      query.mockReset();
      query.mockResolvedValueOnce([row]).mockResolvedValueOnce([{ total: 7 }]);
    });

    it('returns the standard envelope — rows mapped field by field, total from a second count', async () => {
      await expect(service.list(oksana, listQuery())).resolves.toEqual({
        data: [row],
        total: 7,
        page: 1,
        limit: 20,
      });
      expect(query).toHaveBeenCalledTimes(2);
    });

    it('uses THE debt formula, correlated on the supplier row, with voided rows out of BOTH halves', async () => {
      await service.list(oksana, listQuery());

      for (const sql of [pageSql(), countSql()]) {
        expect(sql).toMatch(
          /FROM intakes i\s+WHERE i\.supplier_id = s\.id AND i\.voided_at IS NULL/,
        );
        expect(sql).toMatch(
          /FROM payouts p\s+WHERE p\.supplier_id = s\.id AND p\.voided_at IS NULL/,
        );
      }
    });

    it('casts the debt to text so no money passes through a JS number', async () => {
      await service.list(oksana, listQuery());

      expect(pageSql()).toMatch(/debt::text/);
    });

    it('pins an operator to their own point even when they name another', async () => {
      await service.list(oksana, listQuery({ collection_point_id: POINT_B }));

      expect(pageParams()[0]).toBe(POINT_A);
      expect(countParams()[0]).toBe(POINT_A);
    });

    it('gives the owner every point, or the one they ask for', async () => {
      await service.list(owner, listQuery());
      expect(pageParams()[0]).toBeNull();
      expect(countParams()[0]).toBeNull();

      query.mockReset();
      query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0 }]);
      await service.list(owner, listQuery({ collection_point_id: POINT_B }));
      expect(pageParams()[0]).toBe(POINT_B);
    });

    it('403s an operator with no point rather than widening to the network', async () => {
      const unassigned = { ...oksana, collection_point_id: null };

      await expect(service.list(unassigned, listQuery())).rejects.toMatchObject({
        response: { code: 'NO_COLLECTION_POINT' },
      });
      expect(query).not.toHaveBeenCalled();
    });

    it('hides zero balances by default, and shows them only on include_zero', async () => {
      await service.list(oksana, listQuery());
      expect(pageSql()).toMatch(/debt <> 0/);
      expect(pageParams()[1]).toBe(false);
      expect(countParams()[1]).toBe(false);

      query.mockReset();
      query.mockResolvedValueOnce([row]).mockResolvedValueOnce([{ total: 1 }]);
      await service.list(oksana, listQuery({ include_zero: true }));
      expect(pageParams()[1]).toBe(true);
      expect(countParams()[1]).toBe(true);
    });

    it('orders by debt DESC, then last name, first name, id — a TOTAL order', async () => {
      await service.list(oksana, listQuery());

      expect(pageSql()).toMatch(
        /ORDER BY b\.debt DESC, b\.last_name ASC, b\.first_name ASC, b\.id ASC/,
      );
    });

    it('paginates in SQL', async () => {
      await service.list(oksana, listQuery({ page: 3, limit: 10 }));

      expect(pageSql()).toMatch(/LIMIT \$3 OFFSET \$4/);
      expect(pageParams().slice(2)).toEqual([10, 20]);
      expect(countSql()).not.toMatch(/LIMIT/);
    });
  });
});

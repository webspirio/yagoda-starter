import { ListSupplierBalancesQuery } from './list-supplier-balances.query';
import { UserRole } from '../../users/user-role.enum';

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

describe('ListSupplierBalancesQuery', () => {
  let query: jest.Mock;
  let dataSource: { manager: { query: jest.Mock } };
  let service: ListSupplierBalancesQuery;

  beforeEach(() => {
    query = jest.fn().mockResolvedValue([{ debt: '380.00' }]);
    dataSource = { manager: { query } };
    service = new ListSupplierBalancesQuery(dataSource as never);
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

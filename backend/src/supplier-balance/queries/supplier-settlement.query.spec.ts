import { SupplierSettlementQuery } from './supplier-settlement.query';
import { SupplierDebtQuery } from './supplier-debt.query';

const SUPPLIER = '44444444-4444-4444-4444-444444444444';

describe('SupplierSettlementQuery', () => {
  let query: jest.Mock;
  let dataSource: { manager: { query: jest.Mock } };
  let service: SupplierSettlementQuery;

  beforeEach(() => {
    query = jest.fn().mockResolvedValue([{ debt: '380.00' }]);
    dataSource = { manager: { query } };
    service = new SupplierSettlementQuery(
      dataSource as never,
      new SupplierDebtQuery(dataSource as never),
    );
  });

  /**
   * `settlementFor` is three reads plus `debtFor`. The unit spec holds the
   * SHAPE of each read — the four `voided_at` filters and the order key — the
   * same way the tests above hold `debtFor`'s; `settlement.db-spec.ts` holds
   * the values against a real Postgres.
   */
  describe('settlementFor', () => {
    const calls = () => query.mock.calls as [string, unknown[]][];

    beforeEach(() => {
      // `settlementFor` runs inside `dataSource.transaction`, which the file's
      // shared mock does not have: rebuild the service over a mock that hands
      // the same `query` to the transaction callback.
      const ds = {
        manager: { query },
        transaction: (_level: string, fn: (m: { query: jest.Mock }) => unknown) => fn({ query }),
      } as never;
      service = new SupplierSettlementQuery(ds, new SupplierDebtQuery(ds));
      query.mockReset();
      query
        .mockResolvedValueOnce([]) // receipts
        .mockResolvedValueOnce([]) // top-ups
        .mockResolvedValueOnce([]) // payouts
        .mockResolvedValueOnce([]) // allocations
        .mockResolvedValueOnce([
          { debt: '0.00', intakes_total: '0.00', top_ups_total: '0.00', payouts_total: '0.00' },
        ]); // termsFor
    });

    it('reads receipts, top-ups, payouts and allocations, then the debt and its terms, all for the one supplier', async () => {
      const s = await service.settlementFor(SUPPLIER);
      expect(s).toEqual({
        debt: '0.00',
        intakes_total: '0.00',
        top_ups_total: '0.00',
        payouts_total: '0.00',
        unallocated: '0.00',
        lines: [],
        payouts: [],
      });
      expect(calls()).toHaveLength(5);
      for (const [, params] of calls()) expect(params).toEqual([SUPPLIER]);
    });

    it('EXCLUDES voided receipts and orders them by (business_date, created_at, id)', async () => {
      await service.settlementFor(SUPPLIER);
      const [sql] = calls()[0];
      expect(sql).toMatch(/FROM intakes i[\s\S]*JOIN shifts s ON s\.id = i\.shift_id/);
      expect(sql).toMatch(/i\.voided_at IS NULL/);
      expect(sql).toMatch(/ORDER BY s\.business_date, i\.created_at, i\.id/);
    });

    it('EXCLUDES voided top-ups AND top-ups of voided receipts, dated by the parent', async () => {
      await service.settlementFor(SUPPLIER);
      const [sql] = calls()[1];
      expect(sql).toMatch(/FROM intake_top_ups t[\s\S]*JOIN intakes ti ON ti\.id = t\.intake_id/);
      expect(sql).toMatch(/JOIN shifts s ON s\.id = ti\.shift_id/);
      expect(sql).toMatch(/t\.voided_at IS NULL/);
      expect(sql).toMatch(/ti\.voided_at IS NULL/);
      expect(sql).toMatch(/s\.business_date::text AS business_date/);
    });

    it('EXCLUDES voided payouts and orders them by (business_date, created_at, id)', async () => {
      await service.settlementFor(SUPPLIER);
      const [sql] = calls()[2];
      expect(sql).toMatch(/FROM payouts p[\s\S]*JOIN shifts s ON s\.id = p\.shift_id/);
      expect(sql).toMatch(/p\.voided_at IS NULL/);
      expect(sql).toMatch(/ORDER BY s\.business_date, p\.created_at, p\.id/);
    });

    it('merges receipts and top-ups by the same key before settling', async () => {
      query.mockReset();
      query
        .mockResolvedValueOnce([
          {
            id: 'r1',
            code: 'R1',
            business_date: '2026-07-12',
            created_at: '2026-07-12T08:00:00.000Z',
            amount: '1000.00',
          },
          {
            id: 'r2',
            code: 'R2',
            business_date: '2026-07-15',
            created_at: '2026-07-15T08:00:00.000Z',
            amount: '500.00',
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 't1',
            code: 'R1',
            intake_id: 'r1',
            business_date: '2026-07-12',
            created_at: '2026-07-20T12:00:00.000Z',
            amount: '200.00',
          },
        ])
        .mockResolvedValueOnce([]) // payouts
        .mockResolvedValueOnce([]) // allocations
        .mockResolvedValueOnce([
          {
            debt: '1700.00',
            intakes_total: '1500.00',
            top_ups_total: '200.00',
            payouts_total: '0.00',
          },
        ]);

      const s = await service.settlementFor(SUPPLIER);
      expect(s.lines.map((l) => l.id)).toEqual(['r1', 't1', 'r2']);
      expect(s.lines[1]).toMatchObject({ kind: 'top_up', intake_id: 'r1', code: 'R1' });
      expect(s.debt).toBe('1700.00');
      expect(s).toMatchObject({ intakes_total: '1500.00', top_ups_total: '200.00' });
    });
  });
});

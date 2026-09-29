import { SupplierDebtQuery } from './supplier-debt.query';

const SUPPLIER = '44444444-4444-4444-4444-444444444444';

describe('SupplierDebtQuery', () => {
  let query: jest.Mock;
  let dataSource: { manager: { query: jest.Mock } };
  let service: SupplierDebtQuery;

  beforeEach(() => {
    query = jest.fn().mockResolvedValue([{ debt: '380.00' }]);
    dataSource = { manager: { query } };
    service = new SupplierDebtQuery(dataSource as never);
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
});

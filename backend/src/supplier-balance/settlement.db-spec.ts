import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { SupplierSettlementQuery } from './queries/supplier-settlement.query';
import { SupplierDebtQuery } from './queries/supplier-debt.query';
import { AllocationsService } from './services/allocations';
import { allocationViolations } from '../testing/allocation-invariants';
import { sub, sum } from '../common/money';

/**
 * `settlementFor` against a real Postgres. What is under test is the SQL:
 * the four `voided_at` filters, the `(business_date, created_at, id)` order
 * across three sources, the parent's date on a top-up — and the one promise
 * of the slice, `debt === Σ open − unallocated`. Per-run uuid fixtures: the
 * throwaway database persists between runs and nothing here truncates.
 *
 * One supplier, Ніна, with:
 *   12.07  R1 1000.00
 *   12.07  top-up 200.00 on R1 (written 20.08 — must still queue behind R1)
 *   12.07  top-up 70.00 on R1, VOIDED on its own merits — R1 stays LIVE, so this
 *          is the case `debtSql`'s two-filter comment names but this file never
 *          exercised: a top-up voided while its parent receipt is untouched.
 *   15.07  R2 300.00  VOIDED, with a top-up 50.00 (must count for nothing)
 *   15.07  R3 500.00
 *   04.08  P1 1300.00 bound to R2 (voided) → whole payout goes FIFO
 *   04.08  P2 100.00  VOIDED
 *   05.08  R4 250.00  (a reopened-shift receipt written AFTER P1 by the clock)
 */
describe('SupplierSettlementQuery.settlementFor (Postgres)', () => {
  let ds: DataSource;
  let service: SupplierSettlementQuery;
  let debtQuery: SupplierDebtQuery;
  let run: string;
  let userId: string;
  let supplierId: string;
  let ids: Record<string, string>;

  let seq = 0;
  // CLOSED by default: `UQ_shifts_open_per_point` is a partial unique index
  // over `closed_at IS NULL` (one open shift per point at a time), and this
  // fixture opens four shifts at ONE point across four dates — the same
  // pattern `point-cash.db-spec.ts`'s `shift()` helper uses for the same
  // reason. Nothing here exercises open/close behaviour, so a closed shift
  // is a fixture detail, not a deviation from what is under test.
  const shift = async (point: string, date: string): Promise<string> => {
    const [row] = await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date,
                           closed_at, closed_by_user_id, status)
       VALUES ($1, $2, $3, now(), $2, 'closed') RETURNING id`,
      [point, userId, date],
    );
    return row.id as string;
  };
  // `createdAt` is explicit and REQUIRED, not defaulted to `now()`: the
  // narrative below ("R1 12.07", "written 20.08 — must still queue behind
  // R1") is an ordering claim, and the wall-clock time this suite happens to
  // run at must never be part of that ordering.
  const intake = async (
    shiftId: string,
    amount: string,
    createdAt: string,
    voided = false,
  ): Promise<string> => {
    const [row] = await ds.query(
      `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id, created_at,
                            voided_at, voided_by_user_id, void_reason)
       VALUES ($1, $2, $3, $4, $5, $6,
               CASE WHEN $7 THEN now() END, CASE WHEN $7 THEN $5::uuid END,
               CASE WHEN $7 THEN 'test' END) RETURNING id`,
      [`IN-${run}-${++seq}`, shiftId, supplierId, amount, userId, createdAt, voided],
    );
    return row.id as string;
  };
  const topUp = async (
    intakeId: string,
    amount: string,
    createdAt: string,
    voided = false,
  ): Promise<string> => {
    const [row] = await ds.query(
      `INSERT INTO intake_top_ups (intake_id, amount, reason, created_by_user_id, created_at,
                                   voided_at, voided_by_user_id, void_reason)
       VALUES ($1, $2, 'доплата', $3, $4,
               CASE WHEN $5 THEN now() END, CASE WHEN $5 THEN $3::uuid END,
               CASE WHEN $5 THEN 'test' END) RETURNING id`,
      [intakeId, amount, userId, createdAt, voided],
    );
    return row.id as string;
  };
  const payout = async (
    shiftId: string,
    amount: string,
    intakeId: string | null,
    createdAt: string,
    voided = false,
  ): Promise<string> => {
    const [row] = await ds.query(
      `INSERT INTO payouts (code, shift_id, supplier_id, amount, paid_by_user_id, intake_id, created_at,
                            voided_at, voided_by_user_id, void_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7,
               CASE WHEN $8 THEN now() END, CASE WHEN $8 THEN $5::uuid END,
               CASE WHEN $8 THEN 'test' END) RETURNING id`,
      [`PO-${run}-${++seq}`, shiftId, supplierId, amount, userId, intakeId, createdAt, voided],
    );
    return row.id as string;
  };

  beforeAll(async () => {
    ds = await openTestDataSource();
    debtQuery = new SupplierDebtQuery(ds);
    service = new SupplierSettlementQuery(ds, debtQuery);
    run = randomUUID();
    const short = run.slice(0, 4).toUpperCase();

    const [point] = await ds.query(
      `INSERT INTO collection_points (name, kind, code) VALUES ($1, 'reception', $2) RETURNING id`,
      [`Розрахунок-${run}`, `S${short}`],
    );
    const [user] = await ds.query(
      `INSERT INTO users (first_name, last_name, role)
       VALUES ('Ніна', 'Керівник', 'network_owner') RETURNING id`,
    );
    userId = user.id;
    const [supplier] = await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name, is_active)
       VALUES ($1, 'Ніна', $2, true) RETURNING id`,
      [point.id, `Ільчук-${run}`],
    );
    supplierId = supplier.id;

    const s0712 = await shift(point.id, '2026-07-12');
    const s0715 = await shift(point.id, '2026-07-15');
    const s0804 = await shift(point.id, '2026-08-04');
    const s0805 = await shift(point.id, '2026-08-05');

    const r1 = await intake(s0712, '1000.00', '2026-07-12T08:00:00Z');
    const t1 = await topUp(r1, '200.00', '2026-08-20T12:00:00Z');
    // Voided on its OWN merits, parent R1 still LIVE — the case `debtSql`'s
    // two-filter comment names (`t.voided_at` vs `ti.voided_at`) and this
    // file never exercised until now.
    const t1v = await topUp(r1, '70.00', '2026-08-20T12:10:00Z', true);
    const r2 = await intake(s0715, '300.00', '2026-07-15T08:00:00Z', true);
    await topUp(r2, '50.00', '2026-08-20T12:05:00Z');
    const r3 = await intake(s0715, '500.00', '2026-07-15T09:00:00Z');
    const p1 = await payout(s0804, '1300.00', r2, '2026-08-04T10:00:00Z');
    await payout(s0804, '100.00', null, '2026-08-04T10:05:00Z', true);
    const r4 = await intake(s0805, '250.00', '2026-08-05T11:00:00Z');
    ids = { r1, t1, t1v, r3, p1, r4 };

    // Allocate once over the final raw state — equal to `settle()` over it,
    // so every expectation below stays as it was.
    await ds.transaction(async (m) => {
      const alloc = new AllocationsService();
      await alloc.lockSupplier(m, supplierId);
      await alloc.allocate(m, supplierId);
    });
  });

  afterAll(async () => {
    await ds.destroy();
  });

  it('queues live lines by (business_date, created_at, id) with the top-up behind its parent', async () => {
    const s = await service.settlementFor(supplierId);
    expect(s.lines.map((l) => l.id)).toEqual([ids.r1, ids.t1, ids.r3, ids.r4]);
    expect(s.lines[1]).toMatchObject({
      kind: 'top_up',
      business_date: '2026-07-12',
      intake_id: ids.r1,
    });
  });

  it('excludes the voided receipt, its top-up and the voided payout', async () => {
    const s = await service.settlementFor(supplierId);
    expect(s.lines.map((l) => l.amount)).toEqual(['1000.00', '200.00', '500.00', '250.00']);
    expect(s.payouts.map((p) => p.id)).toEqual([ids.p1]);
  });

  it('excludes a top-up voided on its own merits, even though its parent receipt is live', async () => {
    const s = await service.settlementFor(supplierId);
    expect(s.lines.map((l) => l.id)).not.toContain(ids.t1v);
  });

  it('a payout bound to a voided receipt goes whole into FIFO, and may reach a younger line', async () => {
    const s = await service.settlementFor(supplierId);
    // 1300 → R1 1000, top-up 200, R3 100 of 500. R4 is untouched.
    expect(s.lines.map((l) => [l.id, l.open])).toEqual([
      [ids.r1, '0.00'],
      [ids.t1, '0.00'],
      [ids.r3, '400.00'],
      [ids.r4, '250.00'],
    ]);
    expect(s.payouts[0].unallocated).toBe('0.00');
  });

  it('debt equals Σ open − unallocated, and equals debtFor', async () => {
    const s = await service.settlementFor(supplierId);
    expect(s.debt).toBe('650.00');
    expect(sub(sum(s.lines.map((l) => l.open)), s.unallocated)).toBe(s.debt);
    await expect(debtQuery.debtFor(supplierId)).resolves.toBe(s.debt);
  });

  it('holds the four allocation invariants', async () => {
    expect(await ds.transaction((m) => allocationViolations(m, supplierId))).toEqual([]);
  });

  it('a supplier with no documents settles to nothing', async () => {
    const [other] = await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name, is_active)
       SELECT collection_point_id, 'Петро', $1, true FROM suppliers WHERE id = $2 RETURNING id`,
      [`Порожній-${run}`, supplierId],
    );
    await expect(service.settlementFor(other.id)).resolves.toEqual({
      debt: '0.00',
      unallocated: '0.00',
      lines: [],
      payouts: [],
    });
  });
});

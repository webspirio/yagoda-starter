import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { SupplierBalanceService } from './supplier-balance.service';

/**
 * THE THIRD TERM, against a real Postgres.
 *
 * The two void filters are tested SEPARATELY and on purpose. `t.voided_at IS
 * NULL` and `ti.voided_at IS NULL` are different filters guarding different
 * mistakes, and a fixture that exercises only one is blind to the other being
 * deleted.
 */
describe('debt with intake top-ups (Postgres)', () => {
  let ds: DataSource;
  let service: SupplierBalanceService;
  let run: string;
  let pointId: string;
  let userId: string;
  let shiftId: string;

  const supplier = async (last: string): Promise<string> => {
    const [row] = await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name, is_active)
       VALUES ($1, 'Іван', $2, true) RETURNING id`,
      [pointId, `${last}-${run}`],
    );
    return row.id;
  };

  const intake = async (supplierId: string, amount: string, voided = false): Promise<string> => {
    const [row] = await ds.query(
      `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id,
                            voided_at, voided_by_user_id, void_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        `B-IN-${randomUUID().slice(0, 8)}`,
        shiftId,
        supplierId,
        amount,
        userId,
        voided ? new Date() : null,
        voided ? userId : null,
        voided ? 'помилка' : null,
      ],
    );
    return row.id;
  };

  const payout = async (supplierId: string, amount: string): Promise<void> => {
    await ds.query(
      `INSERT INTO payouts (code, shift_id, supplier_id, amount, paid_by_user_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [`B-PO-${randomUUID().slice(0, 8)}`, shiftId, supplierId, amount, userId],
    );
  };

  const topUp = async (intakeId: string, amount: string, voided = false): Promise<void> => {
    await ds.query(
      `INSERT INTO intake_top_ups (intake_id, amount, reason, created_by_user_id,
                                   voided_at, voided_by_user_id, void_reason)
       VALUES ($1, $2, 'доплата за спеціальною ціною', $3, $4, $5, $6)`,
      [
        intakeId,
        amount,
        userId,
        voided ? new Date() : null,
        voided ? userId : null,
        voided ? 'помилка' : null,
      ],
    );
  };

  beforeAll(async () => {
    ds = await openTestDataSource();
    service = new SupplierBalanceService(ds);
    run = randomUUID().slice(0, 8);

    const [point] = await ds.query(
      `INSERT INTO collection_points (name, kind, code) VALUES ($1, 'reception', $2) RETURNING id`,
      [`Баланс ${run}`, `B${run.slice(0, 5).toUpperCase()}`],
    );
    pointId = point.id;
    const [user] = await ds.query(
      `INSERT INTO users (first_name, last_name, role)
       VALUES ('Власник', $1, 'network_owner') RETURNING id`,
      [`Баланс-${run}`],
    );
    userId = user.id;
    const [shift] = await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date)
       VALUES ($1, $2, '2026-09-08') RETURNING id`,
      [pointId, userId],
    );
    shiftId = shift.id;
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it('adds a live top-up to the debt', async () => {
    const s = await supplier('Доплата');
    const i = await intake(s, '100.00');
    await payout(s, '30.00');
    await topUp(i, '20.00');

    expect(await service.debtFor(s)).toBe('90.00');
  });

  it('ignores a VOIDED top-up', async () => {
    const s = await supplier('Сторнована');
    const i = await intake(s, '100.00');
    await topUp(i, '20.00', true);

    expect(await service.debtFor(s)).toBe('100.00');
  });

  it('ignores a live top-up whose PARENT INTAKE is voided', async () => {
    const s = await supplier('Мертвий');
    const i = await intake(s, '100.00', true);
    await topUp(i, '20.00');

    expect(await service.debtFor(s)).toBe('0.00');
  });

  it('sums several top-ups across several intakes', async () => {
    const s = await supplier('Багато');
    const a = await intake(s, '100.00');
    const b = await intake(s, '50.00');
    await topUp(a, '10.00');
    await topUp(a, '5.00');
    await topUp(b, '1.50');

    expect(await service.debtFor(s)).toBe('166.50');
  });

  it('reads 0.00, not "0", for a supplier with no documents at all', async () => {
    const s = await supplier('Порожній');
    expect(await service.debtFor(s)).toBe('0.00');
  });

  it('the list agrees with the single read, and orders by the three-term total', async () => {
    const big = await supplier('Великий');
    const small = await supplier('Малий');
    const bigIntake = await intake(big, '10.00');
    await topUp(bigIntake, '9000.00');
    await intake(small, '20.00');

    const page = await service.list(
      { sub: userId, role: 'network_owner', collection_point_id: null } as never,
      { collection_point_id: pointId, include_zero: false, page: 1, limit: 50 } as never,
    );

    const bigRow = page.data.find((r) => r.supplier_id === big);
    const smallRow = page.data.find((r) => r.supplier_id === small);
    expect(bigRow?.debt).toBe('9010.00');
    expect(bigRow?.debt).toBe(await service.debtFor(big));
    expect(page.data.indexOf(bigRow!)).toBeLessThan(page.data.indexOf(smallRow!));
  });

  it('a supplier whose three terms net to zero is hidden by include_zero=false', async () => {
    const s = await supplier('Нуль');
    const i = await intake(s, '100.00');
    await topUp(i, '20.00');
    await payout(s, '120.00');

    const page = await service.list(
      { sub: userId, role: 'network_owner', collection_point_id: null } as never,
      { collection_point_id: pointId, include_zero: false, page: 1, limit: 50 } as never,
    );
    expect(page.data.find((r) => r.supplier_id === s)).toBeUndefined();
  });
});

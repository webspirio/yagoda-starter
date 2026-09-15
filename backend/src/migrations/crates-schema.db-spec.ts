import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';

/**
 * UNVERIFIED AT WRITE TIME. This spec has never been run — Task 1 of the
 * crates slice was implemented with no dev database reachable (the only
 * Postgres container available on this machine at the time belonged to an
 * unrelated project on the same port; starting/reconfiguring containers was
 * out of scope for that session). The fixture SQL below was checked against
 * the real entity/migration source (`shifts`, `suppliers`, `collection_points`)
 * rather than against a live schema. It MUST be run — `npm run test:db -w
 * backend -- crates-schema` — and pass before this slice merges.
 */
describe('YagodaCrates schema', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = await openTestDataSource();
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  /** A shift + supplier + user to hang documents on. Returns their ids. */
  const fixture = async () => {
    const tag = randomUUID().slice(0, 8);
    const [point] = await ds.query(
      `INSERT INTO collection_points (name, code, kind) VALUES ($1, $2, 'reception') RETURNING id`,
      [`Точка ${tag}`, `T${tag.slice(0, 4).toUpperCase()}`],
    );
    const [user] = await ds.query(
      `SELECT id FROM users WHERE role = 'network_owner' LIMIT 1`,
    );
    const [shift] = await ds.query(
      `INSERT INTO shifts (collection_point_id, business_date, status, opened_by_user_id)
       VALUES ($1, CURRENT_DATE, 'open', $2) RETURNING id`,
      [point.id, user.id],
    );
    const [supplier] = await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name)
       VALUES ($1, 'Тест', $2) RETURNING id`,
      [point.id, tag],
    );
    return { pointId: point.id, userId: user.id, shiftId: shift.id, supplierId: supplier.id };
  };

  const insertIssuance = async (
    f: { shiftId: string; supplierId: string; userId: string },
    overrides: Record<string, unknown> = {},
  ) => {
    const row = {
      units: 20,
      mode: 'deposit',
      deposit_per_unit: '120.00',
      deposit_taken: '2400.00',
      code: `X-CD-20260915-${randomUUID().slice(0, 8)}`,
      ...overrides,
    };
    return ds.query(
      `INSERT INTO crate_issuances
         (shift_id, supplier_id, units, mode, deposit_per_unit, deposit_taken, code, issued_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        f.shiftId, f.supplierId, row.units, row.mode,
        row.deposit_per_unit, row.deposit_taken, row.code, f.userId,
      ],
    );
  };

  it('accepts a deposit issuance and a receipt issuance', async () => {
    const f = await fixture();
    await expect(insertIssuance(f)).resolves.toBeDefined();
    await expect(
      insertIssuance(f, {
        mode: 'receipt',
        deposit_per_unit: '0.00',
        deposit_taken: '0.00',
        code: `X-CR-20260915-${randomUUID().slice(0, 8)}`,
      }),
    ).resolves.toBeDefined();
  });

  it('refuses a receipt issuance that carries money', async () => {
    const f = await fixture();
    await expect(
      insertIssuance(f, { mode: 'receipt', deposit_per_unit: '120.00', deposit_taken: '2400.00' }),
    ).rejects.toThrow(/CHK_crate_issuances_receipt_no_money/);
  });

  it('refuses zero units', async () => {
    const f = await fixture();
    await expect(insertIssuance(f, { units: 0 })).rejects.toThrow(/CHK_crate_issuances_units/);
  });

  it('refuses a duplicate code', async () => {
    const f = await fixture();
    const code = `X-CD-20260915-${randomUUID().slice(0, 8)}`;
    await insertIssuance(f, { code });
    await expect(insertIssuance(f, { code })).rejects.toThrow(/UQ_crate_issuances_code/);
  });

  it('refuses a half-filled void trio', async () => {
    const f = await fixture();
    const [issuance] = await insertIssuance(f);
    await expect(
      ds.query(`UPDATE crate_issuances SET voided_at = now() WHERE id = $1`, [issuance.id]),
    ).rejects.toThrow(/CHK_crate_issuances_void_trio/);
  });

  it('refuses a second tare type flagged as the crate', async () => {
    const tag = randomUUID().slice(0, 8);
    await ds.query(`UPDATE tare_types SET is_crate = false`);
    await ds.query(
      `INSERT INTO tare_types (name, weight_kg, deposit_price, is_crate)
       VALUES ($1, '1.20', '120.00', true)`,
      [`Ящик ${tag}`],
    );
    await expect(
      ds.query(
        `INSERT INTO tare_types (name, weight_kg, deposit_price, is_crate)
         VALUES ($1, '2.00', '20.00', true)`,
        [`Чешка ${tag}`],
      ),
    ).rejects.toThrow(/UQ_tare_types_single_crate/);
  });

  it('cascades allocations when their return is deleted and restricts the issuance', async () => {
    const f = await fixture();
    const [issuance] = await insertIssuance(f);
    const [ret] = await ds.query(
      `INSERT INTO crate_returns (shift_id, supplier_id, units, deposit_refund, accepted_by_user_id)
       VALUES ($1, $2, 5, '600.00', $3) RETURNING id`,
      [f.shiftId, f.supplierId, f.userId],
    );
    await ds.query(
      `INSERT INTO crate_return_allocations (return_id, issuance_id, units, per_unit, amount)
       VALUES ($1, $2, 5, '120.00', '600.00')`,
      [ret.id, issuance.id],
    );

    await expect(
      ds.query(`DELETE FROM crate_issuances WHERE id = $1`, [issuance.id]),
    ).rejects.toThrow();

    await ds.query(`DELETE FROM crate_returns WHERE id = $1`, [ret.id]);
    const left = await ds.query(
      `SELECT count(*)::int AS n FROM crate_return_allocations WHERE return_id = $1`,
      [ret.id],
    );
    expect(left[0].n).toBe(0);
  });
});

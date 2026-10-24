import { randomUUID } from 'crypto';
import { DataSource, QueryRunner } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { IntakeBalanceAfter1788600000025 } from './1788600000025-IntakeBalanceAfter';

/** Audit 2026-10-24 A1 — `intakes.balance_after` and the rebuild of historic rows as of each. */
describe('intakes.balance_after (Postgres)', () => {
  let ds: DataSource;
  let pointId: string;
  let userId: string;
  let shiftId: string;
  const migration = new IntakeBalanceAfter1788600000025();
  const at = (minute: number) => `2026-03-01T10:${String(minute).padStart(2, '0')}:00Z`;

  const supplier = async () => {
    const [{ id }] = await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name, is_active)
       VALUES ($1, 'Іван', $2, true) RETURNING id`,
      [pointId, `Тест-${randomUUID().slice(0, 8)}`],
    );
    return id as string;
  };
  /** Inserted while the column is dropped — `down()` ran first, so no `balance_after` here. */
  const intake = async (
    q: QueryRunner,
    sup: string,
    amount: string,
    t: number,
    voidedAt?: number,
  ) =>
    (
      await q.query(
        `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id, created_at, voided_at, voided_by_user_id, void_reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $7::timestamptz IS NOT NULL THEN $5::uuid END,
                 CASE WHEN $7::timestamptz IS NOT NULL THEN 'test' END) RETURNING id`,
        [
          `IN-${randomUUID().slice(0, 12)}`,
          shiftId,
          sup,
          amount,
          userId,
          at(t),
          voidedAt ? at(voidedAt) : null,
        ],
      )
    )[0].id as string;
  const payout = async (
    q: QueryRunner,
    sup: string,
    amount: string,
    t: number,
    opts: { voidedAt?: number; intakeId?: string } = {},
  ) =>
    q.query(
      `INSERT INTO payouts (code, shift_id, supplier_id, amount, paid_by_user_id, created_at, intake_id, balance_after, voided_at, voided_by_user_id, void_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, '0.00', $8, CASE WHEN $8::timestamptz IS NOT NULL THEN $5::uuid END,
               CASE WHEN $8::timestamptz IS NOT NULL THEN 'test' END)`,
      [
        `PO-${randomUUID().slice(0, 12)}`,
        shiftId,
        sup,
        amount,
        userId,
        at(t),
        opts.intakeId ?? null,
        opts.voidedAt ? at(opts.voidedAt) : null,
      ],
    );
  const topUp = async (q: QueryRunner, intakeId: string, amount: string, t: number) =>
    q.query(
      `INSERT INTO intake_top_ups (intake_id, amount, reason, created_by_user_id, created_at)
       VALUES ($1, $2, 'дошукали', $3, $4)`,
      [intakeId, amount, userId, at(t)],
    );
  const balances = async (ids: string[]) =>
    Promise.all(
      ids.map(
        async (id) =>
          (await ds.query(`SELECT balance_after FROM intakes WHERE id = $1`, [id]))[0]
            .balance_after,
      ),
    );

  /** Replays the rebuild: `down()`, fixtures through `seed`, `up()`; the schema is always restored. */
  const replay = async (seed: (q: QueryRunner) => Promise<string[]>) => {
    const qr = ds.createQueryRunner();
    try {
      await migration.down(qr);
      let ids: string[] = [];
      try {
        ids = await seed(qr);
      } finally {
        await migration.up(qr);
      }
      return await balances(ids);
    } finally {
      await qr.release();
    }
  };

  beforeAll(async () => {
    ds = await openTestDataSource();
    const run = randomUUID().slice(0, 8);
    [{ id: pointId }] = await ds.query(
      `INSERT INTO collection_points (name, code, kind, is_active)
       VALUES ($1, $2, 'reception', true) RETURNING id`,
      [`Точка ${run}`, `I${run.slice(0, 6).toUpperCase()}`],
    );
    [{ id: userId }] = await ds.query(
      `INSERT INTO users (first_name, last_name, role, is_active, collection_point_id)
       VALUES ('Тест', $1, 'point_operator', true, $2) RETURNING id`,
      [`Op ${run}`, pointId],
    );
    [{ id: shiftId }] = await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date)
       VALUES ($1, $2, '2026-03-01') RETURNING id`,
      [pointId, userId],
    );
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('rebuilds the debt after each receipt: 1000 in, 400 out, 500 in, 300 out, 200 in', async () => {
    const got = await replay(async (q) => {
      const s = await supplier();
      const i1 = await intake(q, s, '1000.00', 0);
      await payout(q, s, '400.00', 1);
      const i2 = await intake(q, s, '500.00', 2);
      await payout(q, s, '300.00', 3);
      const i3 = await intake(q, s, '200.00', 4);
      return [i1, i2, i3];
    });
    expect(got).toEqual(['1000.00', '1100.00', '1000.00']);
  });

  it('subtracts the cash handed over WITH the receipt, even when that payout was voided later', async () => {
    const got = await replay(async (q) => {
      const s = await supplier();
      const i1 = await intake(q, s, '1000.00', 0);
      await payout(q, s, '600.00', 0, { intakeId: i1, voidedAt: 5 });
      const i2 = await intake(q, s, '100.00', 6);
      return [i1, i2];
    });
    // i1 printed «Виплачено 600 · Залишок 400»; by i2 that payout was voided, so 1000 + 100.
    expect(got).toEqual(['400.00', '1100.00']);
  });

  it('a later receipt’s payout never reaches an earlier receipt, even one sharing its created_at', async () => {
    let ids: string[] = [];
    const got = await replay(async (q) => {
      const s = await supplier();
      ids = [await intake(q, s, '1000.00', 0), await intake(q, s, '200.00', 0)];
      for (const id of ids) await payout(q, s, '100.00', 0, { intakeId: id });
      return ids;
    });
    // By id: the first counts itself and its payout (900); the second also counts the first (1000).
    const [first, second] = ids[0] < ids[1] ? [got[0], got[1]] : [got[1], got[0]];
    const firstOwn = ids[0] < ids[1] ? '1000.00' : '200.00';
    expect(first).toBe(firstOwn === '1000.00' ? '900.00' : '100.00');
    expect(second).toBe('1000.00');
  });

  it('counts a receipt that was live at the time and voided only later, and not one voided before', async () => {
    const got = await replay(async (q) => {
      const s = await supplier();
      const i1 = await intake(q, s, '1000.00', 0, 3);
      const i2 = await intake(q, s, '300.00', 2);
      const i3 = await intake(q, s, '50.00', 4);
      return [i1, i2, i3];
    });
    expect(got).toEqual(['1000.00', '1300.00', '350.00']);
  });

  it('adds a top-up made before the receipt, not one made after', async () => {
    const got = await replay(async (q) => {
      const s = await supplier();
      const i1 = await intake(q, s, '1000.00', 0);
      await topUp(q, i1, '50.00', 1);
      const i2 = await intake(q, s, '100.00', 2);
      await topUp(q, i1, '70.00', 3);
      return [i1, i2];
    });
    expect(got).toEqual(['1000.00', '1150.00']);
  });

  it('a standalone payout counts from its created_at on', async () => {
    const got = await replay(async (q) => {
      const s = await supplier();
      await intake(q, s, '1000.00', 0);
      await payout(q, s, '250.00', 1);
      await payout(q, s, '100.00', 3, { voidedAt: 4 });
      return [await intake(q, s, '10.00', 2), await intake(q, s, '10.00', 5)];
    });
    // At 2: 1000 − 250 + 10. At 5: the voided 100 is back, + 10 more.
    expect(got).toEqual(['760.00', '770.00']);
  });

  it('leaves the column NOT NULL after up(), and down() drops it', async () => {
    const col = () =>
      ds.query(
        `SELECT is_nullable FROM information_schema.columns
          WHERE table_name = 'intakes' AND column_name = 'balance_after'`,
      );
    expect(await col()).toEqual([{ is_nullable: 'NO' }]);
    const qr = ds.createQueryRunner();
    await qr.startTransaction(); // Postgres DDL is transactional: the rollback restores the schema
    try {
      await migration.down(qr);
      expect(
        await qr.query(
          `SELECT 1 FROM information_schema.columns
            WHERE table_name = 'intakes' AND column_name = 'balance_after'`,
        ),
      ).toEqual([]);
    } finally {
      await qr.rollbackTransaction();
      await qr.release();
    }
  });
});

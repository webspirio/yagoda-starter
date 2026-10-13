import { randomUUID } from 'crypto';
import { DataSource, QueryRunner } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { PayoutBalanceAfter1788600000023 } from './1788600000023-PayoutBalanceAfter';

/** #145 — `payouts.balance_after` and the rebuild of historic rows by `created_at`. */
describe('payouts.balance_after (Postgres)', () => {
  let ds: DataSource;
  let pointId: string;
  let userId: string;
  let shiftId: string;
  const migration = new PayoutBalanceAfter1788600000023();
  const at = (minute: number) => `2026-03-01T10:${String(minute).padStart(2, '0')}:00Z`;

  const supplier = async () => {
    const [{ id }] = await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name, is_active)
       VALUES ($1, 'Іван', $2, true) RETURNING id`,
      [pointId, `Тест-${randomUUID().slice(0, 8)}`],
    );
    return id as string;
  };
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
    voidedAt?: number,
  ) =>
    (
      await q.query(
        `INSERT INTO payouts (code, shift_id, supplier_id, amount, paid_by_user_id, created_at, voided_at, voided_by_user_id, void_reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $7::timestamptz IS NOT NULL THEN $5::uuid END,
                 CASE WHEN $7::timestamptz IS NOT NULL THEN 'test' END) RETURNING id`,
        [
          `PO-${randomUUID().slice(0, 12)}`,
          shiftId,
          sup,
          amount,
          userId,
          at(t),
          voidedAt ? at(voidedAt) : null,
        ],
      )
    )[0].id as string;
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
          (await ds.query(`SELECT balance_after FROM payouts WHERE id = $1`, [id]))[0]
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
      [`Точка ${run}`, `B${run.slice(0, 6).toUpperCase()}`],
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

  it('rebuilds the debt after each payout: 1000 in, 400 out, 500 in, 300 out', async () => {
    const got = await replay(async (q) => {
      const s = await supplier();
      await intake(q, s, '1000.00', 0);
      const p1 = await payout(q, s, '400.00', 1);
      await intake(q, s, '500.00', 2);
      const p2 = await payout(q, s, '300.00', 3);
      return [p1, p2];
    });
    expect(got).toEqual(['600.00', '800.00']);
  });

  it('counts an intake that was live at the payout and voided only later', async () => {
    const got = await replay(async (q) => {
      const s = await supplier();
      await intake(q, s, '1000.00', 0, 2);
      return [await payout(q, s, '1000.00', 1)];
    });
    expect(got).toEqual(['0.00']);
  });

  it('does not subtract a payout that was already voided when the next one was made', async () => {
    const got = await replay(async (q) => {
      const s = await supplier();
      await intake(q, s, '1000.00', 0);
      const p1 = await payout(q, s, '200.00', 1, 2);
      const p2 = await payout(q, s, '100.00', 3);
      return [p1, p2];
    });
    expect(got).toEqual(['800.00', '900.00']);
  });

  it('adds a top-up made before the payout, not one made after', async () => {
    const got = await replay(async (q) => {
      const s = await supplier();
      const i = await intake(q, s, '1000.00', 0);
      await topUp(q, i, '50.00', 1);
      const p1 = await payout(q, s, '100.00', 2);
      await topUp(q, i, '70.00', 3);
      return [p1];
    });
    expect(got).toEqual(['950.00']);
  });

  it('orders payouts sharing a created_at by id, so each subtracts only the earlier one', async () => {
    let ids: string[] = [];
    const got = await replay(async (q) => {
      const s = await supplier();
      await intake(q, s, '1000.00', 0);
      ids = [await payout(q, s, '100.00', 1), await payout(q, s, '200.00', 1)];
      return ids;
    });
    // Counting each other would print 700 twice; the id tiebreak gives one 900 (100 first) and one 700.
    const rows = ids.map((id, i) => ({ id, own: i === 0 ? '100.00' : '200.00', bal: got[i] }));
    rows.sort((a, b) => (a.id < b.id ? -1 : 1));
    const after = {
      '100.00': { first: '900.00', second: '700.00' },
      '200.00': { first: '800.00', second: '700.00' },
    };
    expect([rows[0].bal, rows[1].bal]).toEqual([
      after[rows[0].own as '100.00' | '200.00'].first,
      after[rows[0].own as '100.00' | '200.00'].second,
    ]);
  });

  it('leaves the column NOT NULL after up(), and down() drops it', async () => {
    const col = () =>
      ds.query(
        `SELECT is_nullable FROM information_schema.columns
          WHERE table_name = 'payouts' AND column_name = 'balance_after'`,
      );
    expect(await col()).toEqual([{ is_nullable: 'NO' }]);
    const qr = ds.createQueryRunner();
    await qr.startTransaction(); // Postgres DDL is transactional: the rollback restores the schema
    try {
      await migration.down(qr);
      expect(
        await qr.query(
          `SELECT 1 FROM information_schema.columns
            WHERE table_name = 'payouts' AND column_name = 'balance_after'`,
        ),
      ).toEqual([]);
    } finally {
      await qr.rollbackTransaction();
      await qr.release();
    }
  });
});

import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { PointCashService } from '../point-cash/point-cash.service';
import { verifyPassword } from '../users/password-hashing';
import { seedDev } from './dev-seed';
import {
  DEV_OPERATOR_PASSWORD,
  SEED_GRADES,
  SEED_INTAKES,
  SEED_POINTS,
  SEED_PRICE_CHANGES,
  SEED_SHIFTS,
} from './dev-seed.data';
import { HISTORY_SHIFTS } from './dev-seed.history';

/** Curated day and generated season, exactly as `seedDev` walks them. */
const ALL_SHIFTS = [...HISTORY_SHIFTS, ...SEED_SHIFTS];

/**
 * The seed against a real Postgres: it must be re-runnable, and the price
 * journal it writes must be readable the way the API reads it — «the newest
 * row for the pair». Unlike the schema specs, this one uses FIXED names on
 * purpose: idempotency is the property under test, and it can only be shown
 * by writing the same names twice.
 */
describe('dev seed', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = await openTestDataSource();
    await seedDev(ds);
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it('is idempotent — a second run inserts nothing', async () => {
    const second = await seedDev(ds);
    expect(second).toEqual({
      points: 0,
      products: 0,
      grades: 0,
      tareTypes: 0,
      users: 0,
      suppliers: 0,
      prices: 0,
      shifts: 0,
      intakes: 0,
      payouts: 0,
      topUps: 0,
      transfers: 0,
      cashCounts: 0,
    });
  });

  it('seeds the documents the API would have written: shifts on their dates, receipts in shifts, no negative balance', async () => {
    const [shifts] = await ds.query(
      `SELECT count(*) FILTER (WHERE status = 'open')::int AS open,
              count(*) FILTER (WHERE status = 'closed' AND closed_at IS NOT NULL AND closed_by_user_id IS NOT NULL)::int AS closed
         FROM shifts s JOIN collection_points cp ON cp.id = s.collection_point_id
        WHERE cp.name = ANY($1)`,
      [ALL_SHIFTS.map((s) => s.point)],
    );
    // Counted over BOTH halves: the generated season is all closed shifts, so
    // reading these against the curated array alone would under-count by 150.
    expect(shifts.open).toBe(ALL_SHIFTS.filter((s) => !s.closed).length);
    expect(shifts.closed).toBe(ALL_SHIFTS.filter((s) => s.closed).length);

    // Every seeded intake has its lines and tare rows, and the document
    // amount is the sum of its lines (§2.3 — the number printed on the paper).
    const rows: { code: string; amount: string; lines: string; tare_rows: number }[] =
      await ds.query(
        `SELECT i.code, i.amount::text AS amount, sum(it.amount)::text AS lines,
              count(tt.tare_type_id)::int AS tare_rows
         FROM intakes i
         JOIN intake_items it ON it.intake_id = i.id
         LEFT JOIN intake_item_tare_types tt ON tt.item_id = it.id
        WHERE split_part(i.code, '-', 1) IN ('SHP', 'KON', 'HAI')
        GROUP BY i.id`,
      );
    expect(rows.length).toBeGreaterThanOrEqual(SEED_INTAKES.length);
    for (const r of rows) {
      expect(r.amount).toBe(r.lines);
      expect(r.tare_rows).toBeGreaterThan(0);
    }

    // The payout ceiling holds for every seeded supplier: intakes − payouts ≥ 0.
    // Deliberately two terms, not three: this omits the `intake_top_ups` term
    // `debtSql` now adds, but the assertion below is only "no supplier is
    // negative", and top-ups are `CHECK (amount > 0)` — a term that can only
    // ever raise a debt can be dropped here without the assertion false-failing.
    const balances: { debt: string }[] = await ds.query(
      `SELECT (COALESCE((SELECT SUM(i.amount) FROM intakes i WHERE i.supplier_id = s.id AND i.voided_at IS NULL), 0)
             - COALESCE((SELECT SUM(p.amount) FROM payouts p WHERE p.supplier_id = s.id AND p.voided_at IS NULL), 0))::text AS debt
         FROM suppliers s JOIN collection_points cp ON cp.id = s.collection_point_id
        WHERE cp.code IN ('SHP', 'KON', 'HAI')`,
    );
    expect(balances.length).toBeGreaterThan(0);
    for (const b of balances) expect(b.debt.startsWith('-')).toBe(false);
  });

  it('prices every active grade at every working point, exactly once per pair as the base', async () => {
    const [row] = await ds.query(
      `SELECT count(*)::int AS n
         FROM grade_prices gp
         JOIN collection_points cp ON cp.id = gp.collection_point_id
         JOIN product_grades pg ON pg.id = gp.product_grade_id
        WHERE gp.reason IS NULL AND cp.is_active AND pg.is_active
          AND cp.name = ANY($1) AND pg.name = ANY($2)`,
      [SEED_POINTS.filter((p) => p.is_active).map((p) => p.name), SEED_GRADES.map((g) => g.name)],
    );
    const expected =
      SEED_POINTS.filter((p) => p.is_active).length * SEED_GRADES.filter((g) => g.is_active).length;
    expect(row.n).toBe(expected);
  });

  it('the intraday correction is the newest row for its pair, and the base survives beneath it', async () => {
    for (const c of SEED_PRICE_CHANGES) {
      const rows: { base_price: string; reason: string | null }[] = await ds.query(
        `SELECT gp.base_price, gp.reason
           FROM grade_prices gp
           JOIN collection_points cp ON cp.id = gp.collection_point_id
           JOIN product_grades pg ON pg.id = gp.product_grade_id
           JOIN products p ON p.id = pg.product_id
          WHERE cp.name = $1 AND p.name = $2 AND pg.name = $3
          ORDER BY gp.created_at DESC`,
        [c.point, c.product, c.grade],
      );
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({ base_price: c.base_price, reason: c.reason });
      expect(rows[1].reason).toBeNull();
    }
  });

  it('never buries a price someone set by hand — a lone hand-set row gets no seeded correction', async () => {
    // Simulate a developer who priced one correction pair by hand BEFORE the
    // seed ever ran: wipe the pair, insert one row that is not the seed's
    // base, re-seed, and expect that row to still be the newest.
    const c = SEED_PRICE_CHANGES[0];
    const [pair] = await ds.query(
      `SELECT cp.id AS point_id, pg.id AS grade_id
         FROM collection_points cp, product_grades pg
         JOIN products p ON p.id = pg.product_id
        WHERE cp.name = $1 AND p.name = $2 AND pg.name = $3`,
      [c.point, c.product, c.grade],
    );
    await ds.query(
      `DELETE FROM grade_prices WHERE collection_point_id = $1 AND product_grade_id = $2`,
      [pair.point_id, pair.grade_id],
    );
    const [owner] = await ds.query(
      `SELECT id FROM users WHERE role = 'network_owner' ORDER BY created_at LIMIT 1`,
    );
    await ds.query(
      `INSERT INTO grade_prices
         (collection_point_id, product_grade_id, base_price, max_markup, max_discount, created_by_user_id, reason)
       VALUES ($1, $2, '999.00', '30.00', '30.00', $3, 'set by hand')`,
      [pair.point_id, pair.grade_id, owner.id],
    );

    const run = await seedDev(ds);
    expect(run.prices).toBe(0);
    const rows: { base_price: string }[] = await ds.query(
      `SELECT base_price FROM grade_prices WHERE collection_point_id = $1 AND product_grade_id = $2`,
      [pair.point_id, pair.grade_id],
    );
    expect(rows).toEqual([{ base_price: '999.00' }]);

    // Restore the seed's own journal for the pair so the other cases stay true on re-run.
    await ds.query(
      `DELETE FROM grade_prices WHERE collection_point_id = $1 AND product_grade_id = $2`,
      [pair.point_id, pair.grade_id],
    );
    await seedDev(ds);
  });

  /**
   * THE DEMO DATASET HAS TO BE DEFENSIBLE MONEY, not just rows. After the cash
   * counts slice a point with no `cash_counts` reads `0.00` no matter how many
   * documents it has, so a seed that skipped them would hand slice 3 a screen
   * of zeros and hand `close` a shift with no anchor.
   *
   * The figures below are derived, not copied: the seed asks
   * `PointCashService` for every expectation it writes, so this test failing
   * means the seed and the formula have diverged — which is exactly what it is
   * for.
   */
  it('seeds a point cash figure the formula agrees with, anchored on a real count', async () => {
    const cash = new PointCashService(ds, { appTimezone: process.env.APP_TIMEZONE ?? 'Europe/Kyiv' });
    const idOf = async (name: string): Promise<string> => {
      const [row] = await ds.query(`SELECT id FROM collection_points WHERE name = $1`, [name]);
      return row.id as string;
    };

    // Шипинки: today opens on 9 910 (yesterday's closing count), takes a
    // 15 000 transfer and pays out 4 000.
    await expect(cash.cashFor(await idOf('Шипинки'))).resolves.toBe('20910.00');

    // Конищів: anchored at 3 000, plus a DISPUTED and unresolved transfer,
    // which contributes the point's own reported figure of 9 800 rather than
    // the 10 000 that left the base (client ruling 09.09.2026).
    await expect(cash.cashFor(await idOf('Конищів'))).resolves.toBe('12800.00');

    // Гайове: anchored at 2 500, minus 2 000 paid out. Its transfer is still
    // `sent` and moves nothing (§7.9).
    await expect(cash.cashFor(await idOf('Гайове'))).resolves.toBe('500.00');
  });

  it('seeds exactly one open incident, so the owner’s working list is not empty', async () => {
    const [row] = await ds.query(
      `SELECT (c.counted_amount - c.expected_amount)::text AS discrepancy, c.kind
         FROM cash_counts c
         JOIN shifts s ON s.id = c.shift_id
         JOIN collection_points cp ON cp.id = s.collection_point_id
        WHERE cp.name = 'Шипинки'
          AND c.counted_amount <> c.expected_amount
          AND c.kind <> 'midday'
          AND (s.explanation IS NULL OR s.explanation = '')`,
    );
    // 90 ₴ short at yesterday's close — the one seeded discrepancy, and what
    // makes `GET /cash-counts?only_discrepancies=true` return something on a
    // fresh database.
    expect(row).toBeDefined();
    expect(row.discrepancy).toBe('-90.00');
    expect(row.kind).toBe('closing');
  });

  it('the seeded dispute stores all three fields, so it has a real crates_discrepancy', async () => {
    // The bug this pins was in the INSERT, not in the dataset: the statement
    // listed `reported_cash` and neither `reported_crates` nor `dispute_note`,
    // so the row came back with `crates_discrepancy: null` and no note — a
    // shape `POST /transfers/:id/dispute` cannot produce, against this file's
    // contract that the demo stores what the API would have stored.
    const [row] = await ds.query(
      `SELECT t.reported_cash::text AS reported_cash, t.reported_crates, t.dispute_note, t.crates
         FROM transfers t
         JOIN collection_points cp ON cp.id = t.collection_point_id
        WHERE cp.name = 'Конищів' AND t.status = 'disputed'`,
    );
    expect(row).toBeDefined();
    expect(row.reported_cash).toBe('9800.00');
    expect(row.reported_crates).toBe(row.crates);
    expect(row.dispute_note?.trim()).toBeTruthy();
  });

  it('a seeded operator can sign in with the documented password and is pinned to their point', async () => {
    const [row] = await ds.query(
      `SELECT c.password_hash, u.role, cp.name AS point
         FROM user_identities i
         JOIN users u ON u.id = i.user_id
         JOIN user_credentials c ON c.user_id = u.id
         JOIN collection_points cp ON cp.id = u.collection_point_id
        WHERE i.provider = 'local' AND i.provider_user_id = 'oksana'`,
    );
    expect(row.role).toBe('point_operator');
    expect(row.point).toBe('Шипинки');
    await expect(verifyPassword(DEV_OPERATOR_PASSWORD, row.password_hash)).resolves.toBe(true);
  });
});

import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { verifyPassword } from '../users/password-hashing';
import { seedDev } from './dev-seed';
import {
  DEV_OPERATOR_PASSWORD,
  SEED_GRADES,
  SEED_POINTS,
  SEED_PRICE_CHANGES,
} from './dev-seed.data';

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
    });
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

import { DataSource, QueryRunner } from 'typeorm';
import { hashPassword } from '../users/password-hashing';
import {
  DEV_OPERATOR_PASSWORD,
  SEED_GRADES,
  SEED_OPERATORS,
  SEED_POINTS,
  SEED_PRICE_CHANGES,
  SEED_PRICE_LIMITS,
  SEED_PRODUCTS,
  SEED_SUPPLIERS,
  SEED_TARE_TYPES,
} from './dev-seed.data';

/** Rows INSERTED by one run — every key is 0 on a repeat run. */
export interface DevSeedSummary {
  points: number;
  products: number;
  grades: number;
  tareTypes: number;
  users: number;
  suppliers: number;
  prices: number;
}

const MONEY = /^(-)?(\d+)(?:\.(\d{1,2}))?$/;

/**
 * Adds two decimal strings without a float: both are turned into integer
 * cents, summed, and rendered back at scale 2 — the scale Postgres holds
 * `numeric(10,2)` at, so what is written is byte-equal to what `/current`
 * echoes back. Throws on anything that is not a plain decimal.
 */
export function addMoney(a: string, b: string): string {
  const total = toCents(a) + toCents(b);
  const sign = total < 0 ? '-' : '';
  const abs = Math.abs(total);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

function toCents(value: string): number {
  const m = MONEY.exec(value);
  if (!m) throw new Error(`Not a decimal string: "${value}"`);
  const [, sign, whole, frac = ''] = m;
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return sign ? -cents : cents;
}

/**
 * Seeds the demo dataset for manual testing. IDEMPOTENT: every row is looked
 * up by its natural key first (a point by `lower(name)`, a grade by
 * `(product, lower(name))`, a user by its login identity, a supplier by
 * `(point, names)`, a price by `(point, grade)`) and only inserted when
 * missing. Existing rows are NEVER modified — a developer's hand edits
 * survive a re-run, and re-running restores only what was deleted.
 *
 * One transaction: a failure part-way leaves the database exactly as it was.
 *
 * The price journal's rows carry explicit `created_at` values — a base price
 * «this morning», a correction «an hour ago» — because `now()` is the
 * transaction start for every statement in the transaction, and two rows with
 * one timestamp would make «the newest row wins» a coin toss.
 *
 * Not guarded on NODE_ENV here — the CLI entry does that — so the DB spec
 * can exercise it under Jest.
 */
export async function seedDev(ds: DataSource): Promise<DevSeedSummary> {
  const qr = ds.createQueryRunner();
  await qr.connect();
  await qr.startTransaction();
  try {
    const summary: DevSeedSummary = {
      points: 0,
      products: 0,
      grades: 0,
      tareTypes: 0,
      users: 0,
      suppliers: 0,
      prices: 0,
    };

    const ownerId = await resolveOwner(qr, summary);

    const pointId = new Map<string, string>();
    for (const p of SEED_POINTS) {
      const found = await one<{ id: string }>(
        qr,
        `SELECT id FROM collection_points WHERE lower(name) = lower($1)`,
        [p.name],
      );
      if (found) {
        pointId.set(p.name, found.id);
        continue;
      }
      const row = await one<{ id: string }>(
        qr,
        `INSERT INTO collection_points (name, kind, target_cash, target_crates, is_active)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [p.name, p.kind, p.target_cash, p.target_crates, p.is_active],
      );
      pointId.set(p.name, row!.id);
      summary.points += 1;
    }

    const productId = new Map<string, string>();
    for (const name of SEED_PRODUCTS) {
      const found = await one<{ id: string }>(
        qr,
        `SELECT id FROM products WHERE lower(name) = lower($1)`,
        [name],
      );
      if (found) {
        productId.set(name, found.id);
        continue;
      }
      const row = await one<{ id: string }>(
        qr,
        `INSERT INTO products (name) VALUES ($1) RETURNING id`,
        [name],
      );
      productId.set(name, row!.id);
      summary.products += 1;
    }

    const gradeId = new Map<string, string>();
    const gradeKey = (product: string, grade: string) => `${product} ${grade}`;
    for (const g of SEED_GRADES) {
      const pid = productId.get(g.product)!;
      const found = await one<{ id: string }>(
        qr,
        `SELECT id FROM product_grades WHERE product_id = $1 AND lower(name) = lower($2)`,
        [pid, g.name],
      );
      if (found) {
        gradeId.set(gradeKey(g.product, g.name), found.id);
        continue;
      }
      const row = await one<{ id: string }>(
        qr,
        `INSERT INTO product_grades (product_id, name, is_active) VALUES ($1, $2, $3) RETURNING id`,
        [pid, g.name, g.is_active],
      );
      gradeId.set(gradeKey(g.product, g.name), row!.id);
      summary.grades += 1;
    }

    for (const t of SEED_TARE_TYPES) {
      const found = await one<{ id: string }>(
        qr,
        `SELECT id FROM tare_types WHERE lower(name) = lower($1)`,
        [t.name],
      );
      if (found) continue;
      await qr.query(
        `INSERT INTO tare_types (name, weight_kg, deposit_price, is_crate) VALUES ($1, $2, $3, $4)`,
        [t.name, t.weight_kg, t.deposit_price, t.is_crate],
      );
      summary.tareTypes += 1;
    }

    for (const u of SEED_OPERATORS) {
      const found = await one<{ user_id: string }>(
        qr,
        `SELECT user_id FROM user_identities WHERE provider = 'local' AND provider_user_id = $1`,
        [u.login],
      );
      if (found) continue;
      const row = await one<{ id: string }>(
        qr,
        `INSERT INTO users (first_name, last_name, role, collection_point_id, is_active)
         VALUES ($1, $2, 'point_operator', $3, $4) RETURNING id`,
        [u.first_name, u.last_name, pointId.get(u.point)!, u.is_active],
      );
      await qr.query(
        `INSERT INTO user_identities (provider, provider_user_id, user_id) VALUES ('local', $1, $2)`,
        [u.login, row!.id],
      );
      await qr.query(`INSERT INTO user_credentials (user_id, password_hash) VALUES ($1, $2)`, [
        row!.id,
        await hashPassword(DEV_OPERATOR_PASSWORD),
      ]);
      summary.users += 1;
    }

    for (const s of SEED_SUPPLIERS) {
      const pid = pointId.get(s.point)!;
      const found = await one<{ id: string }>(
        qr,
        `SELECT id FROM suppliers
          WHERE collection_point_id = $1 AND lower(first_name) = lower($2) AND lower(last_name) = lower($3)`,
        [pid, s.first_name, s.last_name],
      );
      if (found) continue;
      await qr.query(
        `INSERT INTO suppliers (collection_point_id, first_name, last_name, phone, kind, note, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [pid, s.first_name, s.last_name, s.phone, s.kind, s.note, s.is_active],
      );
      summary.suppliers += 1;
    }

    // Base prices: every active grade at every working point, «this morning».
    for (const p of SEED_POINTS.filter((p) => p.is_active)) {
      for (const g of SEED_GRADES.filter((g) => g.is_active)) {
        const gid = gradeId.get(gradeKey(g.product, g.name))!;
        const pid = pointId.get(p.name)!;
        const existing = await one<{ n: number }>(
          qr,
          `SELECT count(*)::int AS n FROM grade_prices WHERE collection_point_id = $1 AND product_grade_id = $2`,
          [pid, gid],
        );
        if (existing!.n > 0) continue;
        await qr.query(
          `INSERT INTO grade_prices
             (collection_point_id, product_grade_id, base_price, max_markup, max_discount, created_by_user_id, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, now() - interval '3 hours')`,
          [
            pid,
            gid,
            addMoney(g.base_price, p.price_offset),
            SEED_PRICE_LIMITS.max_markup,
            SEED_PRICE_LIMITS.max_discount,
            ownerId,
          ],
        );
        summary.prices += 1;
      }
    }

    // Intraday corrections — appended only while the pair holds the seed's
    // single base row, so a price someone set by hand is never buried.
    for (const [i, c] of SEED_PRICE_CHANGES.entries()) {
      const pid = pointId.get(c.point)!;
      const gid = gradeId.get(gradeKey(c.product, c.grade))!;
      const existing = await one<{ n: number }>(
        qr,
        `SELECT count(*)::int AS n FROM grade_prices WHERE collection_point_id = $1 AND product_grade_id = $2`,
        [pid, gid],
      );
      if (existing!.n !== 1) continue;
      await qr.query(
        `INSERT INTO grade_prices
           (collection_point_id, product_grade_id, base_price, max_markup, max_discount, created_by_user_id, reason, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now() - interval '1 hour' + $8::int * interval '7 minutes')`,
        [
          pid,
          gid,
          c.base_price,
          SEED_PRICE_LIMITS.max_markup,
          SEED_PRICE_LIMITS.max_discount,
          ownerId,
          c.reason,
          i,
        ],
      );
      summary.prices += 1;
    }

    await qr.commitTransaction();
    return summary;
  } catch (error) {
    await qr.rollbackTransaction();
    throw error;
  } finally {
    await qr.release();
  }
}

/**
 * The author of every seeded price: the dev `admin` when present (SeedDevAdmin
 * runs on every non-production database), else the oldest active owner (a
 * database bootstrapped by BootstrapOwner), else a fresh `admin`/`admin` — so
 * the seed is usable on a database that has had its users truncated.
 */
async function resolveOwner(qr: QueryRunner, summary: DevSeedSummary): Promise<string> {
  const admin = await one<{ user_id: string }>(
    qr,
    `SELECT i.user_id FROM user_identities i
       JOIN users u ON u.id = i.user_id
      WHERE i.provider = 'local' AND i.provider_user_id = 'admin' AND u.role = 'network_owner'`,
  );
  if (admin) return admin.user_id;

  const owner = await one<{ id: string }>(
    qr,
    `SELECT id FROM users WHERE role = 'network_owner' AND is_active ORDER BY created_at LIMIT 1`,
  );
  if (owner) return owner.id;

  const created = await one<{ id: string }>(
    qr,
    `INSERT INTO users (first_name, last_name, role, is_active)
     VALUES ('Dev', 'Admin', 'network_owner', true) RETURNING id`,
  );
  await qr.query(
    `INSERT INTO user_identities (provider, provider_user_id, user_id) VALUES ('local', 'admin', $1)`,
    [created!.id],
  );
  await qr.query(`INSERT INTO user_credentials (user_id, password_hash) VALUES ($1, $2)`, [
    created!.id,
    await hashPassword('admin'),
  ]);
  summary.users += 1;
  return created!.id;
}

async function one<T>(qr: QueryRunner, sql: string, params: unknown[] = []): Promise<T | null> {
  const rows: T[] = await qr.query(sql, params);
  return rows[0] ?? null;
}

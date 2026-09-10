import { DataSource, QueryRunner } from 'typeorm';
import { hashPassword } from '../users/password-hashing';
import { PointCashService } from '../point-cash/point-cash.service';
import { composeDocumentCode } from '../common/document-code';
import {
  buildIntake,
  type IntakeLineInput,
  type PriceSnapshot,
  type TareSnapshot,
} from '../intakes/intake-lines';
import {
  DEV_OPERATOR_PASSWORD,
  SEED_GRADES,
  SEED_INTAKES,
  SEED_OPERATORS,
  SEED_PAYOUTS,
  SEED_POINTS,
  SEED_PRICE_CHANGES,
  SEED_PRICE_LIMITS,
  SEED_PRODUCTS,
  SEED_CASH_COUNTS,
  SEED_SHIFTS,
  SEED_SUPPLIERS,
  SEED_TARE_TYPES,
  SEED_TRANSFERS,
  type SeedDay,
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
  shifts: number;
  intakes: number;
  payouts: number;
  transfers: number;
  cashCounts: number;
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
      shifts: 0,
      intakes: 0,
      payouts: 0,
      transfers: 0,
      cashCounts: 0,
    };

    const ownerId = await resolveOwner(qr, summary);

    const pointId = new Map<string, string>();
    for (const p of SEED_POINTS) {
      const found = await one<{ id: string; code: string }>(
        qr,
        `SELECT id, code FROM collection_points WHERE lower(name) = lower($1)`,
        [p.name],
      );
      if (found) {
        pointId.set(p.name, found.id);
        // The ONE exception to «existing rows are never modified»: the
        // YagodaIntakesAndPayouts migration backfills `code` with a placeholder
        // (`P01`, `P02`, …) on databases seeded before the column existed. A
        // placeholder is not a hand edit, so it is replaced by the seed's code;
        // any other value is somebody's choice and stays.
        if (/^P\d{2,}$/.test(found.code) && found.code !== p.code) {
          await qr.query(`UPDATE collection_points SET code = $1 WHERE id = $2`, [
            p.code,
            found.id,
          ]);
        }
        continue;
      }
      const row = await one<{ id: string }>(
        qr,
        `INSERT INTO collection_points (name, code, kind, target_cash, target_crates, is_active)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [p.name, p.code, p.kind, p.target_cash, p.target_crates, p.is_active],
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
      // The schema's own key is (point, phone) — UQ_suppliers_point_phone — so a
      // phoned supplier is looked up by it (a renamed row must not collide on
      // re-run); the phoneless ones fall back to the names.
      const found = s.phone
        ? await one<{ id: string }>(
            qr,
            `SELECT id FROM suppliers WHERE collection_point_id = $1 AND phone = $2`,
            [pid, s.phone],
          )
        : await one<{ id: string }>(
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

    // Intraday corrections — appended only while the pair holds exactly ONE
    // row and that row is recognisably the seed's own base (no reason, authored
    // by the owner, at the seed's base price). A single row someone set by hand
    // before the first run fails that test, so it is never buried.
    for (const [i, c] of SEED_PRICE_CHANGES.entries()) {
      const point = SEED_POINTS.find((p) => p.name === c.point)!;
      const grade = SEED_GRADES.find((g) => g.product === c.product && g.name === c.grade)!;
      const pid = pointId.get(c.point)!;
      const gid = gradeId.get(gradeKey(c.product, c.grade))!;
      const existing = await one<{ n: number; seed: number }>(
        qr,
        `SELECT count(*)::int AS n,
                count(*) FILTER (WHERE reason IS NULL AND created_by_user_id = $3 AND base_price = $4)::int AS seed
           FROM grade_prices WHERE collection_point_id = $1 AND product_grade_id = $2`,
        [pid, gid, ownerId, addMoney(grade.base_price, point.price_offset)],
      );
      if (existing!.n !== 1 || existing!.seed !== 1) continue;
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

    await seedDocuments(qr, summary, pointId, gradeId, gradeKey, ds, ownerId);

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
 * Shifts, intakes, payouts, transfers and the cash counts that anchor them.
 * Every intake's numbers come from the server's
 * own `buildIntake()` over the price and tare snapshots the seed itself wrote,
 * and every document code from `composeDocumentCode()` — the demo stores what
 * the API would have stored. Idempotent by the schema's own keys: a shift by
 * `(point, business_date)`, a document by its UNIQUE `code`.
 *
 * `business_date` is «today» in APP_TIMEZONE, so the open shifts are really
 * open when the seed runs; timestamps are local wall-clock times on that date.
 */
async function seedDocuments(
  qr: QueryRunner,
  summary: DevSeedSummary,
  pointId: Map<string, string>,
  gradeId: Map<string, string>,
  gradeKey: (product: string, grade: string) => string,
  ds: DataSource,
  ownerId: string,
): Promise<void> {
  const tz = process.env.APP_TIMEZONE ?? 'Europe/Kyiv';
  const days = await one<{ today: string; yesterday: string }>(
    qr,
    `SELECT (now() AT TIME ZONE $1)::date::text AS today,
            ((now() AT TIME ZONE $1)::date - 1)::text AS yesterday`,
    [tz],
  );
  const dateOf = (day: SeedDay) => (day === 'today' ? days!.today : days!.yesterday);
  // A local wall-clock instant on a business date, as timestamptz — the
  // placeholders are named by index so a fragment can sit anywhere in a VALUES.
  const localTs = (dateIdx: number, timeIdx: number, tzIdx: number) =>
    `($${dateIdx}::date + $${timeIdx}::time) AT TIME ZONE $${tzIdx}`;

  const userByLogin = new Map<string, string>();
  for (const login of new Set(SEED_OPERATORS.map((u) => u.login))) {
    const row = await one<{ user_id: string }>(
      qr,
      `SELECT user_id FROM user_identities WHERE provider = 'local' AND provider_user_id = $1`,
      [login],
    );
    if (row) userByLogin.set(login, row.user_id);
  }
  const pointCode = new Map(SEED_POINTS.map((p) => [p.name, p.code]));

  const supplierId = new Map<string, string>();
  const supplierFor = async (point: string, fullName: string): Promise<string> => {
    const key = `${point}/${fullName}`;
    const cached = supplierId.get(key);
    if (cached) return cached;
    const [first, ...rest] = fullName.split(' ');
    const row = await one<{ id: string }>(
      qr,
      `SELECT id FROM suppliers
        WHERE collection_point_id = $1 AND lower(first_name) = lower($2) AND lower(last_name) = lower($3)`,
      [pointId.get(point)!, first, rest.join(' ')],
    );
    if (!row) throw new Error(`Seed supplier not found: ${key}`);
    supplierId.set(key, row.id);
    return row.id;
  };

  const tareByName = new Map<string, TareSnapshot>();
  for (const t of SEED_TARE_TYPES) {
    const row = await one<{ id: string; weight_kg: string }>(
      qr,
      `SELECT id, weight_kg::text AS weight_kg FROM tare_types WHERE lower(name) = lower($1)`,
      [t.name],
    );
    if (row) tareByName.set(t.name, { id: row.id, weight_kg: row.weight_kg });
  }
  const tareById = new Map([...tareByName.values()].map((t) => [t.id, t]));

  const priceFor = async (point: string, grade: string): Promise<PriceSnapshot> => {
    const row = await one<PriceSnapshot>(
      qr,
      `SELECT base_price::text AS base_price, max_markup::text AS max_markup, max_discount::text AS max_discount
         FROM grade_prices WHERE collection_point_id = $1 AND product_grade_id = $2
        ORDER BY created_at DESC, id DESC LIMIT 1`,
      [pointId.get(point)!, grade],
    );
    if (!row) throw new Error(`Seed price not found for ${point} / ${grade}`);
    return row;
  };

  const shiftId = new Map<string, string>();
  for (const sh of SEED_SHIFTS) {
    const pid = pointId.get(sh.point)!;
    const date = dateOf(sh.day);
    const key = `${sh.point}/${sh.day}`;
    const found = await one<{ id: string }>(
      qr,
      `SELECT id FROM shifts WHERE collection_point_id = $1 AND business_date = $2`,
      [pid, date],
    );
    if (found) {
      shiftId.set(key, found.id);
      continue;
    }
    const opener = userByLogin.get(sh.openedBy)!;
    const row = await one<{ id: string }>(
      qr,
      `INSERT INTO shifts
         (collection_point_id, opened_by_user_id, business_date, status, closed_at, closed_by_user_id, created_at)
       VALUES ($1, $2, $3::date, $4::shift_status,
               CASE WHEN $5::boolean THEN ${localTs(3, 6, 8)} ELSE NULL END,
               CASE WHEN $5::boolean THEN $2::uuid ELSE NULL END,
               ${localTs(3, 7, 8)})
       RETURNING id`,
      [pid, opener, date, sh.closed ? 'closed' : 'open', sh.closed, '19:10', '07:30', tz],
    );
    shiftId.set(key, row!.id);
    summary.shifts += 1;
  }

  for (const doc of SEED_INTAKES) {
    const code = composeDocumentCode(pointCode.get(doc.point)!, 'IN', dateOf(doc.day), doc.typed);
    const found = await one<{ id: string }>(qr, `SELECT id FROM intakes WHERE code = $1`, [code]);
    if (found) continue;
    const shift = shiftId.get(`${doc.point}/${doc.day}`);
    if (!shift) throw new Error(`Seed intake ${code} has no shift`);

    const prices = new Map<string, PriceSnapshot>();
    const inputs: IntakeLineInput[] = [];
    for (const line of doc.lines) {
      const gid = gradeId.get(gradeKey(line.product, line.grade))!;
      prices.set(gid, await priceFor(doc.point, gid));
      inputs.push({
        product_grade_id: gid,
        gross_kg: line.gross_kg,
        pallet_kg: line.pallet_kg,
        bonus: line.bonus,
        tare: line.tare.map((t) => ({ tare_type_id: tareByName.get(t.type)!.id, units: t.units })),
      });
    }
    const built = buildIntake(inputs, prices, tareById);
    const intake = await one<{ id: string }>(
      qr,
      `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id, created_at)
       VALUES ($1, $2, $3, $4, $5, ${localTs(6, 7, 8)})
       RETURNING id`,
      [
        code,
        shift,
        await supplierFor(doc.point, doc.supplier),
        built.amount,
        userByLogin.get(doc.receivedBy)!,
        dateOf(doc.day),
        doc.time,
        tz,
      ],
    );
    for (const item of built.items) {
      const saved = await one<{ id: string }>(
        qr,
        `INSERT INTO intake_items
           (intake_id, item_order, product_grade_id, gross_kg, pallet_kg, tare_weight_kg, net_kg, price, bonus, amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [
          intake!.id,
          item.item_order,
          item.product_grade_id,
          item.gross_kg,
          item.pallet_kg,
          item.tare_weight_kg,
          item.net_kg,
          item.price,
          item.bonus,
          item.amount,
        ],
      );
      for (const t of item.tare) {
        await qr.query(
          `INSERT INTO intake_item_tare_types (item_id, tare_type_id, units) VALUES ($1, $2, $3)`,
          [saved!.id, t.tare_type_id, t.units],
        );
      }
    }
    summary.intakes += 1;
  }

  for (const doc of SEED_PAYOUTS) {
    const code = composeDocumentCode(pointCode.get(doc.point)!, 'PO', dateOf(doc.day), doc.typed);
    const found = await one<{ id: string }>(qr, `SELECT id FROM payouts WHERE code = $1`, [code]);
    if (found) continue;
    const shift = shiftId.get(`${doc.point}/${doc.day}`);
    if (!shift) throw new Error(`Seed payout ${code} has no shift`);
    await qr.query(
      `INSERT INTO payouts (code, shift_id, supplier_id, amount, paid_by_user_id, created_at)
       VALUES ($1, $2, $3, $4, $5, ${localTs(6, 7, 8)})`,
      [
        code,
        shift,
        await supplierFor(doc.point, doc.supplier),
        doc.amount,
        userByLogin.get(doc.paidBy)!,
        dateOf(doc.day),
        doc.time,
        tz,
      ],
    );
    summary.payouts += 1;
  }

  // TRANSFERS BEFORE COUNTS, and both after the payouts above: a closing
  // count's expectation is «the opening count plus this shift's movements»,
  // and the transfers are half of those movements.
  for (const t of SEED_TRANSFERS) {
    const pid = pointId.get(t.point)!;
    const date = dateOf(t.day);
    // `transfers` has no `code` — (point, sent_at) is the natural key here.
    const found = await one<{ id: string }>(
      qr,
      `SELECT id FROM transfers
        WHERE collection_point_id = $1 AND sent_at = ${localTs(2, 3, 4)}`,
      [pid, date, t.sentAt, tz],
    );
    if (found) continue;
    const accepted = t.status !== 'sent';
    await qr.query(
      `INSERT INTO transfers
         (collection_point_id, cash, crates, carrier, sent_by_user_id, sent_at, status,
          accepted_by_user_id, accepted_date, accepted_at, reported_cash)
       VALUES ($1, $2, $3, $4, $5, ${localTs(6, 7, 12)}, $8::transfer_status,
               $9, CASE WHEN $9::uuid IS NULL THEN NULL ELSE $6::date END,
               CASE WHEN $9::uuid IS NULL THEN NULL ELSE ${localTs(6, 10, 12)} END,
               $11)`,
      [
        pid,
        t.cash,
        t.crates,
        t.carrier,
        ownerId,
        date,
        t.sentAt,
        t.status,
        accepted ? userByLogin.get(t.acceptedBy!)! : null,
        t.acceptedAt ?? t.sentAt,
        t.reportedCash ?? null,
        tz,
      ],
    );
    summary.transfers += 1;
  }

  // THE EXPECTATION IS NEVER COMPUTED HERE. `PointCashService` owns the cash
  // formula and this reuses it through the seed's own transaction, so the demo
  // dataset cannot drift from the rule the API enforces — and a seed run is
  // itself a check that the formula still parses against a real schema.
  //
  // ORDER IS LOAD-BEARING: `SEED_CASH_COUNTS` is chronological, because each
  // opening count reads the previous count as its expectation.
  const cash = new PointCashService(ds, { appTimezone: tz });
  for (const c of SEED_CASH_COUNTS) {
    const shift = shiftId.get(`${c.point}/${c.day}`);
    if (!shift) throw new Error(`Seed cash count has no shift: ${c.point}/${c.day}`);
    const found = await one<{ id: string }>(
      qr,
      `SELECT id FROM cash_counts WHERE shift_id = $1 AND book = 'berry' AND kind = $2::cash_count_kind`,
      [shift, c.kind],
    );
    if (found) continue;

    const pid = pointId.get(c.point)!;
    const expected =
      c.anchor ??
      (c.kind === 'opening'
        ? await cash.expectedForOpening(pid, qr.manager)
        : await cash.expectedForClosing(shift, qr.manager));
    if (expected === null) {
      throw new Error(
        `Seed cash count ${c.point}/${c.day}/${c.kind} has no previous count — it needs an \`anchor\``,
      );
    }
    // An anchoring count IS its own expectation: `drift` is '0.00' by the
    // type's contract, so this stays `expected` either way.
    const counted = addMoney(expected, c.drift);

    await qr.query(
      `INSERT INTO cash_counts
         (shift_id, book, kind, counted_amount, expected_amount, counted_by_user_id, counted_at)
       VALUES ($1, 'berry', $2::cash_count_kind, $3, $4, $5, ${localTs(6, 7, 8)})`,
      [
        shift,
        c.kind,
        counted,
        expected,
        userByLogin.get(c.countedBy)!,
        dateOf(c.day),
        c.time,
        tz,
      ],
    );
    summary.cashCounts += 1;
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
      WHERE i.provider = 'local' AND i.provider_user_id = 'admin'
        AND u.role = 'network_owner' AND u.is_active`,
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

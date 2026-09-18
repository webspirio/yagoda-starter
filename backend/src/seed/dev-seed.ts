import { DataSource, QueryRunner } from 'typeorm';
import { hashPassword } from '../users/password-hashing';
import { encryptSecret, readVaultKey } from '../users/secret-box';
import { PointCashService } from '../point-cash/point-cash.service';
import { composeDocumentCode, padSequence } from '../common/document-code';
import { mul } from '../common/money';
import {
  buildIntake,
  type IntakeLineInput,
  type PriceSnapshot,
  type TareSnapshot,
} from '../intakes/intake-lines';
import { CrateIssuance } from '../crates/crate-issuance.entity';
import { CrateReturn } from '../crates/crate-return.entity';
import { CrateReturnAllocation } from '../crates/crate-return-allocation.entity';
import { CrateBalanceService } from '../crates/crate-balance.service';
import { allocate } from '../crates/crate-allocation';
import { nextIssuanceCode } from '../crates/crate-code';
import { CrateIssuanceMode } from '../crates/crate-issuance-mode.enum';
import {

  DEV_OPERATOR_PASSWORD,
  SEED_GRADES,
  SEED_INTAKES,
  SEED_CRATE_ISSUANCES,
  SEED_CRATE_RETURNS,
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
  SEED_TOP_UPS,
  SEED_TRANSFERS,
  daysBack,
  type SeedDay,
} from './dev-seed.data';
import {
  HISTORY_CASH_COUNTS,
  HISTORY_INTAKES,
  HISTORY_PAYOUTS,
  HISTORY_SHIFTS,
  HISTORY_TRANSFERS,
} from './dev-seed.history';

/**
 * The demo dataset writes the owner-readable copy of each password too,
 * whenever `PASSWORD_VAULT_KEY` is set — without it every seeded account shows
 * «перевидайте пароль» on the «Користувачі» screen and the feature looks
 * broken on a fresh database. Null when no key is configured, which is exactly
 * what `CredentialsService.set` would write.
 *
 * READ PER RUN, NOT AT MODULE LOAD. `dotenv` runs when `dev-seed.cli.ts`
 * imports `../data-source`, so a module-level read would depend on this file
 * being imported after that one — which an import reorder, or a lint rule that
 * sorts imports, would quietly break. The symptom would be seeded accounts
 * with no readable copy and nothing in the output to say why.
 *
 * The user id is the AAD, matching `CredentialsService.set` exactly: a sealed
 * value belongs to one row and does not open against another.
 */
const vaultCopyFor = (): ((userId: string, password: string) => string | null) => {
  const key = readVaultKey(process.env.PASSWORD_VAULT_KEY);
  return (userId, password) => (key ? encryptSecret(password, key, userId) : null);
};

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
  topUps: number;
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
  const vaultCopy = vaultCopyFor();
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
      topUps: 0,
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
      // `UQ_tare_types_single_crate` is a bare (non-deferrable) unique index —
      // Postgres checks it at the end of THIS statement, not at commit — so
      // inserting a flagged row while another is still flagged would 23505.
      // Demote first, same as `TareTypesService.create`, and only on the
      // insert path: a row that already exists (the `continue` above) is
      // never touched, flagged or not.
      if (t.is_crate) {
        await qr.query(`UPDATE tare_types SET is_crate = false WHERE is_crate`);
      }
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
      await qr.query(
        `INSERT INTO user_credentials (user_id, password_hash, password_enc) VALUES ($1, $2, $3)`,
        [
          row!.id,
          await hashPassword(DEV_OPERATOR_PASSWORD),
          vaultCopy(row!.id, DEV_OPERATOR_PASSWORD),
        ],
      );
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
 * `YYYY-MM-DD`, `n` days before `iso`. UTC arithmetic on a date-only value, so
 * no local timezone and no DST boundary inside the seeded window can move a
 * business date by a day — which would change a document code, which is the
 * natural key the seed's idempotency rests on.
 */
export function isoDaysBefore(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Shifts, intakes, payouts, transfers and the cash counts that anchor them.
 * Every intake's numbers come from the server's
 * own `buildIntake()` over the price and tare snapshots the seed itself wrote,
 * and every document code numbered as the server numbers one — the demo stores what
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
  const days = await one<{ today: string }>(
    qr,
    `SELECT (now() AT TIME ZONE $1)::date::text AS today`,
    [tz],
  );
  // Memoised because `dateOf` is called once per document per loop, and the
  // generated history turns that from dozens of calls into thousands.
  const dateCache = new Map<number, string>();
  const dateOf = (day: SeedDay): string => {
    const n = daysBack(day);
    const hit = dateCache.get(n);
    if (hit !== undefined) return hit;
    const iso = isoDaysBefore(days!.today, n);
    dateCache.set(n, iso);
    return iso;
  };
  // A local wall-clock instant on a business date, as timestamptz — the
  // placeholders are named by index so a fragment can sit anywhere in a VALUES.
  const localTs = (dateIdx: number, timeIdx: number, tzIdx: number) =>
    `($${dateIdx}::date + $${timeIdx}::time) AT TIME ZONE $${tzIdx}`;

  /*
   * CURATED DATA AND GENERATED HISTORY, WALKED AS ONE.
   *
   * History FIRST in all four, and for two different reasons. For shifts,
   * receipts and payouts it is presentation: the curated day ends up newest, so
   * every screen opens on the hand-written rows. For CASH COUNTS it is
   * correctness — each opening count reads the point's PREVIOUS count as its
   * expectation, so walking a past day after a later one would anchor the past
   * off the future. `dev-seed.history.ts` guarantees its own half is
   * chronological; this is where the two halves meet in the right order.
   */
  const allShifts = [...HISTORY_SHIFTS, ...SEED_SHIFTS];
  const allIntakes = [...HISTORY_INTAKES, ...SEED_INTAKES];
  const allPayouts = [...HISTORY_PAYOUTS, ...SEED_PAYOUTS];
  const allCashCounts = [...HISTORY_CASH_COUNTS, ...SEED_CASH_COUNTS];
  const allTransfers = [...HISTORY_TRANSFERS, ...SEED_TRANSFERS];

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

  /**
   * THE SEED NUMBERS DOCUMENTS THE WAY THE SERVER DOES — 001, 002, … per
   * shift, per kind — because since 2026-09-18 that is the only way a code is
   * ever written. Before then the dataset carried the number off the paper
   * book in `typed` and composed the code from it directly.
   *
   * `typed` SURVIVES AS THE DATASET'S HANDLE, not as a stored value: it is how
   * `SEED_TOP_UPS` names the receipt it tops up, and how the generated season
   * keeps its rows distinct while it is being built. Nothing reads it out of
   * the database, because nothing puts it there any more.
   *
   * DETERMINISTIC, AND THAT IS LOAD-BEARING. The code is this seed's natural
   * key, so a number that moved between runs would break idempotency. It
   * cannot move: the counter is driven by position in `allIntakes` /
   * `allPayouts`, both of which are fixed arrays, and a document that is
   * SKIPPED because it is already in the database still consumes its number —
   * the counter advances before the existence check, not after it.
   */
  const sequence = new Map<string, number>();
  const codeOf = new Map<string, string>();
  const nextSeedCode = (kind: 'IN' | 'PO', point: string, day: SeedDay, typed: string): string => {
    const book = `${kind}/${point}/${String(day)}`;
    const n = (sequence.get(book) ?? 0) + 1;
    sequence.set(book, n);
    const code = composeDocumentCode(pointCode.get(point)!, kind, dateOf(day), padSequence(n));
    codeOf.set(`${book}/${typed}`, code);
    return code;
  };
  /** The intakes loop's answer, replayed for the top-ups loop below, so the two
   *  can never disagree about what an intake's code turned out to be. */
  const intakeCodeFor = (point: string, day: SeedDay, typed: string): string => {
    const code = codeOf.get(`IN/${point}/${String(day)}/${typed}`);
    if (!code) throw new Error(`Seed top-up names an intake the seed never wrote: ${typed}`);
    return code;
  };

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
  for (const sh of allShifts) {
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
    // A POINT MAY HOLD ONLY ONE OPEN SHIFT (`UQ_shifts_open_per_point`), and a
    // demo database seeded on an EARLIER DAY still holds that day's open ones.
    // The lookup above is by `(point, business_date)`, so it does not see them,
    // and the insert below would be the point's second open shift. Postgres
    // refuses it — correctly — with a constraint name and a raw uuid, which
    // tells a developer nothing about what to do next. This is that same
    // refusal, said as a sentence. It is NOT a fix for the stale state: the
    // seed's contract is that it never modifies an existing row, and closing
    // someone else's open shift would break it.
    if (!sh.closed) {
      const openElsewhere = await one<{ business_date: string }>(
        qr,
        `SELECT business_date::text AS business_date FROM shifts
          WHERE collection_point_id = $1 AND status = 'open' AND business_date <> $2::date`,
        [pid, date],
      );
      if (openElsewhere) {
        throw new Error(
          `${sh.point} still has an OPEN shift on ${openElsewhere.business_date}, so today's ` +
            `cannot be opened (UQ_shifts_open_per_point). This database was seeded on an ` +
            `earlier day. Close that shift, or start clean with \`npm run db:reset && npm run db:seed\`.`,
        );
      }
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

  for (const doc of allIntakes) {
    const code = nextSeedCode('IN', doc.point, doc.day, doc.typed);
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

  for (const doc of allPayouts) {
    const code = nextSeedCode('PO', doc.point, doc.day, doc.typed);
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

  // Crates: §6.5's two-tranches-at-different-prices case and ticket #58's
  // receipt-mode list, both on Шипинки. THE SEED NEVER HAND-COMPUTES A
  // BUSINESS NUMBER: `nextIssuanceCode` composes the code exactly as
  // `CratesService.issue` does, and the deposit per unit is read straight off
  // `tare_types` at insert time rather than copied from `SEED_TARE_TYPES`.
  const crateType = await one<{ id: string; deposit_price: string }>(
    qr,
    `SELECT id, deposit_price::text AS deposit_price FROM tare_types WHERE is_crate = true LIMIT 1`,
  );
  if (!crateType) throw new Error('Seed crates: no tare type is flagged is_crate');

  // §6.5's worked example reads «120, then 130» — the OLDER tranche cheaper,
  // the NEWER one dearer — so the demo is nudged to read in the rule's own
  // direction: the older (yesterday) issuance keeps the catalogue's own
  // price (Чешка is 120,00 ₴), and it is the NEWER tranche that needs a
  // price the catalogue does not hold today. That row is nudged to 130,00 ₴
  // for exactly the one issuance that needs it and put back immediately
  // after, inside this same transaction, so nothing outside it ever
  // observes the detour. The partial return (`SEED_CRATE_RETURNS`) still
  // draws from the OLDER tranche first — that is FIFO, not a hand-picked
  // price, and is unaffected by which tranche is dearer.
  const NEWER_CRATE_DEPOSIT_PRICE = '130.00';

  for (const [i, iss] of SEED_CRATE_ISSUANCES.entries()) {
    const shift = shiftId.get(`${iss.point}/${iss.day}`);
    if (!shift) throw new Error(`Seed crate issuance has no shift: ${iss.point}/${iss.day}`);
    const supplier = await supplierFor(iss.point, iss.supplier);

    const found = await one<{ id: string }>(
      qr,
      `SELECT id FROM crate_issuances
        WHERE shift_id = $1 AND supplier_id = $2 AND mode = $3::crate_issuance_mode AND units = $4`,
      [shift, supplier, iss.mode, iss.units],
    );
    if (found) continue;

    // The NEWER tranche: an EARLIER deposit issuance for the SAME supplier
    // already lies behind in the array.
    const isNewerTranche =
      iss.mode === 'deposit' &&
      SEED_CRATE_ISSUANCES.slice(0, i).some(
        (earlier) =>
          earlier.point === iss.point && earlier.supplier === iss.supplier && earlier.mode === 'deposit',
      );
    if (isNewerTranche) {
      await qr.query(`UPDATE tare_types SET deposit_price = $1 WHERE id = $2`, [
        NEWER_CRATE_DEPOSIT_PRICE,
        crateType.id,
      ]);
    }

    const point = SEED_POINTS.find((p) => p.name === iss.point)!;
    const code = await nextIssuanceCode(qr.manager, {
      pointCode: point.code,
      businessDate: dateOf(iss.day),
      shiftId: shift,
      mode: iss.mode as CrateIssuanceMode,
    });

    const priced = await one<{ deposit_price: string }>(
      qr,
      `SELECT deposit_price::text AS deposit_price FROM tare_types WHERE id = $1`,
      [crateType.id],
    );
    const perUnit = iss.mode === 'receipt' ? '0.00' : priced!.deposit_price;
    const taken = iss.mode === 'receipt' ? '0.00' : mul(perUnit, String(iss.units));

    // `created_at` is anchored to the ISSUANCE'S OWN business date — a
    // yesterday shift's issuance now genuinely shows as created yesterday,
    // not backdated from `now()` onto today's wall clock — with a
    // within-day offset by the array's own order (§6.5's FIFO reads oldest
    // `created_at` first) so two same-day rows never tie. Ordering across
    // days falls out of the dates themselves and needs no offset at all.
    const timeOfDay = `09:${String(i * 5).padStart(2, '0')}:00`;
    await qr.query(
      `INSERT INTO crate_issuances
         (code, shift_id, supplier_id, units, mode, deposit_per_unit, deposit_taken, issued_by_user_id, created_at)
       VALUES ($1, $2, $3, $4, $5::crate_issuance_mode, $6, $7, $8, ${localTs(9, 10, 11)})`,
      [
        code,
        shift,
        supplier,
        iss.units,
        iss.mode,
        perUnit,
        taken,
        userByLogin.get(iss.operator)!,
        dateOf(iss.day),
        timeOfDay,
        tz,
      ],
    );

    if (isNewerTranche) {
      // Restore the catalogue to the price `SEED_TARE_TYPES` declares.
      const catalog = SEED_TARE_TYPES.find((t) => t.is_crate)!;
      await qr.query(`UPDATE tare_types SET deposit_price = $1 WHERE id = $2`, [
        catalog.deposit_price,
        crateType.id,
      ]);
    }
  }

  // THE REFUND IS NEVER HAND-COMPUTED EITHER: the supplier's open tranches
  // are read back from the database, oldest first, and `allocate()` — the
  // same pure function `CratesService.returnCrates` calls — decides which
  // one(s) this return draws from and at what price.
  const crateBalance = new CrateBalanceService(
    ds,
    ds.getRepository(CrateIssuance),
    ds.getRepository(CrateReturn),
    ds.getRepository(CrateReturnAllocation),
  );
  for (const ret of SEED_CRATE_RETURNS) {
    const shift = shiftId.get(`${ret.point}/${ret.day}`);
    if (!shift) throw new Error(`Seed crate return has no shift: ${ret.point}/${ret.day}`);
    const supplier = await supplierFor(ret.point, ret.supplier);

    // `crate_returns` has no `code` — (shift, supplier, units) is its natural
    // key here, the same reasoning `transfers` uses for (point, sent_at).
    const found = await one<{ id: string }>(
      qr,
      `SELECT id FROM crate_returns WHERE shift_id = $1 AND supplier_id = $2 AND units = $3`,
      [shift, supplier, ret.units],
    );
    if (found) continue;

    const tranches = await crateBalance.tranchesFor(supplier, qr.manager);
    const result = allocate(tranches, ret.units);
    if (result.shortfall > 0) {
      throw new Error(
        `Seed crate return for ${ret.supplier} at ${ret.point} exceeds outstanding units`,
      );
    }

    const savedReturn = await one<{ id: string }>(
      qr,
      `INSERT INTO crate_returns (shift_id, supplier_id, units, deposit_refund, accepted_by_user_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [shift, supplier, ret.units, result.deposit_refund, userByLogin.get(ret.operator)!],
    );
    for (const alloc of result.allocations) {
      await qr.query(
        `INSERT INTO crate_return_allocations (return_id, issuance_id, units, per_unit, amount)
         VALUES ($1, $2, $3, $4, $5)`,
        [savedReturn!.id, alloc.issuance_id, alloc.units, alloc.per_unit, alloc.amount],
      );
    }
  }

  // IDEMPOTENT ON (intake id, reason), because `intake_top_ups` has no `code`
  // — a top-up has no paper twin to carry one. Re-running the seed must not
  // stack a second 750 ₴ onto the same receipt.
  for (const row of SEED_TOP_UPS) {
    const code = intakeCodeFor(row.point, row.day, row.typed);
    const intake = await one<{ id: string }>(qr, `SELECT id FROM intakes WHERE code = $1`, [
      code,
    ]);
    if (!intake) throw new Error(`Seed top-up has no intake ${code}`);

    const existing = await one<{ id: string }>(
      qr,
      `SELECT id FROM intake_top_ups WHERE intake_id = $1 AND reason = $2`,
      [intake.id, row.reason],
    );
    if (existing) continue;

    await qr.query(
      `INSERT INTO intake_top_ups (intake_id, amount, reason, created_by_user_id)
       VALUES ($1, $2, $3, $4)`,
      [intake.id, row.amount, row.reason, ownerId],
    );
    summary.topUps += 1;
  }

  // TRANSFERS BEFORE COUNTS, and both after the payouts above: a closing
  // count's expectation is «the opening count plus this shift's movements»,
  // and the transfers are half of those movements.
  for (const t of allTransfers) {
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
      // ALL THREE DISPUTE FIELDS OR NONE. `DisputeTransferDto` makes
      // `reported_cash`, `reported_crates` and `dispute_note` mandatory
      // together, so writing only the cash here would store a shape the API
      // cannot produce — and this file's contract is that the demo stores
      // exactly what the API would have stored.
      `INSERT INTO transfers
         (collection_point_id, cash, crates, carrier, sent_by_user_id, sent_at, status,
          accepted_by_user_id, accepted_date, accepted_at,
          reported_cash, reported_crates, dispute_note)
       VALUES ($1, $2, $3, $4, $5, ${localTs(6, 7, 12)}, $8::transfer_status,
               $9, CASE WHEN $9::uuid IS NULL THEN NULL ELSE $6::date END,
               CASE WHEN $9::uuid IS NULL THEN NULL ELSE ${localTs(6, 10, 12)} END,
               $11, $13, $14)`,
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
        t.reportedCrates ?? null,
        t.disputeNote ?? null,
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
  for (const c of allCashCounts) {
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
  const vaultCopy = vaultCopyFor();
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
  await qr.query(
    `INSERT INTO user_credentials (user_id, password_hash, password_enc) VALUES ($1, $2, $3)`,
    [created!.id, await hashPassword('admin'), vaultCopy(created!.id, 'admin')],
  );
  summary.users += 1;
  return created!.id;
}

async function one<T>(qr: QueryRunner, sql: string, params: unknown[] = []): Promise<T | null> {
  const rows: T[] = await qr.query(sql, params);
  return rows[0] ?? null;
}

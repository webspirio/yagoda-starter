# Yagoda Suppliers & Prices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two backend modules — `suppliers` (point-scoped, operator-writable, phone normalized to E.164) and `grade-prices` (an append-only price journal carrying §2.9's markup and discount limits) — so that `intakes` has every dependency but `shifts`.

**Architecture:** Two independent NestJS feature modules under `backend/src/`, following the repo's flat module layout (`<name>.entity.ts`, `<name>.service.ts`, `<name>.controller.ts`, `<name>.mapper.ts`, `dto/`). One hand-written TypeORM migration creates both tables plus a native `supplier_kind` enum. `suppliers` is written by operators at their own point and is audited; `grade_prices` is owner-only, insert-only, and deliberately **not** audited because the table is itself the history.

**Tech Stack:** NestJS 10 (Express), TypeORM + PostgreSQL 16, class-validator/class-transformer, Jest (two configs: `npm test` for `*.spec.ts`, `npm run test:db` for `*.db-spec.ts`), supertest.

**Spec:** `docs/superpowers/specs/2026-09-07-yagoda-suppliers-prices-slice.md`

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from the spec.

- **`numeric` is a string end to end** — database, entity, DTO, JSON. Never a `number`. No arithmetic operator is ever applied to a money or weight value (foundation §5.1). This slice performs no arithmetic; `decimal.js` is NOT added.
- **All three price columns are `numeric(10,2)`**, DTO regex `/^\d{1,8}(\.\d{1,2})?$/`, each with `@CanonicalDecimal()` below the `@Matches`. Omitting `@CanonicalDecimal()` makes `'1.2'` and `'1.20'` compare unequal and is a real bug, not a nicety.
- **`CHECK (… >= 0)`** on `base_price`, `max_markup`, `max_discount`. Zero is legal; negative is not.
- **`max_markup` and `max_discount` are positive magnitudes.** `max_markup = 30` means `bonus <= +30`; `max_discount = 20` means `bonus >= -20`. Nothing in this slice reads them.
- **No `DELETE` route anywhere, ever.** Deactivation (`is_active`) is the only removal verb.
- **No `PATCH` on `grade_prices`.** A correction is a new row (§4.2).
- **No `UNIQUE` on `(collection_point_id, product_grade_id)`** — that constraint is what forbade history in the old `shift_grade_prices`. Its absence is asserted by a test.
- **`supplier_kind`** is a native Postgres enum with exactly `'none' | 'wholesale' | 'farmer'`, default `'none'`.
- **Phone canonical form is E.164**, stored canonical-only, `CHECK`-enforced. No `libphonenumber-js` dependency.
- **`suppliers.collection_point_id` is immutable** — absent from the update DTO.
- **Timestamps are `timestamptz`** (`@CreateDateColumn({ type: 'timestamptz' })`).
- **Audit:** `supplier.created` / `supplier.updated` only. **No `price.*` action.**
- **Migration id is `1788600000006`**, file `1788600000006-YagodaSuppliersAndPrices.ts`.
- **`strict: true` TypeScript. No `@ts-ignore`, no `as any`.** (`as never` in test doubles matches existing specs and is acceptable there.)
- Commands run from the repo root: `npm test -w backend`, `npm run test:db -w backend`, `npm run lint -w backend`.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `backend/src/suppliers/phone.ts` | `canonicalizePhone(raw)` — the only place a phone is normalized |
| `backend/src/suppliers/phone.spec.ts` | Table-driven proof of every accepted and rejected form |
| `backend/src/suppliers/supplier.entity.ts` | `suppliers` row + constraint metadata |
| `backend/src/suppliers/supplier-kind.enum.ts` | `SupplierKind` TS enum matching the PG type |
| `backend/src/suppliers/supplier.mapper.ts` | `SupplierResponse` + `toSupplierResponse` |
| `backend/src/suppliers/dto/create-supplier.dto.ts` | |
| `backend/src/suppliers/dto/update-supplier.dto.ts` | No `collection_point_id` |
| `backend/src/suppliers/dto/list-suppliers.query.ts` | `?collection_point_id= &q= &include_inactive=` on `PaginationQueryDto` |
| `backend/src/suppliers/suppliers.service.ts` | List/search, findOne, create, update |
| `backend/src/suppliers/suppliers.service.spec.ts` | |
| `backend/src/suppliers/suppliers.controller.ts` | |
| `backend/src/suppliers/suppliers.module.ts` | |
| `backend/src/grade-prices/grade-price.entity.ts` | `grade_prices` row, insert-only |
| `backend/src/grade-prices/grade-price.mapper.ts` | |
| `backend/src/grade-prices/dto/create-grade-price.dto.ts` | |
| `backend/src/grade-prices/dto/list-grade-prices.query.ts` | journal read, `PaginationQueryDto` |
| `backend/src/grade-prices/dto/current-grade-prices.query.ts` | picker read, `CatalogPaginationQueryDto` |
| `backend/src/grade-prices/grade-prices.service.ts` | `current()`, `list()`, `create()` |
| `backend/src/grade-prices/grade-prices.service.spec.ts` | |
| `backend/src/grade-prices/grade-prices.controller.ts` | |
| `backend/src/grade-prices/grade-prices.module.ts` | |
| `backend/src/migrations/1788600000006-YagodaSuppliersAndPrices.ts` | Both tables + enum |
| `backend/src/migrations/suppliers-prices-schema.db-spec.ts` | Constraint proofs in raw SQL |

**Modified:**

| File | Change |
|---|---|
| `backend/src/audit/audit-log.entity.ts` | Add `'supplier.created'`, `'supplier.updated'` to `AUDIT_ACTIONS` |
| `backend/src/products/product-grades.service.ts` | Add `findOneRaw(id)` |
| `backend/src/app.module.ts` | Import `SuppliersModule`, `GradePricesModule` |
| `backend/src/testing/pipeline.db-spec.ts` | New HTTP describe block |
| `backend/CLAUDE.md` | Structure table + migrations list |
| `CLAUDE.md` | Domain line naming the implemented tables |
| `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md` | New section for this slice's four follow-ups |

---

## Task 1: Phone canonicalisation

The spec's entire argument for `UNIQUE (collection_point_id, phone)` collapses if this function is wrong, so it is built first, alone, with no database and no Nest.

**Files:**
- Create: `backend/src/suppliers/phone.ts`
- Test: `backend/src/suppliers/phone.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `canonicalizePhone(raw: string): string` — throws `BadRequestException` on anything it cannot parse. Used by `SuppliersService` in Task 3.

- [ ] **Step 1: Write the failing test**

Create `backend/src/suppliers/phone.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { canonicalizePhone } from './phone';

describe('canonicalizePhone', () => {
  // The six spellings named in the spec (§5.7) are one human. If any row of
  // this table regresses, `UNIQUE (collection_point_id, phone)` silently stops
  // meaning anything and duplicate suppliers become permanent — правка 6
  // cancelled the merge tool, so there is no way back.
  it.each([
    ['0671234567', '+380671234567'],
    ['067 123 45 67', '+380671234567'],
    ['(067) 123-45-67', '+380671234567'],
    ['067-123-45-67', '+380671234567'],
    ['380671234567', '+380671234567'],
    ['+380671234567', '+380671234567'],
    ['+38 (067) 123-45-67', '+380671234567'],
    ['  +380671234567  ', '+380671234567'],
    // A non-Ukrainian number already in E.164 passes through untouched. The
    // CHECK constraint is the E.164 SHAPE, not +380, so this is storable.
    ['+48123456789', '+48123456789'],
  ])('canonicalizes %s to %s', (input, expected) => {
    expect(canonicalizePhone(input)).toBe(expected);
  });

  it.each([
    ['067123', 'too short for a Ukrainian number'],
    ['+380671234', 'Ukrainian prefix, too few digits'],
    ['+3806712345678', 'Ukrainian prefix, too many digits'],
    ['3806712345', 'Ukrainian prefix, too few digits'],
    ['not-a-phone', 'letters'],
    ['', 'empty'],
    ['   ', 'all whitespace'],
    ['+', 'plus alone'],
    ['++380671234567', 'two plus signs'],
    ['+0671234567', 'E.164 forbids a leading zero after the plus'],
  ])('rejects %s (%s)', (input) => {
    expect(() => canonicalizePhone(input)).toThrow(BadRequestException);
  });

  it('names the accepted forms in the error, so the operator can fix it', () => {
    expect(() => canonicalizePhone('067123')).toThrow(/0XXXXXXXXX/);
  });

  it('carries a machine-readable code', () => {
    try {
      canonicalizePhone('nope');
      fail('expected a BadRequestException');
    } catch (err) {
      expect((err as BadRequestException).getResponse()).toMatchObject({
        code: 'SUPPLIER_PHONE_INVALID',
      });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w backend -- phone.spec`
Expected: FAIL — `Cannot find module './phone'`.

- [ ] **Step 3: Write the implementation**

Create `backend/src/suppliers/phone.ts`:

```ts
import { BadRequestException } from '@nestjs/common';

/**
 * The ONE place a supplier phone is normalized.
 *
 * `UNIQUE (collection_point_id, phone)` on raw text is worth nothing, and the
 * DBML supplies the proof: it is the argument that deleted the `villages`
 * table, where one village appeared four ways in the client's own book. A
 * phone typed at 06:40 arrives as `0671234567`, `+380671234567`,
 * `067 123 45 67` or `(067) 123-45-67` — four strings, one human, and a plain
 * UNIQUE accepts all four. That yields four independent
 * `Σ intakes − Σ payouts` balances for one person, permanently: §5.4 and §5.5
 * (duplicate detection and merging) were CANCELLED by правки 5 and 6, so there
 * is no merge tool and there will not be one.
 *
 * WHY CANONICAL-ONLY STORAGE, diverging from the catalog slice's "store
 * exactly as typed, compare case-insensitively": «Копайгород» → «копайгород»
 * is data loss, but `067 123 45 67` → `+380671234567` is not. A name's
 * capitalization is content; a phone's dashes are presentation, and a phone
 * number has a canonical form. The catalog pattern's PRINCIPLE is preserved —
 * the database is the real guarantee — by `CHK_suppliers_phone_e164`, which
 * rejects a non-canonical value even if a future code path forgets to call
 * this function.
 *
 * NO `libphonenumber-js`. One country with one expansion rule is this
 * function plus its table-driven spec, and this repo's posture is to add a
 * dependency when something real needs it (`decimal.js` is deferred on the
 * same reasoning). That library is the upgrade path if a second country
 * appears.
 */
const ACCEPTED_FORMS =
  '0XXXXXXXXX, 380XXXXXXXXX, +380XXXXXXXXX, or an international number in E.164 ' +
  '(+ then 8–15 digits). Spaces, dashes and parentheses are ignored.';

/** Ukrainian national form: a leading 0 and nine more digits. */
const UA_NATIONAL = /^0\d{9}$/;
/** Ukrainian international form, with or without the plus. */
const UA_INTERNATIONAL = /^\+?380\d{9}$/;
/** Anything that CLAIMS to be Ukrainian, so a wrong length is rejected rather
 *  than falling through to the permissive international branch below. */
const UA_CLAIMED = /^(\+?380|0)/;
/** E.164: a plus, a non-zero leading digit, 8–15 digits in total. */
const E164 = /^\+[1-9]\d{7,14}$/;

export function canonicalizePhone(raw: string): string {
  // Strip every separator a human might type. The hyphen is escaped and the
  // unicode dashes are written as explicit code points (U+2010 HYPHEN through
  // U+2015 HORIZONTAL BAR) — a paste from a spreadsheet or a phone keyboard
  // produces those, and writing them literally inside a character class makes
  // the range boundaries invisible in review.
  const stripped = raw.replace(/[\s()\-\u2010-\u2015]/g, '');

  if (UA_INTERNATIONAL.test(stripped)) {
    return stripped.startsWith('+') ? stripped : `+${stripped}`;
  }
  if (UA_NATIONAL.test(stripped)) {
    // '0671234567' -> '+38' + '0671234567' = '+380671234567'
    return `+38${stripped}`;
  }
  // Checked BEFORE the generic E.164 branch: '+38012345' has eight digits and
  // would otherwise be accepted as a valid foreign number, silently storing a
  // malformed Ukrainian one.
  if (!UA_CLAIMED.test(stripped) && E164.test(stripped)) {
    return stripped;
  }

  throw new BadRequestException({
    message: `"${raw}" is not a phone number this system can store. Accepted: ${ACCEPTED_FORMS}`,
    code: 'SUPPLIER_PHONE_INVALID',
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w backend -- phone.spec`
Expected: PASS, all cases.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint -w backend
git add backend/src/suppliers/phone.ts backend/src/suppliers/phone.spec.ts
git commit -m "feat(suppliers): canonicalize phone numbers to E.164"
```

---

## Task 2: Migration and schema proofs

**READ THIS BEFORE STARTING.** The catalog slice hit a trap in exactly this task and recorded it: `app_test` **persists between runs and this suite never truncates**. A db-spec written before its migration exists will INSERT rows that survive, and on the next run a duplicate-key error from the *wrong* insert looks identical to the one being asserted. Every fixture value below is suffixed with a per-run `randomUUID()` for that reason. Do not "simplify" them to literals.

**Files:**
- Create: `backend/src/migrations/1788600000006-YagodaSuppliersAndPrices.ts`
- Create: `backend/src/migrations/suppliers-prices-schema.db-spec.ts`

**Interfaces:**
- Consumes: existing tables `collection_points`, `product_grades`, `users`.
- Produces: tables `suppliers` and `grade_prices`, type `supplier_kind`. Constraint names later tasks' entity decorators must match exactly: `PK_suppliers`, `FK_suppliers_point`, `CHK_suppliers_phone_e164`, `UQ_suppliers_point_phone`, `IDX_suppliers_point_last_name`, `PK_grade_prices`, `FK_grade_prices_point`, `FK_grade_prices_grade`, `FK_grade_prices_author`, `CHK_grade_prices_base_price`, `CHK_grade_prices_max_markup`, `CHK_grade_prices_max_discount`, `IDX_grade_prices_lookup`.

**Prerequisite:** the test database exists. If `npm run test:db` errors on connect, run once:
`docker compose exec postgres createdb -U app app_test`

- [ ] **Step 1: Write the failing db-spec**

Create `backend/src/migrations/suppliers-prices-schema.db-spec.ts`:

```ts
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';

/**
 * Everything in this slice's schema that exists ONLY in hand-written SQL and
 * is invisible to a mocked repository.
 *
 * Every fixture value carries a per-RUN uuid: `app_test` persists between runs
 * and this suite never truncates, so a literal would pass on a fresh database
 * and then fail on every later run with a duplicate-key error from the WRONG
 * insert. Same convention as `catalog-schema.db-spec.ts`.
 */
describe('YagodaSuppliersAndPrices', () => {
  let ds: DataSource;
  let pointA: string;
  let pointB: string;
  let gradeId: string;
  let userId: string;

  beforeAll(async () => {
    ds = await openTestDataSource();

    const run = randomUUID();
    const [a] = await ds.query(
      `INSERT INTO collection_points (name, kind) VALUES ($1, 'reception') RETURNING id`,
      [`Точка А-${run}`],
    );
    const [b] = await ds.query(
      `INSERT INTO collection_points (name, kind) VALUES ($1, 'reception') RETURNING id`,
      [`Точка Б-${run}`],
    );
    pointA = a.id;
    pointB = b.id;

    const [product] = await ds.query(`INSERT INTO products (name) VALUES ($1) RETURNING id`, [
      `Малина-${run}`,
    ]);
    const [grade] = await ds.query(
      `INSERT INTO product_grades (product_id, name) VALUES ($1, $2) RETURNING id`,
      [product.id, `1 сорт-${run}`],
    );
    gradeId = grade.id;

    const [user] = await ds.query(
      `INSERT INTO users (first_name, last_name, role) VALUES ('Ціно', 'Ставник', 'network_owner')
       RETURNING id`,
    );
    userId = user.id;
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it.each(['suppliers', 'grade_prices'])('creates the %s table', async (table) => {
    const [row] = await ds.query(`SELECT to_regclass($1) IS NOT NULL AS present`, [
      `public.${table}`,
    ]);
    expect(row.present).toBe(true);
  });

  const insertSupplier = (point: string, phone: string | null, last = 'Коваль') =>
    ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name, phone)
       VALUES ($1, 'Іван', $2, $3) RETURNING id`,
      [point, last, phone],
    );

  describe('phone uniqueness', () => {
    it('rejects the same phone twice at one point', async () => {
      const phone = `+38067${String(Math.floor(1e6 + Math.random() * 9e6))}`;
      await insertSupplier(pointA, phone);
      await expect(insertSupplier(pointA, phone)).rejects.toThrow(/duplicate key/i);
    });

    it('PERMITS the same phone at a different point', async () => {
      // §3.9 — a person delivering to two points is two rows, and debt does
      // not cross between them. If this ever starts failing, the constraint
      // has been widened to the network and §3.9 is broken.
      const phone = `+38067${String(Math.floor(1e6 + Math.random() * 9e6))}`;
      await insertSupplier(pointA, phone);
      await expect(insertSupplier(pointB, phone)).resolves.toBeDefined();
    });

    it('permits MANY suppliers with no phone at one point', async () => {
      // правка 8's «без номеру телефону» escape hatch. It works only because
      // Postgres unique indexes treat NULLs as distinct (NULLS DISTINCT), and
      // no unit test can reach that fact.
      await insertSupplier(pointA, null, `Безномерний-${randomUUID()}`);
      await expect(
        insertSupplier(pointA, null, `Безномерний-${randomUUID()}`),
      ).resolves.toBeDefined();
    });
  });

  describe('phone shape', () => {
    it.each(['067123', 'not-a-phone', '+3806712345678901', '0671234567', '+0671234567'])(
      'rejects %s',
      async (bad) => {
        await expect(insertSupplier(pointA, bad)).rejects.toThrow(/violates check constraint/i);
      },
    );

    it('accepts a canonical E.164 value', async () => {
      const phone = `+38067${String(Math.floor(1e6 + Math.random() * 9e6))}`;
      await expect(insertSupplier(pointA, phone)).resolves.toBeDefined();
    });
  });

  it('rejects an unknown supplier_kind', async () => {
    await expect(
      ds.query(
        `INSERT INTO suppliers (collection_point_id, first_name, last_name, kind)
         VALUES ($1, 'Іван', 'Коваль', 'reseller')`,
        [pointA],
      ),
    ).rejects.toThrow(/invalid input value for enum/i);
  });

  it('defaults supplier_kind to none and is_active to true', async () => {
    const [row] = await insertSupplier(pointA, null, `Дефолт-${randomUUID()}`);
    const [saved] = await ds.query(`SELECT kind, is_active FROM suppliers WHERE id = $1`, [row.id]);
    expect(saved).toEqual({ kind: 'none', is_active: true });
  });

  it('rejects a supplier pointing at no collection point', async () => {
    await expect(insertSupplier(randomUUID(), null)).rejects.toThrow(/foreign key/i);
  });

  const insertPrice = (base: string, markup = '30.00', discount = '20.00') =>
    ds.query(
      `INSERT INTO grade_prices
         (collection_point_id, product_grade_id, base_price, max_markup, max_discount,
          created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [pointA, gradeId, base, markup, discount, userId],
    );

  describe('grade_prices', () => {
    it.each([
      ['base_price', () => insertPrice('-1')],
      ['max_markup', () => insertPrice('50.00', '-1')],
      ['max_discount', () => insertPrice('50.00', '30.00', '-1')],
    ])('rejects a negative %s', async (_column, attempt) => {
      await expect(attempt()).rejects.toThrow(/violates check constraint/i);
    });

    it('permits zero in all three columns', async () => {
      // Zero means "no adjustment permitted" and is a real, expressible state.
      await expect(insertPrice('0', '0', '0')).resolves.toBeDefined();
    });

    it('PERMITS two rows for the same point and grade', async () => {
      // An INVERTED assertion, proving an ABSENCE. §4.2 requires history —
      // «записи не перетираються, а додаються» — and a UNIQUE on this pair is
      // exactly what forbade it in the old `shift_grade_prices`. If a future
      // `migration:generate` run helpfully adds that constraint, this test is
      // the only thing that notices before history is destroyed.
      await insertPrice('50.00');
      await expect(insertPrice('55.00')).resolves.toBeDefined();
    });

    it('returns all three money columns as STRINGS', async () => {
      const [row] = await insertPrice('51.50', '30.00', '20.00');
      const [saved] = await ds.query(
        `SELECT base_price, max_markup, max_discount FROM grade_prices WHERE id = $1`,
        [row.id],
      );
      expect(typeof saved.base_price).toBe('string');
      expect(typeof saved.max_markup).toBe('string');
      expect(typeof saved.max_discount).toBe('string');
      expect(saved.base_price).toBe('51.50');
    });

    it('rejects a price pointing at no grade', async () => {
      await expect(
        ds.query(
          `INSERT INTO grade_prices
             (collection_point_id, product_grade_id, base_price, max_markup, max_discount,
              created_by_user_id)
           VALUES ($1, $2, '50.00', '30.00', '20.00', $3)`,
          [pointA, randomUUID(), userId],
        ),
      ).rejects.toThrow(/foreign key/i);
    });

    it('has no updated_at column — the table is append-only', async () => {
      const [row] = await ds.query(
        `SELECT count(*)::int AS n FROM information_schema.columns
          WHERE table_name = 'grade_prices' AND column_name = 'updated_at'`,
      );
      expect(row.n).toBe(0);
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:db -w backend -- suppliers-prices-schema`
Expected: FAIL — `relation "suppliers" does not exist` on the `beforeAll` fixtures or the first assertion.

- [ ] **Step 3: Write the migration**

Create `backend/src/migrations/1788600000006-YagodaSuppliersAndPrices.ts`:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Suppliers and the price journal.
 *
 * TWO THINGS IN HERE ARE DELIBERATE ABSENCES, and both are the kind a later
 * reader "fixes":
 *
 * 1. `grade_prices` has NO `updated_at` and NO UNIQUE on
 *    (collection_point_id, product_grade_id). §4.2 requires history —
 *    «записи не перетираються, а додаються» — and that UNIQUE is precisely
 *    what forbade it in the old `shift_grade_prices`. A row is never updated;
 *    a correction is a new row. `suppliers-prices-schema.db-spec.ts` asserts
 *    both absences.
 * 2. `grade_prices` has NO `business_date`. Prices carry over until changed
 *    and the current one is the newest row for the pair. See spec §8.1, which
 *    also records what that costs.
 *
 * THE REGEX IS WRITTEN WITH `[+]` AND `[0-9]`, NOT `\+` AND `\d`, ON PURPOSE.
 * This SQL lives in a JavaScript template literal, where `\+` collapses to a
 * bare `+` and `\d` collapses to a bare `d` before Postgres ever sees the
 * string — producing `^+[1-9]...` (an invalid POSIX regex) and `^[1-9]d{7,14}`
 * (a constraint that matches a literal letter d). Both are silent: the first
 * throws at migration time, the second creates a constraint that rejects every
 * real phone number. Bracket expressions need no escaping and cannot be
 * mangled this way.
 */
export class YagodaSuppliersAndPrices1788600000006 implements MigrationInterface {
  name = 'YagodaSuppliersAndPrices1788600000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "supplier_kind" AS ENUM ('none', 'wholesale', 'farmer')`,
    );

    await queryRunner.query(`
      CREATE TABLE "suppliers" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "collection_point_id" uuid NOT NULL,
        "first_name" character varying NOT NULL,
        "last_name" character varying NOT NULL,
        "phone" character varying,
        "note" text,
        "kind" "supplier_kind" NOT NULL DEFAULT 'none',
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_suppliers" PRIMARY KEY ("id"),
        CONSTRAINT "FK_suppliers_point" FOREIGN KEY ("collection_point_id")
          REFERENCES "collection_points"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_suppliers_phone_e164"
          CHECK ("phone" IS NULL OR "phone" ~ '^[+][1-9][0-9]{7,14}$'),
        CONSTRAINT "UQ_suppliers_point_phone" UNIQUE ("collection_point_id", "phone")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_suppliers_point_last_name"
         ON "suppliers" ("collection_point_id", "last_name")`,
    );

    await queryRunner.query(`
      CREATE TABLE "grade_prices" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "collection_point_id" uuid NOT NULL,
        "product_grade_id" uuid NOT NULL,
        "base_price" numeric(10,2) NOT NULL,
        "max_markup" numeric(10,2) NOT NULL,
        "max_discount" numeric(10,2) NOT NULL,
        "created_by_user_id" uuid NOT NULL,
        "reason" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_grade_prices" PRIMARY KEY ("id"),
        CONSTRAINT "FK_grade_prices_point" FOREIGN KEY ("collection_point_id")
          REFERENCES "collection_points"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_grade_prices_grade" FOREIGN KEY ("product_grade_id")
          REFERENCES "product_grades"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_grade_prices_author" FOREIGN KEY ("created_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_grade_prices_base_price" CHECK ("base_price" >= 0),
        CONSTRAINT "CHK_grade_prices_max_markup" CHECK ("max_markup" >= 0),
        CONSTRAINT "CHK_grade_prices_max_discount" CHECK ("max_discount" >= 0)
      )
    `);
    // Serves the only hot read: "the current price at this point for this
    // grade" is the first row of this index, descending.
    await queryRunner.query(
      `CREATE INDEX "IDX_grade_prices_lookup"
         ON "grade_prices" ("collection_point_id", "product_grade_id", "created_at" DESC)`,
    );
  }

  /**
   * Drops both tables and the enum. This WILL fail once any `intakes` row
   * references a supplier — the safe direction, and the same posture
   * `BootstrapOwner.down()` already takes.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "grade_prices"`);
    await queryRunner.query(`DROP TABLE "suppliers"`);
    await queryRunner.query(`DROP TYPE "supplier_kind"`);
  }
}
```

- [ ] **Step 4: Run the db-spec to verify it passes**

Run: `npm run test:db -w backend -- suppliers-prices-schema`
Expected: PASS. Migrations apply automatically on connect (`db-harness.ts`).

If the run fails with `type "supplier_kind" already exists` after an aborted attempt, the migration partially applied. Reset with:
`docker compose exec postgres psql -U app -d app_test -c 'DROP TABLE IF EXISTS grade_prices; DROP TABLE IF EXISTS suppliers; DROP TYPE IF EXISTS supplier_kind; DELETE FROM migrations WHERE name = $$YagodaSuppliersAndPrices1788600000006$$;'`

- [ ] **Step 5: Commit**

```bash
npm run lint -w backend
git add backend/src/migrations/1788600000006-YagodaSuppliersAndPrices.ts \
        backend/src/migrations/suppliers-prices-schema.db-spec.ts
git commit -m "feat(db): add suppliers and grade_prices tables"
```

---

## Task 3: Suppliers domain — entity, DTOs, mapper, service

**Files:**
- Create: `backend/src/suppliers/supplier-kind.enum.ts`, `supplier.entity.ts`, `supplier.mapper.ts`, `dto/create-supplier.dto.ts`, `dto/update-supplier.dto.ts`, `dto/list-suppliers.query.ts`, `suppliers.service.ts`
- Modify: `backend/src/audit/audit-log.entity.ts:17-36` (add two actions)
- Test: `backend/src/suppliers/suppliers.service.spec.ts`

**Interfaces:**
- Consumes: `canonicalizePhone` (Task 1); `assertOwnsPoint`, `resolvePointFilter` from `../auth/access/point-scope`; `assertTrimmedName` from `../common/trimmed-name`; `diffFields` from `../common/diff-fields`; `AuditService.record(entry, manager?)`.
- Produces:
  - `enum SupplierKind { None = 'none', Wholesale = 'wholesale', Farmer = 'farmer' }`
  - `class Supplier` (TypeORM entity)
  - `interface SupplierResponse`, `toSupplierResponse(s: Supplier): SupplierResponse`
  - `class SuppliersService` with
    `list(actor, query): Promise<Paginated<SupplierResponse>>`,
    `findOne(actor, id): Promise<SupplierResponse>`,
    `create(actor, dto): Promise<SupplierResponse>`,
    `update(actor, id, dto): Promise<SupplierResponse>`
  - Constructor signature: `(repo: Repository<Supplier>, dataSource: DataSource, audit: AuditService)`

- [ ] **Step 1: Add the two audit actions**

In `backend/src/audit/audit-log.entity.ts`, append to the `AUDIT_ACTIONS` array, after `'tare-type.updated'`:

```ts
  'supplier.created',
  'supplier.updated',
```

There is deliberately **no** `price.*` action. `grade_prices` is itself the history — actor, timestamp, reason and the before-value are all already columns — and a second copy is what the DBML header forbids.

- [ ] **Step 2: Write the failing service spec**

Create `backend/src/suppliers/suppliers.service.spec.ts`:

```ts
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '../users/user-role.enum';
import { SuppliersService } from './suppliers.service';
import { SupplierKind } from './supplier-kind.enum';

const POINT_A = '11111111-1111-1111-1111-111111111111';
const POINT_B = '22222222-2222-2222-2222-222222222222';

const owner = { sub: 'u-owner', username: 'owner', role: UserRole.NetworkOwner, collection_point_id: null };
const operator = { sub: 'u-op', username: 'op', role: UserRole.PointOperator, collection_point_id: POINT_A };

describe('SuppliersService', () => {
  let repo: {
    findAndCount: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let txRepo: { create: jest.Mock; save: jest.Mock };
  let manager: { getRepository: () => typeof txRepo };
  let audit: { record: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let qb: {
    where: jest.Mock; andWhere: jest.Mock; orderBy: jest.Mock; addOrderBy: jest.Mock;
    skip: jest.Mock; take: jest.Mock; getManyAndCount: jest.Mock; getOne: jest.Mock;
  };
  let service: SuppliersService;

  const supplier = (over: Record<string, unknown> = {}) => ({
    id: 's-1',
    collection_point_id: POINT_A,
    first_name: 'Іван',
    last_name: 'Коваль',
    phone: '+380671234567',
    note: null,
    kind: SupplierKind.None,
    is_active: true,
    created_at: new Date('2026-07-15T06:00:00.000Z'),
    updated_at: new Date('2026-07-15T06:00:00.000Z'),
    ...over,
  });

  beforeEach(() => {
    qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[supplier()], 1]),
      getOne: jest.fn().mockResolvedValue(null),
    };
    repo = {
      findAndCount: jest.fn().mockResolvedValue([[supplier()], 1]),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockImplementation((s) => Promise.resolve(s)),
      create: jest.fn().mockImplementation((s) => supplier(s)),
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    };
    // A DISTINCT repo standing in for `manager.getRepository(Supplier)`. If it
    // were the same object as `repo`, a regression that escaped the
    // transaction — leaving an audit entry that could survive a rolled-back
    // write — would be invisible.
    txRepo = {
      create: jest.fn().mockImplementation((s) => supplier(s)),
      save: jest.fn().mockImplementation((s) => Promise.resolve(s)),
    };
    manager = { getRepository: () => txRepo };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    dataSource = { transaction: jest.fn().mockImplementation((cb) => cb(manager)) };
    service = new SuppliersService(repo as never, dataSource as never, audit as never);
  });

  describe('create', () => {
    const dto = { first_name: ' Іван ', last_name: ' Коваль ', phone: '067 123 45 67' };

    it('derives the point from an OPERATOR and never from the body', async () => {
      await service.create(operator, { ...dto } as never);
      expect(txRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ collection_point_id: POINT_A }),
      );
    });

    it('requires an OWNER to name the point, since an owner has none', async () => {
      await expect(service.create(owner, { ...dto } as never)).rejects.toThrow(BadRequestException);
    });

    it('lets an owner create at any point', async () => {
      await service.create(owner, { ...dto, collection_point_id: POINT_B } as never);
      expect(txRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ collection_point_id: POINT_B }),
      );
    });

    it('refuses an operator naming someone else’s point', async () => {
      await expect(
        service.create(operator, { ...dto, collection_point_id: POINT_B } as never),
      ).rejects.toThrow(ForbiddenException);
    });

    it('canonicalizes the phone before saving', async () => {
      await service.create(operator, { ...dto } as never);
      expect(txRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ phone: '+380671234567' }),
      );
    });

    it('stores a null phone as null — правка 8’s escape hatch', async () => {
      await service.create(operator, { first_name: 'Іван', last_name: 'Коваль' } as never);
      expect(txRepo.create).toHaveBeenCalledWith(expect.objectContaining({ phone: null }));
    });

    it('trims both names', async () => {
      await service.create(operator, { ...dto } as never);
      expect(txRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ first_name: 'Іван', last_name: 'Коваль' }),
      );
    });

    it('rejects an all-whitespace last name with a 400', async () => {
      await expect(
        service.create(operator, { first_name: 'Іван', last_name: '   ' } as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('409s when the phone is already used AT THIS POINT', async () => {
      qb.getOne.mockResolvedValue(supplier({ id: 'other' }));
      await expect(service.create(operator, { ...dto } as never)).rejects.toThrow(
        ConflictException,
      );
    });

    it('does NOT run the phone pre-check when there is no phone', async () => {
      await service.create(operator, { first_name: 'Іван', last_name: 'Коваль' } as never);
      expect(qb.getOne).not.toHaveBeenCalled();
    });

    it('writes the audit entry inside the transaction', async () => {
      await service.create(operator, { ...dto } as never);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'supplier.created',
          actor_id: 'u-op',
          target_type: 'supplier',
        }),
        manager,
      );
    });
  });

  describe('update', () => {
    beforeEach(() => repo.findOne.mockResolvedValue(supplier()));

    it('404s on an unknown id', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.update(operator, 's-x', {} as never)).rejects.toThrow(NotFoundException);
    });

    it('refuses an operator touching another point’s supplier', async () => {
      repo.findOne.mockResolvedValue(supplier({ collection_point_id: POINT_B }));
      await expect(service.update(operator, 's-1', { note: 'hi' } as never)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('writes NO audit entry for a no-op PATCH', async () => {
      await service.update(operator, 's-1', {} as never);
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('audits only the fields that moved', async () => {
      await service.update(operator, 's-1', { kind: SupplierKind.Wholesale } as never);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'supplier.updated',
          before: { kind: SupplierKind.None },
          after: { kind: SupplierKind.Wholesale },
        }),
        manager,
      );
    });

    it('canonicalizes a changed phone', async () => {
      await service.update(operator, 's-1', { phone: '(050) 987-65-43' } as never);
      expect(txRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ phone: '+380509876543' }),
      );
    });

    it('accepts an explicit null phone — clearing it is legal', async () => {
      await service.update(operator, 's-1', { phone: null } as never);
      expect(txRepo.save).toHaveBeenCalledWith(expect.objectContaining({ phone: null }));
    });

    it('skips the pre-check when the canonical phone is unchanged', async () => {
      // '067 123 45 67' canonicalizes to the value already stored, so this is
      // not a change and must not 409 against the row itself.
      await service.update(operator, 's-1', { phone: '067 123 45 67' } as never);
      expect(qb.getOne).not.toHaveBeenCalled();
    });

    it('deactivation is never blocked', async () => {
      await expect(
        service.update(operator, 's-1', { is_active: false } as never),
      ).resolves.toBeDefined();
    });
  });

  describe('list', () => {
    it('pins an operator to their own point, ignoring the requested one', async () => {
      await service.list(operator, { page: 1, limit: 20, collection_point_id: POINT_B } as never);
      expect(qb.andWhere).toHaveBeenCalledWith('s.collection_point_id = :pointId', {
        pointId: POINT_A,
      });
    });

    it('lets an owner span every point when none is requested', async () => {
      await service.list(owner, { page: 1, limit: 20 } as never);
      expect(qb.andWhere).not.toHaveBeenCalledWith(
        's.collection_point_id = :pointId',
        expect.anything(),
      );
    });

    it('hides inactive suppliers by default', async () => {
      await service.list(operator, { page: 1, limit: 20 } as never);
      expect(qb.andWhere).toHaveBeenCalledWith('s.is_active = true');
    });

    it('takes the PHONE lane for a digits-only q, matching on the suffix', async () => {
      // «останні чотири цифри?» is how this is asked out loud.
      await service.list(operator, { page: 1, limit: 20, q: '45 67' } as never);
      expect(qb.andWhere).toHaveBeenCalledWith('s.phone LIKE :phone', { phone: '%4567' });
    });

    it('matches a FULL number exactly, canonicalized', async () => {
      await service.list(operator, { page: 1, limit: 20, q: '067 123 45 67' } as never);
      expect(qb.andWhere).toHaveBeenCalledWith('s.phone = :phone', { phone: '+380671234567' });
    });

    it('takes the NAME lane for anything else, across both name columns', async () => {
      await service.list(operator, { page: 1, limit: 20, q: 'Ковал' } as never);
      expect(qb.andWhere).toHaveBeenCalledWith(
        '(s.first_name ILIKE :q OR s.last_name ILIKE :q)',
        { q: '%Ковал%' },
      );
    });

    it('ignores a whitespace-only q rather than matching everything', async () => {
      await service.list(operator, { page: 1, limit: 20, q: '   ' } as never);
      expect(qb.andWhere).not.toHaveBeenCalledWith('s.phone LIKE :phone', expect.anything());
      expect(qb.andWhere).not.toHaveBeenCalledWith(
        '(s.first_name ILIKE :q OR s.last_name ILIKE :q)',
        expect.anything(),
      );
    });

    it('does NOT throw when a q is an unparseable phone — search is not entry', async () => {
      // A partial number is not a valid phone and must not 400 a SEARCH.
      await expect(
        service.list(operator, { page: 1, limit: 20, q: '4567' } as never),
      ).resolves.toBeDefined();
    });
  });

  describe('findOne', () => {
    it('404s — not 403 — for another point’s supplier', async () => {
      // Deliberate divergence from GET /collection-points/:id, which the
      // foundation follow-ups flag as a weak existence oracle. Suppliers are
      // real people's names and phone numbers.
      repo.findOne.mockResolvedValue(supplier({ collection_point_id: POINT_B }));
      await expect(service.findOne(operator, 's-1')).rejects.toThrow(NotFoundException);
    });

    it('returns the supplier at the caller’s own point', async () => {
      repo.findOne.mockResolvedValue(supplier());
      await expect(service.findOne(operator, 's-1')).resolves.toMatchObject({ id: 's-1' });
    });
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test -w backend -- suppliers.service.spec`
Expected: FAIL — `Cannot find module './suppliers.service'`.

- [ ] **Step 4: Write the enum, entity and mapper**

Create `backend/src/suppliers/supplier-kind.enum.ts`:

```ts
/**
 * §2.11 — a REPORTING marker on the person, nothing more. «Базова ціна від
 * маркера не залежить ніколи»: `wholesale` does not change any price, which is
 * also why there is no «ОПТ» product grade (see `ProductGrade`'s doc comment —
 * a grade with its own daily price would apply the same premium twice).
 *
 * String values match the `supplier_kind` Postgres enum exactly.
 */
export enum SupplierKind {
  None = 'none',
  Wholesale = 'wholesale',
  Farmer = 'farmer',
}
```

Create `backend/src/suppliers/supplier.entity.ts`:

```ts
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { CollectionPoint } from '../collection-points/collection-point.entity';
import { SupplierKind } from './supplier-kind.enum';

/**
 * A person who brings berries to ONE point.
 *
 * §3.9 — the record is nailed to the point: someone delivering to two points
 * is TWO rows, and debt from one is never settled at the other.
 * `collection_point_id` is therefore IMMUTABLE and absent from the update DTO
 * — re-pointing a row silently moves a money balance from one point's books to
 * another's, with no document changing and no trail explaining it.
 *
 * DEBT IS NOT A COLUMN HERE AND MUST NEVER BECOME ONE. It is the difference of
 * two histories, `Σ intakes − Σ payouts` filtered by `supplier_id` alone, with
 * `voided_at IS NULL` on BOTH sides. The `suppliers` Note is emphatic: «полів
 * paid / debt / balance немає ані тут, ані в intakes, і додавати їх не можна» —
 * a stored cache is exactly where the client's own working book broke, 124
 * breaks out of 1473.
 *
 * `phone` is stored CANONICAL (E.164) and nothing else — see `phone.ts` for
 * why this table diverges from the catalog's "store as typed" rule.
 * `CHK_suppliers_phone_e164` is the real guarantee; `canonicalizePhone` only
 * produces the friendly error.
 *
 * MANY NULL PHONES COEXIST AT ONE POINT, and that is правка 8's «без номеру
 * телефону» escape hatch working as designed: Postgres unique indexes treat
 * NULLs as distinct. There is deliberately no separate "has no phone" column —
 * «окремого поля під цей факт немає навмисно» — so the server cannot and must
 * not distinguish "checkbox ticked" from "field omitted".
 *
 * Constraint names are declared here explicitly so `migration:generate`
 * recognises what the migration already created and proposes nothing.
 */
@Entity('suppliers')
@Unique('UQ_suppliers_point_phone', ['collection_point_id', 'phone'])
@Check('CHK_suppliers_phone_e164', `"phone" IS NULL OR "phone" ~ '^[+][1-9][0-9]{7,14}$'`)
@Index('IDX_suppliers_point_last_name', ['collection_point_id', 'last_name'])
export class Supplier {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** IMMUTABLE after create — §3.9. Absent from `UpdateSupplierDto`. */
  @Column({ type: 'uuid' })
  collection_point_id: string;

  @ManyToOne(() => CollectionPoint, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'collection_point_id' })
  collection_point: CollectionPoint;

  @Column({ type: 'varchar' })
  first_name: string;

  @Column({ type: 'varchar' })
  last_name: string;

  /** Canonical E.164, or null. Never the raw string the operator typed. */
  @Column({ type: 'varchar', nullable: true })
  phone: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'enum', enum: SupplierKind, enumName: 'supplier_kind', default: SupplierKind.None })
  kind: SupplierKind;

  /** §5.6 — «видалення немає, тільки is_active». */
  @Column({ type: 'bool', default: true })
  is_active: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
```

Create `backend/src/suppliers/supplier.mapper.ts`:

```ts
import { Supplier } from './supplier.entity';
import { SupplierKind } from './supplier-kind.enum';

/** `created_at` only, no `updated_at` — matching every other mapper in this
 *  codebase. "When did this change" is the audit log's question. */
export interface SupplierResponse {
  id: string;
  collection_point_id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  note: string | null;
  kind: SupplierKind;
  is_active: boolean;
  created_at: string;
}

export function toSupplierResponse(supplier: Supplier): SupplierResponse {
  return {
    id: supplier.id,
    collection_point_id: supplier.collection_point_id,
    first_name: supplier.first_name,
    last_name: supplier.last_name,
    phone: supplier.phone,
    note: supplier.note,
    kind: supplier.kind,
    is_active: supplier.is_active,
    created_at: supplier.created_at.toISOString(),
  };
}
```

- [ ] **Step 5: Write the DTOs**

Create `backend/src/suppliers/dto/create-supplier.dto.ts`:

```ts
import { IsEnum, IsOptional, IsString, IsUUID, Length, MaxLength, ValidateIf } from 'class-validator';
import { SupplierKind } from '../supplier-kind.enum';

/**
 * `collection_point_id` is OPTIONAL here and resolved by the service, not by
 * this DTO: an operator's point is DERIVED from their token and a value they
 * send for someone else's point is a 403, while an OWNER has no point and must
 * name one (400 if absent). Encoding that split in validators is impossible —
 * it depends on the caller's role, which a DTO cannot see.
 *
 * `phone` uses `@ValidateIf(... !== undefined)` rather than `@IsOptional()`
 * because an explicit `null` is MEANINGFUL here — правка 8's «без номеру
 * телефону» — and `@IsOptional()` would treat null as absent. The column is
 * nullable, so null must reach the service.
 */
export class CreateSupplierDto {
  @IsOptional()
  @IsUUID()
  collection_point_id?: string;

  @IsString()
  @Length(1, 128)
  first_name: string;

  @IsString()
  @Length(1, 128)
  last_name: string;

  /** Any human format; `canonicalizePhone` normalizes it or 400s. */
  @ValidateIf((o: CreateSupplierDto) => o.phone !== undefined && o.phone !== null)
  @IsString()
  @Length(1, 32)
  phone?: string | null;

  @ValidateIf((o: CreateSupplierDto) => o.note !== undefined && o.note !== null)
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @IsOptional()
  @IsEnum(SupplierKind)
  kind?: SupplierKind;
}
```

Create `backend/src/suppliers/dto/update-supplier.dto.ts`:

```ts
import { IsBoolean, IsEnum, IsString, Length, MaxLength, ValidateIf } from 'class-validator';
import { SupplierKind } from '../supplier-kind.enum';

/**
 * NO `collection_point_id`. §3.9 nails a supplier to a point and debt is
 * filtered by `supplier_id` ALONE — the Note says filtering by point
 * separately is «не треба й не можна». Re-pointing a row would move a real
 * money balance between two points' books with no document explaining it. A
 * supplier entered at the wrong point is DEACTIVATED and recreated, not moved.
 *
 * `first_name`, `last_name`, `kind` and `is_active` back NOT NULL columns and
 * use `@ValidateIf(... !== undefined)` so an explicit null is a 400, not a
 * silently-skipped validator. `phone` and `note` are nullable columns, so
 * their guard admits null deliberately — clearing either is legal.
 */
export class UpdateSupplierDto {
  @ValidateIf((o: UpdateSupplierDto) => o.first_name !== undefined)
  @IsString()
  @Length(1, 128)
  first_name?: string;

  @ValidateIf((o: UpdateSupplierDto) => o.last_name !== undefined)
  @IsString()
  @Length(1, 128)
  last_name?: string;

  @ValidateIf((o: UpdateSupplierDto) => o.phone !== undefined && o.phone !== null)
  @IsString()
  @Length(1, 32)
  phone?: string | null;

  @ValidateIf((o: UpdateSupplierDto) => o.note !== undefined && o.note !== null)
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @ValidateIf((o: UpdateSupplierDto) => o.kind !== undefined)
  @IsEnum(SupplierKind)
  kind?: SupplierKind;

  @ValidateIf((o: UpdateSupplierDto) => o.is_active !== undefined)
  @IsBoolean()
  is_active?: boolean;
}
```

Create `backend/src/suppliers/dto/list-suppliers.query.ts`:

```ts
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { BooleanQueryParam } from '../../common/dto/boolean-query-param';

/**
 * `PaginationQueryDto` (default 20), NOT `CatalogPaginationQueryDto` (100).
 * Products and tare types are bounded reference tables read into a picker;
 * suppliers is UNBOUNDED and grows forever — a busy point accumulates hundreds
 * and there is no delete. This is a browsable list, so the browsable default
 * is the right one.
 *
 * `collection_point_id` is IGNORED for an operator rather than rejected — see
 * `resolvePointFilter`'s doc comment: the parameter can neither widen nor
 * redirect their scope, so there is nothing meaningful to report.
 */
export class ListSuppliersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  collection_point_id?: string;

  /** One search box, sniffed into a phone lane or a name lane by the service. */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  q?: string;

  @BooleanQueryParam()
  include_inactive?: boolean;
}
```

- [ ] **Step 6: Write the service**

Create `backend/src/suppliers/suppliers.service.ts`:

```ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Supplier } from './supplier.entity';
import { SupplierKind } from './supplier-kind.enum';
import { canonicalizePhone } from './phone';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { ListSuppliersQueryDto } from './dto/list-suppliers.query';
import { SupplierResponse, toSupplierResponse } from './supplier.mapper';
import { AuditService } from '../audit/audit.service';
import { assertOwnsPoint, resolvePointFilter } from '../auth/access/point-scope';
import { assertTrimmedName } from '../common/trimmed-name';
import { diffFields } from '../common/diff-fields';
import { Paginated } from '../common/dto/paginated';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

const SUPPLIER_FIELDS = ['first_name', 'last_name', 'phone', 'note', 'kind', 'is_active'] as const;

/** A `q` made only of digits and phone punctuation takes the phone lane.
 *  Unicode dashes are written as code points for the same reason as in
 *  `phone.ts` — a literal range is invisible in review. */
const LOOKS_LIKE_PHONE = /^[+\d\s()\-\u2010-\u2015]+$/;

@Injectable()
export class SuppliersService {
  constructor(
    @InjectRepository(Supplier)
    private readonly repo: Repository<Supplier>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  /**
   * PERFORMANCE, STATED RATHER THAN BURIED: the phone suffix `LIKE` and the
   * name substring `ILIKE` both ignore `IDX_suppliers_point_last_name` — these
   * are sequential scans WITHIN one point. That is fine at hundreds of
   * suppliers per point and stops being fine somewhere in the low tens of
   * thousands, at which point the answer is a `pg_trgm` GIN index. That is
   * purely additive; do not pre-build it.
   */
  async list(
    actor: AuthenticatedUser,
    query: ListSuppliersQueryDto,
  ): Promise<Paginated<SupplierResponse>> {
    const pointId = resolvePointFilter(actor, query.collection_point_id);

    const qb = this.repo.createQueryBuilder('s');
    if (pointId) qb.andWhere('s.collection_point_id = :pointId', { pointId });
    if (!query.include_inactive) qb.andWhere('s.is_active = true');

    const q = query.q?.trim();
    if (q) {
      if (LOOKS_LIKE_PHONE.test(q)) {
        const digits = q.replace(/\D/g, '');
        if (digits) {
          // A FULL number is matched exactly on its canonical form; a partial
          // one on its suffix, because «останні чотири цифри?» is how this is
          // actually asked out loud. `canonicalizePhone` may reject a partial
          // number — searching is not entry, so a failure falls back to the
          // suffix match instead of 400ing the search.
          const exact = this.tryCanonicalize(q);
          if (exact) qb.andWhere('s.phone = :phone', { phone: exact });
          else qb.andWhere('s.phone LIKE :phone', { phone: `%${digits}` });
        }
      } else {
        qb.andWhere('(s.first_name ILIKE :q OR s.last_name ILIKE :q)', { q: `%${q}%` });
      }
    }

    const [data, total] = await qb
      .orderBy('s.last_name', 'ASC')
      .addOrderBy('s.first_name', 'ASC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();

    return { data: data.map(toSupplierResponse), total, page: query.page, limit: query.limit };
  }

  /**
   * 404 — NOT 403 — for a supplier at another point. `GET
   * /collection-points/:id` distinguishes the two, and the foundation
   * follow-ups flag that as a weak existence oracle «worth remembering before
   * this shape is copied onto a guessable id». This is the copy, and these
   * rows are real people's names and phone numbers.
   */
  async findOne(actor: AuthenticatedUser, id: string): Promise<SupplierResponse> {
    const supplier = await this.repo.findOne({ where: { id } });
    if (!supplier || !this.visibleTo(actor, supplier)) {
      throw new NotFoundException('Supplier not found');
    }
    return toSupplierResponse(supplier);
  }

  async create(actor: AuthenticatedUser, dto: CreateSupplierDto): Promise<SupplierResponse> {
    const pointId = this.resolveWritePoint(actor, dto.collection_point_id);
    const first_name = assertTrimmedName(dto.first_name, 'first_name', 'SUPPLIER_NAME_EMPTY');
    const last_name = assertTrimmedName(dto.last_name, 'last_name', 'SUPPLIER_NAME_EMPTY');
    const phone = dto.phone == null ? null : canonicalizePhone(dto.phone);
    if (phone) await this.assertPhoneFree(pointId, phone);

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Supplier);
      const supplier = await repo.save(
        repo.create({
          collection_point_id: pointId,
          first_name,
          last_name,
          phone,
          note: dto.note ?? null,
          kind: dto.kind ?? SupplierKind.None,
        }),
      );

      await this.audit.record(
        {
          action: 'supplier.created',
          actor_id: actor.sub,
          target_type: 'supplier',
          target_id: supplier.id,
          after: {
            collection_point_id: supplier.collection_point_id,
            first_name: supplier.first_name,
            last_name: supplier.last_name,
            phone: supplier.phone,
            kind: supplier.kind,
          },
        },
        manager,
      );

      return toSupplierResponse(supplier);
    });
  }

  /**
   * TODO (when `intakes` and `payouts` land): decide whether deactivating a
   * supplier carrying non-zero debt deserves a WARNING. Never a refusal —
   * §6.1 and правка 14, «заблокована кнопка вчить шукати обхід». And "settle
   * up first" is not even well-defined: the `suppliers` Note establishes that
   * debt can legitimately be NEGATIVE after a voided receipt, and that
   * «інваріанта борг >= 0 в цій схемі теж немає».
   *
   * A RENAME REASSIGNS A MONEY BALANCE, and no guard here prevents it. Debt
   * follows `supplier_id`, not the name, so editing «Іван Коваль» into «Петро
   * Мельник» moves a real balance to a different human — with no delete and,
   * per §5.5 as cancelled by правка 6, NO merge tool, ever. The audit
   * before/after diff is the only trail. A guard was considered and rejected:
   * every version of it also blocks the common case, which is fixing a typo in
   * a name entered at 06:40.
   */
  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateSupplierDto,
  ): Promise<SupplierResponse> {
    const supplier = await this.repo.findOne({ where: { id } });
    if (!supplier) throw new NotFoundException('Supplier not found');
    assertOwnsPoint(actor, supplier.collection_point_id);

    const before = this.snapshot(supplier);

    if (dto.first_name != null) {
      supplier.first_name = assertTrimmedName(dto.first_name, 'first_name', 'SUPPLIER_NAME_EMPTY');
    }
    if (dto.last_name != null) {
      supplier.last_name = assertTrimmedName(dto.last_name, 'last_name', 'SUPPLIER_NAME_EMPTY');
    }
    if (dto.phone !== undefined) {
      const phone = dto.phone === null ? null : canonicalizePhone(dto.phone);
      // Compared AFTER canonicalisation: '067 123 45 67' against a stored
      // '+380671234567' is not a change, and must not be checked against the
      // row itself and 409.
      if (phone && phone !== supplier.phone) await this.assertPhoneFree(supplier.collection_point_id, phone, supplier.id);
      supplier.phone = phone;
    }
    if (dto.note !== undefined) supplier.note = dto.note;
    if (dto.kind != null) supplier.kind = dto.kind;
    if (dto.is_active != null) supplier.is_active = dto.is_active;

    return this.dataSource.transaction(async (manager) => {
      const saved = await manager.getRepository(Supplier).save(supplier);
      const diff = diffFields(before, this.snapshot(saved), SUPPLIER_FIELDS);

      if (diff) {
        await this.audit.record(
          {
            action: 'supplier.updated',
            actor_id: actor.sub,
            target_type: 'supplier',
            target_id: saved.id,
            before: diff.before,
            after: diff.after,
          },
          manager,
        );
      }

      return toSupplierResponse(saved);
    });
  }

  /** An operator's point comes from their token; an owner has none and must
   *  name one. This is `point-scope.ts`'s rule applied as written. */
  private resolveWritePoint(actor: AuthenticatedUser, requested?: string): string {
    if (actor.collection_point_id && !requested) return actor.collection_point_id;
    if (!requested) {
      throw new BadRequestException({
        message: 'collection_point_id is required',
        code: 'COLLECTION_POINT_REQUIRED',
      });
    }
    assertOwnsPoint(actor, requested);
    return requested;
  }

  private visibleTo(actor: AuthenticatedUser, supplier: Supplier): boolean {
    if (actor.role === UserRole.NetworkOwner) return true;
    return actor.collection_point_id === supplier.collection_point_id;
  }

  private tryCanonicalize(raw: string): string | null {
    try {
      return canonicalizePhone(raw);
    } catch {
      return null;
    }
  }

  private snapshot(s: Supplier): Record<(typeof SUPPLIER_FIELDS)[number], unknown> {
    return {
      first_name: s.first_name,
      last_name: s.last_name,
      phone: s.phone,
      note: s.note,
      kind: s.kind,
      is_active: s.is_active,
    };
  }

  /**
   * The friendly 409. `UQ_suppliers_point_phone` is the real guarantee — this
   * is a check-then-act and two concurrent creates can both pass it, leaving
   * the loser with a 500 instead of a 409. That matches the pre-existing shape
   * in `CollectionPointsService`, `UserAdminService` and the three catalog
   * services; recorded for consistency, not as a new defect.
   */
  private async assertPhoneFree(
    pointId: string,
    phone: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.repo
      .createQueryBuilder('s')
      .where('s.collection_point_id = :pointId AND s.phone = :phone', { pointId, phone })
      .getOne();

    if (existing && existing.id !== excludeId) {
      throw new ConflictException({
        message: 'A supplier with that phone already exists at this point',
        code: 'SUPPLIER_PHONE_TAKEN',
      });
    }
  }
}
```

- [ ] **Step 7: Run the spec to verify it passes**

Run: `npm test -w backend -- suppliers.service.spec`
Expected: PASS.

- [ ] **Step 8: Lint and commit**

```bash
npm run lint -w backend
git add backend/src/suppliers backend/src/audit/audit-log.entity.ts
git commit -m "feat(suppliers): point-scoped supplier records with E.164 phones"
```

---

## Task 4: Suppliers HTTP surface

**Files:**
- Create: `backend/src/suppliers/suppliers.controller.ts`, `backend/src/suppliers/suppliers.module.ts`
- Modify: `backend/src/app.module.ts` (imports array, after `TareTypesModule`)
- Test: `backend/src/testing/pipeline.db-spec.ts` (new `describe` block appended)

**Interfaces:**
- Consumes: `SuppliersService` (Task 3); `Auth` from `../auth/decorators/auth.decorators`; `CurrentUser` from `../auth/decorators/current-user.decorator`.
- Produces: `SuppliersModule` (exports `TypeOrmModule` and `SuppliersService`, so `intakes` can depend on it later); routes `GET/POST /suppliers`, `GET/PATCH /suppliers/:id`.

- [ ] **Step 1: Write the failing HTTP test**

Append this `describe` block to `backend/src/testing/pipeline.db-spec.ts`. Follow the file's existing conventions exactly: tokens are signed with the app's own `JwtService` (**never** add another `/auth/login` call — the Redis-backed 10-per-minute-per-IP throttle is shared across every test in this file), and every fixture name carries a `randomUUID()` because nothing truncates.

```ts
describe('suppliers + grade prices (HTTP)', () => {
  let app: INestApplication;
  let ownerToken: string;
  let operatorToken: string;
  let pointA: string;
  let pointB: string;
  let gradeId: string;

  beforeAll(async () => {
    process.env.DB_NAME = resolveTestDatabaseName();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
    await app.init();

    const jwt = app.get(JwtService);
    const users = app.get(UsersService);
    const credentials = app.get(CredentialsService);
    const run = randomUUID();

    // Points and a grade, created through the API's own owner so the fixture
    // exercises nothing this suite is not already testing elsewhere.
    const bootstrapOwner = await users.createWithIdentity(
      {
        provider: LOCAL_PROVIDER,
        providerUserId: `sup-owner-${run}`,
        first_name: 'Ціно',
        last_name: 'Ставник',
        role: UserRole.NetworkOwner,
        collection_point_id: null,
      },
      async (created, manager) => credentials.set(created.id, 'hunter2!!', manager),
    );
    ownerToken = jwt.sign({ sub: bootstrapOwner.user.id });

    const pointRes = await request(app.getHttpServer())
      .post('/collection-points')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `Точка А-${run}`, kind: 'reception' })
      .expect(201);
    pointA = pointRes.body.id;

    const pointBRes = await request(app.getHttpServer())
      .post('/collection-points')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `Точка Б-${run}`, kind: 'reception' })
      .expect(201);
    pointB = pointBRes.body.id;

    const productRes = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `Малина-${run}` })
      .expect(201);

    const gradeRes = await request(app.getHttpServer())
      .post('/product-grades')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ product_id: productRes.body.id, name: `1 сорт-${run}` })
      .expect(201);
    gradeId = gradeRes.body.id;

    const op = await users.createWithIdentity(
      {
        provider: LOCAL_PROVIDER,
        providerUserId: `sup-op-${run}`,
        first_name: 'Оксана',
        last_name: 'Приймальник',
        role: UserRole.PointOperator,
        collection_point_id: pointA,
      },
      async (created, manager) => credentials.set(created.id, 'hunter2!!', manager),
    );
    operatorToken = jwt.sign({ sub: op.user.id });
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  const uniquePhone = () => `067${String(Math.floor(1e6 + Math.random() * 9e6))}`;

  it('lets an OPERATOR create a supplier at their own point, deriving the point from the token', async () => {
    const res = await request(app.getHttpServer())
      .post('/suppliers')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ first_name: 'Іван', last_name: `Коваль-${randomUUID()}`, phone: uniquePhone() })
      .expect(201);

    expect(res.body.collection_point_id).toBe(pointA);
    expect(res.body.phone).toMatch(/^\+380\d{9}$/);
  });

  it('refuses an operator creating at another point', async () => {
    await request(app.getHttpServer())
      .post('/suppliers')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        collection_point_id: pointB,
        first_name: 'Іван',
        last_name: `Чужий-${randomUUID()}`,
      })
      .expect(403);
  });

  it('400s on a phone it cannot canonicalize', async () => {
    await request(app.getHttpServer())
      .post('/suppliers')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ first_name: 'Іван', last_name: `Кривий-${randomUUID()}`, phone: '067123' })
      .expect(400);
  });

  it('finds a supplier by the last four digits of their phone', async () => {
    const phone = uniquePhone();
    const last = `Пошук-${randomUUID()}`;
    await request(app.getHttpServer())
      .post('/suppliers')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ first_name: 'Іван', last_name: last, phone })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/suppliers?q=${phone.slice(-4)}`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);

    expect(res.body.data.some((s: { last_name: string }) => s.last_name === last)).toBe(true);
  });

  it('scopes an operator’s list to their own point even when another is requested', async () => {
    const res = await request(app.getHttpServer())
      .get(`/suppliers?collection_point_id=${pointB}`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);

    expect(
      res.body.data.every((s: { collection_point_id: string }) => s.collection_point_id === pointA),
    ).toBe(true);
  });

  it('returns 404, NOT 403, for another point’s supplier', async () => {
    const created = await request(app.getHttpServer())
      .post('/suppliers')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        collection_point_id: pointB,
        first_name: 'Петро',
        last_name: `Інший-${randomUUID()}`,
      })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/suppliers/${created.body.id}`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(404);
  });

  it('rejects collection_point_id in a PATCH body — the point is immutable', async () => {
    const created = await request(app.getHttpServer())
      .post('/suppliers')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ first_name: 'Іван', last_name: `Незмінний-${randomUUID()}` })
      .expect(201);

    // `forbidNonWhitelisted: true` turns an unknown property into a 400 — which
    // is what makes "absent from the DTO" an enforced rule rather than a note.
    await request(app.getHttpServer())
      .patch(`/suppliers/${created.body.id}`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ collection_point_id: pointB })
      .expect(400);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:db -w backend -- pipeline`
Expected: FAIL — 404 on `POST /suppliers` (no route exists yet).

- [ ] **Step 3: Write the controller**

Create `backend/src/suppliers/suppliers.controller.ts`:

```ts
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SuppliersService } from './suppliers.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { ListSuppliersQueryDto } from './dto/list-suppliers.query';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * THE FIRST MODULE IN THIS PROJECT WHOSE WRITES ARE NOT OWNER-ONLY, and the
 * break is deliberate. A car arrives at a roadside point with 40 kg of
 * raspberries and a person the operator has never seen; under owner-only
 * writes the delivery cannot be taken until someone elsewhere creates the
 * record. §3.9 nails the supplier to the point precisely because this is a
 * point-level, in-the-moment act.
 *
 * `kind` does not justify a stricter rule on part of the row: §2.11 is
 * explicit that «базова ціна від маркера не залежить ніколи», so `wholesale`
 * is a reporting marker with no effect on money.
 *
 * Every handler is `@Auth()` — both roles — and the point-level rule is
 * enforced in the SERVICE by `assertOwnsPoint`/`resolvePointFilter`, per this
 * codebase's convention that guards decide from the request alone and
 * `assert*` decides from a row.
 *
 * No DELETE — §5.6, «видалення немає, тільки is_active».
 */
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  @Auth()
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListSuppliersQueryDto) {
    return this.suppliers.list(actor, query);
  }

  @Get(':id')
  @Auth()
  findOne(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.suppliers.findOne(actor, id);
  }

  @Post()
  @Auth()
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateSupplierDto) {
    return this.suppliers.create(actor, dto);
  }

  @Patch(':id')
  @Auth()
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupplierDto,
  ) {
    return this.suppliers.update(actor, id, dto);
  }
}
```

- [ ] **Step 4: Write the module and register it**

Create `backend/src/suppliers/suppliers.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Supplier } from './supplier.entity';
import { SuppliersService } from './suppliers.service';
import { SuppliersController } from './suppliers.controller';
import { AuditModule } from '../audit/audit.module';

/**
 * Its own module. `suppliers` shares nothing with the catalogs: it is scoped
 * to a point, written by operators, and its whole reason to exist is to be one
 * half of `Σ intakes − Σ payouts`.
 *
 * `SuppliersService` is exported so `intakes` can validate a `supplier_id`
 * through its owner rather than growing its own query.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Supplier]), AuditModule],
  controllers: [SuppliersController],
  providers: [SuppliersService],
  exports: [TypeOrmModule, SuppliersService],
})
export class SuppliersModule {}
```

In `backend/src/app.module.ts`, add the import statement beside the other feature-module imports and add `SuppliersModule` to the `imports` array immediately after `TareTypesModule`:

```ts
import { SuppliersModule } from './suppliers/suppliers.module';
```

```ts
    TareTypesModule,
    SuppliersModule,
    AuditModule,
```

- [ ] **Step 5: Run both suites**

Run: `npm test -w backend && npm run test:db -w backend`
Expected: PASS. The new HTTP block and every pre-existing spec.

- [ ] **Step 6: Lint and commit**

```bash
npm run lint -w backend
git add backend/src/suppliers backend/src/app.module.ts backend/src/testing/pipeline.db-spec.ts
git commit -m "feat(suppliers): expose operator-writable supplier routes"
```

---

## Task 5: Grade prices domain — entity, DTOs, mapper, service

**Files:**
- Create: `backend/src/grade-prices/grade-price.entity.ts`, `grade-price.mapper.ts`, `dto/create-grade-price.dto.ts`, `dto/list-grade-prices.query.ts`, `dto/current-grade-prices.query.ts`, `grade-prices.service.ts`
- Modify: `backend/src/products/product-grades.service.ts` (add `findOneRaw`)
- Test: `backend/src/grade-prices/grade-prices.service.spec.ts`

**Interfaces:**
- Consumes: `CollectionPointsService.findOneRaw(id): Promise<CollectionPoint | null>` (already exists); `ProductGradesService.findOneRaw(id): Promise<ProductGrade | null>` (added in Step 1); `assertOwnsPoint`, `resolvePointFilter`.
- Produces:
  - `class GradePrice` (TypeORM entity)
  - `interface GradePriceResponse`, `toGradePriceResponse(row): GradePriceResponse`
  - `class GradePricesService` with
    `current(actor, query): Promise<Paginated<GradePriceResponse>>`,
    `list(actor, query): Promise<Paginated<GradePriceResponse>>`,
    `create(actor, dto): Promise<GradePriceResponse>`
  - Constructor signature: `(repo: Repository<GradePrice>, points: CollectionPointsService, grades: ProductGradesService)`
  - **No `DataSource`, no `AuditService`** — see Step 4's doc comment.

- [ ] **Step 1: Add `findOneRaw` to `ProductGradesService`**

In `backend/src/products/product-grades.service.ts`, add this method immediately after the `list()` method, mirroring `ProductsService.findOneRaw`:

```ts
  /** The entity, unmapped — for other modules that need to validate a grade
   *  exists and is active. Reads across domains are open; going through the
   *  owner keeps them from growing their own query. */
  async findOneRaw(id: string): Promise<ProductGrade | null> {
    return this.repo.findOne({ where: { id } });
  }
```

- [ ] **Step 2: Write the failing service spec**

Create `backend/src/grade-prices/grade-prices.service.spec.ts`:

```ts
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '../users/user-role.enum';
import { GradePricesService } from './grade-prices.service';

const POINT_A = '11111111-1111-1111-1111-111111111111';
const POINT_B = '22222222-2222-2222-2222-222222222222';
const GRADE = '33333333-3333-3333-3333-333333333333';

const owner = { sub: 'u-owner', username: 'owner', role: UserRole.NetworkOwner, collection_point_id: null };
const operator = { sub: 'u-op', username: 'op', role: UserRole.PointOperator, collection_point_id: POINT_A };

describe('GradePricesService', () => {
  let repo: {
    findAndCount: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    manager: { query: jest.Mock };
  };
  let points: { findOneRaw: jest.Mock };
  let grades: { findOneRaw: jest.Mock };
  let service: GradePricesService;

  const price = (over: Record<string, unknown> = {}) => ({
    id: 'gp-1',
    collection_point_id: POINT_A,
    product_grade_id: GRADE,
    base_price: '52.00',
    max_markup: '30.00',
    max_discount: '20.00',
    created_by_user_id: 'u-owner',
    reason: null,
    created_at: new Date('2026-07-15T07:10:00.000Z'),
    ...over,
  });

  const dto = {
    collection_point_id: POINT_A,
    product_grade_id: GRADE,
    base_price: '52.00',
    max_markup: '30.00',
    max_discount: '20.00',
  };

  beforeEach(() => {
    repo = {
      findAndCount: jest.fn().mockResolvedValue([[price()], 1]),
      save: jest.fn().mockImplementation((p) => Promise.resolve(p)),
      create: jest.fn().mockImplementation((p) => price(p)),
      manager: {
        query: jest
          .fn()
          .mockResolvedValueOnce([{ count: 1 }])
          .mockResolvedValueOnce([price()]),
      },
    };
    points = { findOneRaw: jest.fn().mockResolvedValue({ id: POINT_A, is_active: true }) };
    grades = { findOneRaw: jest.fn().mockResolvedValue({ id: GRADE, is_active: true }) };
    service = new GradePricesService(repo as never, points as never, grades as never);
  });

  describe('create', () => {
    it('records the author from the token, never from the body', async () => {
      await service.create(owner, { ...dto } as never);
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ created_by_user_id: 'u-owner' }),
      );
    });

    it('stores all three numbers as the strings it was given', async () => {
      const result = await service.create(owner, { ...dto } as never);
      expect(result.base_price).toBe('52.00');
      expect(result.max_markup).toBe('30.00');
      expect(result.max_discount).toBe('20.00');
      expect(typeof result.base_price).toBe('string');
    });

    it('404s on an unknown collection point', async () => {
      points.findOneRaw.mockResolvedValue(null);
      await expect(service.create(owner, { ...dto } as never)).rejects.toThrow(NotFoundException);
    });

    it('404s on an unknown grade', async () => {
      grades.findOneRaw.mockResolvedValue(null);
      await expect(service.create(owner, { ...dto } as never)).rejects.toThrow(NotFoundException);
    });

    it('REJECTS an inactive grade rather than silently skipping it', async () => {
      // A silently-dropped grade looks exactly like success, which is the
      // failure mode worth a test.
      grades.findOneRaw.mockResolvedValue({ id: GRADE, is_active: false });
      await expect(service.create(owner, { ...dto } as never)).rejects.toThrow(BadRequestException);
    });

    it('refuses an operator entirely — the route is owner-only, but the service says so too', async () => {
      await expect(
        service.create(operator, { ...dto, collection_point_id: POINT_B } as never),
      ).rejects.toThrow(ForbiddenException);
    });

    it('never updates an existing row — a correction is a new row (§4.2)', async () => {
      await service.create(owner, { ...dto } as never);
      await service.create(owner, { ...dto, base_price: '55.00' } as never);
      expect(repo.save).toHaveBeenCalledTimes(2);
      expect(repo.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('current', () => {
    it('pins an operator to their own point', async () => {
      await service.current(operator, { page: 1, limit: 100, collection_point_id: POINT_B } as never);
      const [, params] = repo.manager.query.mock.calls[0];
      expect(params).toContain(POINT_A);
      expect(params).not.toContain(POINT_B);
    });

    it('uses DISTINCT ON so each grade appears once, newest first', async () => {
      await service.current(operator, { page: 1, limit: 100 } as never);
      const [sql] = repo.manager.query.mock.calls[0];
      expect(sql).toMatch(/DISTINCT ON/i);
      expect(sql).toMatch(/created_at DESC/i);
    });

    it('hides prices for inactive grades by default', async () => {
      await service.current(operator, { page: 1, limit: 100 } as never);
      const [sql] = repo.manager.query.mock.calls[0];
      expect(sql).toMatch(/pg\.is_active = true/);
    });

    it('includes them when asked', async () => {
      await service.current(operator, { page: 1, limit: 100, include_inactive: true } as never);
      const [sql] = repo.manager.query.mock.calls[0];
      expect(sql).not.toMatch(/pg\.is_active = true/);
    });

    it('returns the Paginated envelope with a real total', async () => {
      const result = await service.current(operator, { page: 1, limit: 100 } as never);
      expect(result).toMatchObject({ total: 1, page: 1, limit: 100 });
      expect(result.data).toHaveLength(1);
    });
  });

  describe('list (the journal)', () => {
    it('orders newest first', async () => {
      await service.list(owner, { page: 1, limit: 20 } as never);
      expect(repo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ order: { created_at: 'DESC' } }),
      );
    });

    it('pins an operator to their own point', async () => {
      await service.list(operator, { page: 1, limit: 20, collection_point_id: POINT_B } as never);
      expect(repo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ collection_point_id: POINT_A }) }),
      );
    });

    it('filters by grade when asked', async () => {
      await service.list(owner, { page: 1, limit: 20, product_grade_id: GRADE } as never);
      expect(repo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ product_grade_id: GRADE }) }),
      );
    });
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test -w backend -- grade-prices.service.spec`
Expected: FAIL — `Cannot find module './grade-prices.service'`.

- [ ] **Step 4: Write the entity and mapper**

Create `backend/src/grade-prices/grade-price.entity.ts`:

```ts
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CollectionPoint } from '../collection-points/collection-point.entity';
import { ProductGrade } from '../products/product-grade.entity';
import { User } from '../users/user.entity';

/**
 * §4.2 — an APPEND-ONLY price journal. «Кожна зміна ціни лягає ОКРЕМИМ записом
 * із часом і автором; записи не перетираються, а додаються.» The current price
 * for a (point, grade) pair is the row with the greatest `created_at`.
 *
 * THREE ABSENCES, ALL DELIBERATE, ALL THE KIND A LATER READER "FIXES":
 *
 * 1. NO `updated_at`, and no update path anywhere. A correction is a new row.
 * 2. NO UNIQUE on (collection_point_id, product_grade_id). That constraint is
 *    exactly what forbade history in the old `shift_grade_prices`. Its absence
 *    is asserted by an inverted test in `suppliers-prices-schema.db-spec.ts`,
 *    because a `migration:generate` run that helpfully adds it would destroy
 *    §4.2 silently. A double-submitted save therefore appends two identical
 *    rows: harmless (latest wins, values match), and accepted rather than
 *    fixed, since every mechanism for preventing it is either forbidden by
 *    §4.2 or larger than the problem.
 * 3. NO `business_date`, diverging from the DBML and from foundation §5.2.
 *    Prices carry over until changed. Spec §8.1 records what that costs: §4.5
 *    stops being a DAILY mechanism, day-to-day availability rests entirely on
 *    the network-wide `product_grades.is_active`, and a stale price now fails
 *    silently and in the buyer's disfavour.
 *
 * `set_at` from the DBML is gone too: with it server-assigned it held the same
 * instant as `created_at` in every row forever, and the schema's header forbids
 * two copies of one fact. `set_by_user_id` was renamed `created_by_user_id` to
 * match.
 *
 * `max_markup` AND `max_discount` ARE POSITIVE MAGNITUDES. `max_markup = 30`
 * means `bonus <= +30`; `max_discount = 20` means `bonus >= -20`. Storing the
 * discount as -20 reads naturally here and inverts a comparison at the call
 * site; this is the form that was picked, and this comment is where it is
 * written down. They close §2.9's admitted hole — «межа мережі ±30 ₴/кг обрізає
 * bonus, але самої межі в цій схемі поки НЕМАЄ де зберігати» — split into two
 * independent numbers because a premium and a docking for «мʼята чи цвіла
 * ягода» have no reason to share a limit.
 *
 * BOTH ARE NOT NULL, and that is load-bearing. Nullable would make `null` mean
 * either "no limit" or "inherit a default", which is the `target_crates` trap
 * the DBML warns about twice: «читач, який бачить голий nullable int,
 * відтворить заборону, якої правило не просить». `0` is legal and means "no
 * adjustment permitted"; "unlimited" is inexpressible, which is correct.
 *
 * NOTHING IN THIS SLICE READS THE TWO LIMITS. The clamp lives in
 * `intake_items`, which does not exist yet. They are stored and constrained,
 * and no test here can prove they do anything — `intakes` owes that test.
 *
 * All three money columns are `numeric`, therefore STRINGS in TypeScript,
 * never numbers. No arithmetic is performed on them anywhere in this module.
 */
@Entity('grade_prices')
@Check('CHK_grade_prices_base_price', `"base_price" >= 0`)
@Check('CHK_grade_prices_max_markup', `"max_markup" >= 0`)
@Check('CHK_grade_prices_max_discount', `"max_discount" >= 0`)
@Index('IDX_grade_prices_lookup', ['collection_point_id', 'product_grade_id', 'created_at'])
export class GradePrice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  collection_point_id: string;

  @ManyToOne(() => CollectionPoint, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'collection_point_id' })
  collection_point: CollectionPoint;

  /** §4.1 — the price key is the GRADE; the reporting key is the product. */
  @Column({ type: 'uuid' })
  product_grade_id: string;

  @ManyToOne(() => ProductGrade, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_grade_id' })
  product_grade: ProductGrade;

  /** `numeric` — a STRING in TypeScript, never a number. */
  @Column({ type: 'numeric', precision: 10, scale: 2 })
  base_price: string;

  /** Positive magnitude: `bonus <= +max_markup`. */
  @Column({ type: 'numeric', precision: 10, scale: 2 })
  max_markup: string;

  /** Positive magnitude: `bonus >= -max_discount`. */
  @Column({ type: 'numeric', precision: 10, scale: 2 })
  max_discount: string;

  @Column({ type: 'uuid' })
  created_by_user_id: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by_user_id' })
  created_by: User;

  /** §4.2's worked example — «конкуренти підняли». */
  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
```

Create `backend/src/grade-prices/grade-price.mapper.ts`:

```ts
import { GradePrice } from './grade-price.entity';

/** All three money values are STRINGS on the wire — `numeric` is carried end
 *  to end so no value ever passes through a binary float. */
export interface GradePriceResponse {
  id: string;
  collection_point_id: string;
  product_grade_id: string;
  base_price: string;
  max_markup: string;
  max_discount: string;
  created_by_user_id: string;
  reason: string | null;
  created_at: string;
}

/**
 * Accepts an entity OR a raw row from the `DISTINCT ON` query in
 * `GradePricesService.current()`. `SELECT gp.*` returns the same column names
 * as the entity's properties and the `pg` driver returns `timestamptz` as a
 * `Date` and `numeric` as a `string`, so the two shapes coincide — which is
 * why one mapper serves both reads.
 */
export function toGradePriceResponse(price: GradePrice): GradePriceResponse {
  return {
    id: price.id,
    collection_point_id: price.collection_point_id,
    product_grade_id: price.product_grade_id,
    base_price: price.base_price,
    max_markup: price.max_markup,
    max_discount: price.max_discount,
    created_by_user_id: price.created_by_user_id,
    reason: price.reason,
    created_at: price.created_at.toISOString(),
  };
}
```

- [ ] **Step 5: Write the DTOs**

Create `backend/src/grade-prices/dto/create-grade-price.dto.ts`:

```ts
import { IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { CanonicalDecimal } from '../../common/dto/canonical-decimal';

/**
 * `collection_point_id` IS ACCEPTED FROM THE BODY, and that is a documented
 * exception to `point-scope.ts`'s rule that a point is derived from the actor
 * and «never accepted from a request body». Price writes are OWNER-ONLY and an
 * owner has no point, so there is nothing to derive it from;
 * `assertOwnsPoint` validates it in the service (an owner may act on any
 * point). This is the first caller to take that branch.
 *
 * All three numbers are REQUIRED. `max_markup` and `max_discount` have no
 * default anywhere and nothing to inherit from — see `GradePrice`'s doc
 * comment for why nullable would reopen the `target_crates` trap.
 *
 * All three are `numeric(10,2)` — 8 integer digits — carried as STRINGS. The
 * pattern accepts no sign, which is the first half of "zero yes, negative no";
 * the three CHECK constraints are the real guarantee.
 *
 * `@CanonicalDecimal()` sits below `@Matches` on all three so `'52'` is stored
 * and echoed as `'52.00'`, the exact scale Postgres holds it at. Without it,
 * `POST` answers `{"base_price":"52"}` while the next `GET` answers
 * `{"base_price":"52.00"}` for the same row — unequal as strings, and these
 * values are compared as strings, never as numbers.
 */
export class CreateGradePriceDto {
  @IsUUID()
  collection_point_id: string;

  @IsUUID()
  product_grade_id: string;

  @Matches(/^\d{1,8}(\.\d{1,2})?$/, {
    message: 'base_price must be a decimal string with at most 2 decimal places',
  })
  @CanonicalDecimal()
  base_price: string;

  @Matches(/^\d{1,8}(\.\d{1,2})?$/, {
    message: 'max_markup must be a decimal string with at most 2 decimal places',
  })
  @CanonicalDecimal()
  max_markup: string;

  @Matches(/^\d{1,8}(\.\d{1,2})?$/, {
    message: 'max_discount must be a decimal string with at most 2 decimal places',
  })
  @CanonicalDecimal()
  max_discount: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
```

Create `backend/src/grade-prices/dto/current-grade-prices.query.ts`:

```ts
import { IsOptional, IsUUID } from 'class-validator';
import { CatalogPaginationQueryDto } from '../../common/dto/catalog-pagination-query.dto';
import { BooleanQueryParam } from '../../common/dto/boolean-query-param';

/**
 * The PICKER read — one row per grade, for the operator's intake screen.
 * `CatalogPaginationQueryDto` (default 100), because this is bounded by the
 * grade count and silent truncation in a picker is the one outcome that is not
 * acceptable.
 *
 * NAMED LIMIT: an OWNER calling this with no point filter gets
 * `points × grades` rows — 5 points × 30 grades is 150, above `@Max(100)`. The
 * owner's price screen must therefore fetch one point at a time. `total` in
 * the envelope makes that visible rather than silent; the client compares
 * `data.length` against `total` and warns.
 *
 * `include_inactive` exists so the owner's price screen still shows the last
 * price of a grade retired mid-season.
 */
export class CurrentGradePricesQueryDto extends CatalogPaginationQueryDto {
  @IsOptional()
  @IsUUID()
  collection_point_id?: string;

  @BooleanQueryParam()
  include_inactive?: boolean;
}
```

Create `backend/src/grade-prices/dto/list-grade-prices.query.ts`:

```ts
import { IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

/**
 * The JOURNAL read — every row, newest first, for an owner auditing a price
 * move. `PaginationQueryDto` (default 20): this list is unbounded and grows
 * forever, so it is browsable, not a picker.
 *
 * NO `include_inactive`. The journal is history, and history is not filtered
 * by the current state of the thing it describes.
 */
export class ListGradePricesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  collection_point_id?: string;

  @IsOptional()
  @IsUUID()
  product_grade_id?: string;
}
```

- [ ] **Step 6: Write the service**

Create `backend/src/grade-prices/grade-prices.service.ts`:

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GradePrice } from './grade-price.entity';
import { CreateGradePriceDto } from './dto/create-grade-price.dto';
import { ListGradePricesQueryDto } from './dto/list-grade-prices.query';
import { CurrentGradePricesQueryDto } from './dto/current-grade-prices.query';
import { GradePriceResponse, toGradePriceResponse } from './grade-price.mapper';
import { CollectionPointsService } from '../collection-points/collection-points.service';
import { ProductGradesService } from '../products/product-grades.service';
import { assertOwnsPoint, resolvePointFilter } from '../auth/access/point-scope';
import { Paginated } from '../common/dto/paginated';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * NO `AuditService` AND NO `DataSource` HERE, AND BOTH ABSENCES ARE ARGUED FOR.
 *
 * The catalog slice's reason for auditing `tare_types` is explicitly
 * conditional — «keeps no history of its own… the audit log is the only place
 * that fact can live» — and the condition FAILS here: this table IS the
 * history. An `audit_log` row would carry the actor (already
 * `created_by_user_id`), the timestamp (already `created_at`), the reason
 * (already `reason`) and a diff reconstructible from two adjacent journal
 * rows. Four duplicated facts, in a schema whose header declares «два
 * примірники одного факту в цьому проєкті заборонені».
 *
 * With no audit write there is no second write to keep atomic, so `create()`
 * is a single `insert` and needs no transaction. Do not add one "for
 * consistency" — there is nothing to be consistent with.
 *
 * NAMED COST: `audit_log` is the single cross-cutting "what did this person
 * change last Tuesday" view, and prices are a hole in it. Cheap to close later
 * with an audit READER that unions this journal; duplicated rows written today
 * could never be un-written.
 */
@Injectable()
export class GradePricesService {
  constructor(
    @InjectRepository(GradePrice)
    private readonly repo: Repository<GradePrice>,
    private readonly points: CollectionPointsService,
    private readonly grades: ProductGradesService,
  ) {}

  /**
   * The CURRENT price per grade: `DISTINCT ON` the pair, newest first. This is
   * the read the intake screen makes, and `IDX_grade_prices_lookup` exists for
   * exactly this shape.
   *
   * Raw SQL rather than the query builder because `DISTINCT ON` has no
   * TypeORM expression, and the count must be taken over the DISTINCT result
   * rather than the underlying rows — a `findAndCount` here would report the
   * size of the whole journal as the number of current prices.
   */
  async current(
    actor: AuthenticatedUser,
    query: CurrentGradePricesQueryDto,
  ): Promise<Paginated<GradePriceResponse>> {
    const pointId = resolvePointFilter(actor, query.collection_point_id);

    const params: unknown[] = [];
    const conditions: string[] = [];
    if (pointId) {
      params.push(pointId);
      conditions.push(`gp.collection_point_id = $${params.length}`);
    }
    // §4.5 — a grade the network has retired is not offered at intake. The
    // owner's price screen passes include_inactive to see its last price.
    if (!query.include_inactive) conditions.push(`pg.is_active = true`);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // DISTINCT ON must key on the PAIR, not the grade alone: an owner with no
    // point filter spans every point, and keying on the grade alone would
    // collapse five points' prices into one arbitrary row.
    const latest = `
      SELECT DISTINCT ON (gp.collection_point_id, gp.product_grade_id) gp.*
        FROM grade_prices gp
        JOIN product_grades pg ON pg.id = gp.product_grade_id
        ${where}
       ORDER BY gp.collection_point_id, gp.product_grade_id, gp.created_at DESC`;

    const [countRow] = await this.repo.manager.query(
      `SELECT count(*)::int AS count FROM (${latest}) t`,
      params,
    );
    const rows: GradePrice[] = await this.repo.manager.query(
      `SELECT * FROM (${latest}) t
        ORDER BY t.collection_point_id, t.product_grade_id
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.limit, (query.page - 1) * query.limit],
    );

    return {
      data: rows.map(toGradePriceResponse),
      total: countRow.count,
      page: query.page,
      limit: query.limit,
    };
  }

  /** The raw journal — every row, newest first. §4.2's history, readable. */
  async list(
    actor: AuthenticatedUser,
    query: ListGradePricesQueryDto,
  ): Promise<Paginated<GradePriceResponse>> {
    const pointId = resolvePointFilter(actor, query.collection_point_id);

    const where: Record<string, unknown> = {};
    if (pointId) where.collection_point_id = pointId;
    if (query.product_grade_id) where.product_grade_id = query.product_grade_id;

    const [data, total] = await this.repo.findAndCount({
      where,
      order: { created_at: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    return { data: data.map(toGradePriceResponse), total, page: query.page, limit: query.limit };
  }

  /**
   * Appends one row. There is no update path on this table at all — §4.2,
   * «записи не перетираються, а додаються».
   *
   * §4.8's «поставити всім» bulk gesture is NOT here and is deferred to its
   * own route. WHEN IT IS BUILT, THE CARVE-OUT BELONGS ON THE SERVER: «склад
   * це звичайний пункт прийому зі своєю, вищою ціною, якого жест "поставити
   * всім" НЕ чіпає». Take the target as INTENT — `{ kind:
   * 'all_reception_points' }` expanded here to active points with `kind =
   * 'reception'` — not as an array of point ids from the client, or §4.8 ends
   * up in the browser where no test can reach it.
   */
  async create(actor: AuthenticatedUser, dto: CreateGradePriceDto): Promise<GradePriceResponse> {
    assertOwnsPoint(actor, dto.collection_point_id);

    const point = await this.points.findOneRaw(dto.collection_point_id);
    if (!point) throw new NotFoundException('Collection point not found');

    const grade = await this.grades.findOneRaw(dto.product_grade_id);
    if (!grade) throw new NotFoundException('Product grade not found');
    // REJECTED, never silently skipped: a dropped grade looks like success.
    if (!grade.is_active) {
      throw new BadRequestException({
        message: 'That grade is inactive and cannot be priced',
        code: 'PRODUCT_GRADE_INACTIVE',
      });
    }

    const price = await this.repo.save(
      this.repo.create({
        collection_point_id: dto.collection_point_id,
        product_grade_id: dto.product_grade_id,
        // Stored verbatim as strings. No arithmetic anywhere in this module.
        base_price: dto.base_price,
        max_markup: dto.max_markup,
        max_discount: dto.max_discount,
        created_by_user_id: actor.sub,
        reason: dto.reason ?? null,
      }),
    );

    return toGradePriceResponse(price);
  }
}
```

- [ ] **Step 7: Run the spec to verify it passes**

Run: `npm test -w backend -- grade-prices.service.spec`
Expected: PASS.

- [ ] **Step 8: Lint and commit**

```bash
npm run lint -w backend
git add backend/src/grade-prices backend/src/products/product-grades.service.ts
git commit -m "feat(grade-prices): append-only price journal with markup and discount limits"
```

---

## Task 6: Grade prices HTTP surface

**Files:**
- Create: `backend/src/grade-prices/grade-prices.controller.ts`, `backend/src/grade-prices/grade-prices.module.ts`
- Modify: `backend/src/app.module.ts` (imports array, after `SuppliersModule`)
- Test: `backend/src/testing/pipeline.db-spec.ts` (three tests appended to the `suppliers + grade prices (HTTP)` block from Task 4)

**Interfaces:**
- Consumes: `GradePricesService` (Task 5); `CollectionPointsModule` and `ProductsModule` (both already export their services).
- Produces: `GradePricesModule`; routes `GET /grade-prices/current`, `GET /grade-prices`, `POST /grade-prices`.

- [ ] **Step 1: Write the failing HTTP tests**

Append these three tests inside the existing `describe('suppliers + grade prices (HTTP)', …)` block created in Task 4 — its fixtures (`ownerToken`, `operatorToken`, `pointA`, `gradeId`) are already in scope.

```ts
  it('lets the OWNER set a price and the OPERATOR read it back as the current one', async () => {
    await request(app.getHttpServer())
      .post('/grade-prices')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        collection_point_id: pointA,
        product_grade_id: gradeId,
        base_price: '52',
        max_markup: '30',
        max_discount: '20',
        reason: 'конкуренти підняли',
      })
      .expect(201);

    // A second row for the same pair — §4.2's history. No UNIQUE forbids it,
    // and the LATER one must win.
    await request(app.getHttpServer())
      .post('/grade-prices')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        collection_point_id: pointA,
        product_grade_id: gradeId,
        base_price: '55',
        max_markup: '30',
        max_discount: '20',
      })
      .expect(201);

    const current = await request(app.getHttpServer())
      .get('/grade-prices/current')
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);

    const row = current.body.data.find(
      (p: { product_grade_id: string }) => p.product_grade_id === gradeId,
    );
    // '55' in, '55.00' out — @CanonicalDecimal() plus numeric(10,2), carried
    // as a STRING the whole way.
    expect(row).toMatchObject({ base_price: '55.00', max_markup: '30.00' });
    expect(typeof row.base_price).toBe('string');

    // Both rows survive in the journal; nothing was overwritten.
    const journal = await request(app.getHttpServer())
      .get(`/grade-prices?product_grade_id=${gradeId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(journal.body.total).toBeGreaterThanOrEqual(2);
    expect(journal.body.data[0].base_price).toBe('55.00');
  });

  it('403s an operator trying to set a price', async () => {
    // The one assertion proving the owner-only split reached the decorators.
    await request(app.getHttpServer())
      .post('/grade-prices')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        collection_point_id: pointA,
        product_grade_id: gradeId,
        base_price: '99',
        max_markup: '30',
        max_discount: '20',
      })
      .expect(403);
  });

  it('400s on a negative limit before it reaches the CHECK constraint', async () => {
    await request(app.getHttpServer())
      .post('/grade-prices')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        collection_point_id: pointA,
        product_grade_id: gradeId,
        base_price: '52',
        max_markup: '-1',
        max_discount: '20',
      })
      .expect(400);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:db -w backend -- pipeline`
Expected: FAIL — 404 on `POST /grade-prices`.

- [ ] **Step 3: Write the controller**

Create `backend/src/grade-prices/grade-prices.controller.ts`:

```ts
import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../users/user-role.enum';
import { GradePricesService } from './grade-prices.service';
import { CreateGradePriceDto } from './dto/create-grade-price.dto';
import { ListGradePricesQueryDto } from './dto/list-grade-prices.query';
import { CurrentGradePricesQueryDto } from './dto/current-grade-prices.query';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * TWO READ ROUTES, NOT ONE FLAGGED ROUTE. They serve different readers at
 * different volumes and, decisively, with different pagination profiles:
 * `/current` is a bounded picker (`CatalogPaginationQueryDto`, default 100),
 * `/grade-prices` is an unbounded browsable journal (`PaginationQueryDto`,
 * default 20). A single handler switching its own pagination default on a
 * boolean is the thing that gets misread later.
 *
 * NO `PATCH`, NO `DELETE`, NO `GET /:id`. A correction is a new row (§4.2),
 * and no client holds a bare price id.
 *
 * Reads are open to BOTH roles: the operator's intake screen needs
 * `base_price` to price a line and `max_markup`/`max_discount` to bound the
 * `bonus` they type. Writes are owner-only — everything configurable belongs
 * to the керівник (§10.1).
 *
 * `POST` takes `collection_point_id` FROM THE BODY, which is a documented
 * exception to `point-scope.ts`'s «never accepted from a request body». The
 * route is owner-only and an owner has no point, so there is nothing to derive
 * it from; `assertOwnsPoint` in the service validates it. This is the first
 * caller to take that branch — see `CreateGradePriceDto`'s doc comment.
 */
@Controller('grade-prices')
export class GradePricesController {
  constructor(private readonly prices: GradePricesService) {}

  /** Declared BEFORE the bare `@Get()`: Nest matches routes in declaration
   *  order, and a `@Get(':id')` added here later would otherwise swallow
   *  `/current`. There is no `:id` route today; the ordering is kept so adding
   *  one cannot break this silently. */
  @Get('current')
  @Auth()
  current(@CurrentUser() actor: AuthenticatedUser, @Query() query: CurrentGradePricesQueryDto) {
    return this.prices.current(actor, query);
  }

  @Get()
  @Auth()
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListGradePricesQueryDto) {
    return this.prices.list(actor, query);
  }

  @Post()
  @Auth(UserRole.NetworkOwner)
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateGradePriceDto) {
    return this.prices.create(actor, dto);
  }
}
```

- [ ] **Step 4: Write the module and register it**

Create `backend/src/grade-prices/grade-prices.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GradePrice } from './grade-price.entity';
import { GradePricesService } from './grade-prices.service';
import { GradePricesController } from './grade-prices.controller';
import { CollectionPointsModule } from '../collection-points/collection-points.module';
import { ProductsModule } from '../products/products.module';

/**
 * Depends on `ProductsModule` and `CollectionPointsModule` for READS ONLY —
 * validating that a grade exists and is active, and that a point exists. The
 * dependency points one way and each module stays the sole WRITER of its own
 * tables.
 *
 * No `AuditModule`: this table is its own history. See
 * `GradePricesService`'s doc comment for the full argument.
 */
@Module({
  imports: [TypeOrmModule.forFeature([GradePrice]), CollectionPointsModule, ProductsModule],
  controllers: [GradePricesController],
  providers: [GradePricesService],
  exports: [TypeOrmModule, GradePricesService],
})
export class GradePricesModule {}
```

In `backend/src/app.module.ts`, add the import and register it after `SuppliersModule`:

```ts
import { GradePricesModule } from './grade-prices/grade-prices.module';
```

```ts
    SuppliersModule,
    GradePricesModule,
    AuditModule,
```

- [ ] **Step 5: Run both suites in full**

Run: `npm test -w backend && npm run test:db -w backend`
Expected: PASS — every spec, old and new.

- [ ] **Step 6: Verify the entity metadata matches the migration**

Run: `DB_NAME=app_test npm run migration:generate -w backend -- src/migrations/DriftCheck`

Expected: it reports **no changes** and writes nothing. Delete anything it produces; do **not** commit it.

```bash
rm -f backend/src/migrations/*DriftCheck.ts
```

**Two decorators here may legitimately fail to round-trip, and the fix is to remove them, not to change the SQL.** The migration is the source of truth; entity metadata is only there to keep this tool quiet.

- **`@Index('IDX_grade_prices_lookup', […])` cannot express `created_at DESC`.** The array form carries column names only. If the tool proposes dropping and recreating this index, delete the `@Index` decorator from `GradePrice` and add to its doc comment: `NO @Index: IDX_grade_prices_lookup is DESC on created_at, which TypeORM's array form cannot express — it lives only in the migration.` The descending order is what makes it serve "newest row for this pair" as an index-only lookup, so the SQL keeps it.
- **`@Check('CHK_suppliers_phone_e164', …)` may not match Postgres' normalized expression text.** Postgres rewrites check expressions when it stores them. If the tool proposes recreating this constraint, delete the `@Check` decorator from `Supplier` and record in its doc comment that the constraint lives in the migration.

This is the same discipline the catalog slice established for its `lower(name)` indexes — *"the entities carry no decorator, and each entity's doc comment names where its constraint actually lives"* — applied to the two expressions that turn out to be inexpressible here. Removing a decorator changes nothing at runtime: the constraint is already in the database, and `suppliers-prices-schema.db-spec.ts` proves it works.

- [ ] **Step 7: Lint and commit**

```bash
npm run lint -w backend
git add backend/src/grade-prices backend/src/app.module.ts backend/src/testing/pipeline.db-spec.ts
git commit -m "feat(grade-prices): expose current-price and journal routes"
```

---

## Task 7: Documentation and follow-ups

The slice is not done when the code passes. Three documents describe this codebase to the next reader, and all three are now wrong.

**Files:**
- Modify: `backend/CLAUDE.md` (the `src/` structure block and the Migrations section)
- Modify: `CLAUDE.md` (the Architecture → Domain line)
- Modify: `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md` (new section)

**Interfaces:** none — documentation only.

- [ ] **Step 1: Update `backend/CLAUDE.md`**

In the `src/` tree block, add two lines after the `tare-types/` entry (create it if the catalog slice's entry is missing):

```
  suppliers/              # point-scoped supplier records — OPERATOR-writable (the only module whose writes are not owner-only), phone canonicalized to E.164
  grade-prices/           # append-only price journal — current price is the newest row per (point, grade); carries §2.9's max_markup/max_discount
```

In the **Migrations** section, add `YagodaSuppliersAndPrices` to the list of migrations named in the `migrations/` line.

Add this bullet to **Key conventions**, after the `numeric` bullet:

```
- **A phone number is stored canonical (E.164) and nothing else.** `src/suppliers/phone.ts` is the only place one is normalized, and `CHK_suppliers_phone_e164` is the real guarantee — the function only produces the friendly 400. This DIVERGES from the catalog's "store exactly as typed, compare case-insensitively" rule on purpose: a name's capitalization is content, a phone's dashes are presentation. See the spec's §5.7.
```

- [ ] **Step 2: Update the root `CLAUDE.md`**

Replace the **Domain** line under Architecture with:

```
- **Domain:** the schema of record is `28-db-schema.dbml` (repo root). Implemented so far: `users`, `collection_points` (foundation slice), `products`, `product_grades`, `tare_types` (catalog slice), `suppliers`, `grade_prices` (this slice). Ten tables remain, all of them documents: `shifts`, `intakes`, `intake_items`, `intake_item_tare_types`, `payouts`, `crate_issuances`, `crate_returns`, `crate_return_allocations`, `cash_counts`, `transfers`. Specs live in `docs/superpowers/specs/`.
```

- [ ] **Step 3: Record this slice's follow-ups**

Append to `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md`:

```markdown
## New, from the suppliers & prices slice (2026-09-07)

- **Per-point grade acceptance does not exist.** `product_grades.is_active` is
  network-wide, and with `business_date` removed there is no longer any
  per-point way to stop buying a grade: once priced at a point it is offered
  there forever. The DBML rejected an `is_enabled` field, but its reasoning
  («відсутність рядка і є вимкненням») depended on the daily row this slice
  removed. Closable additively — `is_accepted boolean NOT NULL DEFAULT true`
  on the price row, latest row per (point, grade) deciding both price and
  acceptance. Accepted because the network currently buys one assortment
  everywhere. Spec §5.4.

- **The §4.8 «поставити всім» bulk price route is not built.** When it is: the
  склад carve-out belongs SERVER-side. Take the target as intent
  (`{ kind: 'all_reception_points' }`, expanded to active `kind = 'reception'`
  points) rather than an array of point ids from the client, or the rule ends
  up in the browser where no test reaches it. Spec §5.5.

- **`max_markup` and `max_discount` are written and never read.** Nothing
  clamps `intake_items.bonus` against them because `intake_items` does not
  exist. They are proven stored and proven non-negative and nothing more; the
  `intakes` slice owes the test that they constrain anything. Spec §5.2.

- **Supplier search is a sequential scan within one point.** The phone suffix
  `LIKE` and the name substring `ILIKE` both ignore
  `IDX_suppliers_point_last_name`. Fine at hundreds of suppliers per point;
  the answer at low tens of thousands is a `pg_trgm` GIN index, which is
  additive. Judgement, not measurement — no benchmark was run. Spec §6.5.

- **`grade_prices` is a hole in the cross-cutting audit view.** It writes no
  `audit_log` entries, deliberately (the table is its own history — spec §9),
  so "what did this person change last Tuesday" misses price moves. Closable
  with an audit READER that unions the journal.

- **A supplier rename reassigns a money balance, unguarded.** Debt follows
  `supplier_id`, not the name, and правка 6 cancelled the merge tool. The
  audit before/after diff is the only trail. A guard was considered and
  rejected: every version also blocks fixing a typo, which is the common case.
  Spec §5.6.

- **`CollectionPointsService` still records audit entries outside a
  transaction.** Now five modules to one. `SuppliersService` uses the
  `EntityManager` seam like the three catalog services. Align during the admin
  UI slice.
```

- [ ] **Step 4: Final verification**

```bash
npm test -w backend && npm run test:db -w backend && npm run lint -w backend && npm run build -w backend
```

Expected: all four PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/CLAUDE.md CLAUDE.md docs/superpowers/2026-09-05-foundation-slice-follow-ups.md
git commit -m "docs: record the suppliers and prices slice and its follow-ups"
```

---

## Notes for the executor

**Two traps this codebase has already sprung on someone, both worth re-reading before you start:**

1. **`app_test` persists and these specs never truncate.** A `*.db-spec.ts` written before its migration exists will insert rows that survive the run. On the next run, a duplicate-key error from the *wrong* insert is indistinguishable from the one being asserted. Every fixture value in Task 2 carries a per-run `randomUUID()` for this reason — do not simplify them to literals. The `db-harness.ts` comment claiming these specs TRUNCATE is stale and contradicts both existing db-specs; it is already on the follow-ups list.

2. **Regexes inside a migration's template literal.** `\+` collapses to `+` and `\d` collapses to `d` before Postgres sees the string. Task 2 uses `[+]` and `[0-9]` so no escaping is involved. If you ever write `\d` in migration SQL, the constraint you create will match a literal letter `d` and will silently reject every real value.

**Two things that are decisions, not omissions. Do not "fix" them:**

- `grade_prices` has no `updated_at` and no `UNIQUE (collection_point_id, product_grade_id)`. A test asserts the absence of the second one, because a helpful `migration:generate` run that adds it would destroy §4.2's history.
- `grade_prices` writes nothing to `audit_log`, and therefore `create()` uses no transaction. The table is its own history.

**Task order matters in one place only:** Task 5 adds `ProductGradesService.findOneRaw`, which Task 5's own service consumes. Everything else is independent — Tasks 3–4 (suppliers) and Tasks 5–6 (grade prices) touch no shared file except `app.module.ts` and `pipeline.db-spec.ts`, so they could be built in either order, but the plan's sequence keeps those two files conflict-free.

# Intake Top-Ups Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a network owner add a fixed, reasoned sum to one supplier's debt against an existing intake, so berries already received can be paid at a price agreed after the receipt was printed.

**Architecture:** A new table `intake_top_ups` hangs off `intakes` with a `NOT NULL` FK and stores no supplier, shift, point or date of its own — all four are derived through the parent, exactly as `intakes` and `payouts` derive point and business date from `shifts`. Supplier debt gains a third term inside the single existing `debtSql` helper, so the payout ceiling and both balance endpoints inherit it with no change of their own. A voided parent intake neutralises its top-ups through that join without any cascading write.

**Tech Stack:** NestJS 10, TypeORM (`synchronize: false`, migrations run on startup), PostgreSQL 16, Jest (`*.spec.ts` unit, `*.db-spec.ts` against real Postgres), class-validator + class-transformer.

**Spec:** `docs/superpowers/specs/2026-09-11-yagoda-intake-top-ups-slice.md` — read it before Task 1. Every `§` reference below without a document name points into it. References like `§2.7` and `§9.3` with a rules flavour point into `26-rules-by-example.md`; the spec quotes each one it relies on.

## Global Constraints

- **`numeric` is a string end to end.** Foundation §5.1 — no `Number()`, `parseFloat`, `parseInt`, `toFixed`, `*` or `/` on a monetary value anywhere. Comparison and arithmetic go through `src/common/money.ts`. Task 7 adds this module to the eslint guard that enforces it.
- **`amount` is strictly positive.** `CHECK ("amount" > 0)`. Negative top-ups are refused by decision (spec §3.3); the downward path is §9.3 void-and-reissue of the receipt.
- **Documents are never edited.** No `PATCH`, no update path. The only mutating verb after insert is `void`, which writes nothing but the trio `voided_at` / `voided_by_user_id` / `void_reason`.
- **Void requires a reason.** Reuse `src/intakes/dto/void-document.dto.ts` (`VoidDocumentDto`) unchanged — it is already shared by `intakes`, `payouts` and `transfers`.
- **Role split:** create and void are `@Auth(UserRole.NetworkOwner)`. Reads are `@Auth()` and scoped with `resolvePointFilter`.
- **Error codes:** `TOP_UP_AMOUNT_NOT_POSITIVE` (400), `ALREADY_VOIDED` (409), `NOT_FOUND` via `NotFoundException('Intake top-up not found')`. Another point's row is a **404, never a 403** — these rows carry a person's name and a money amount, so their existence must not be confirmed.
- **Migration numbering:** the next free timestamp is `1788600000011`. The latest applied is `1788600000010-DropCashCountExpectedCheck.ts`.
- **Commit style:** conventional commits, scope `top-ups`. End every commit message with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **Branch:** work continues on `feat/61-payment-adjustments`. Do not create a worktree.

## File Structure

| File | Responsibility |
|---|---|
| `backend/src/migrations/1788600000011-YagodaIntakeTopUps.ts` | Create the table, its two CHECKs, its FKs and its index |
| `backend/src/intake-top-ups/intake-top-up.entity.ts` | The row; carries the CHECK and index decorators mirroring the migration |
| `backend/src/intake-top-ups/dto/create-intake-top-up.dto.ts` | `{ intake_id, amount, reason }` |
| `backend/src/intake-top-ups/dto/list-intake-top-ups.query.ts` | Pagination + `collection_point_id`, `supplier_id`, `intake_id`, `include_voided` |
| `backend/src/intake-top-ups/intake-top-up.mapper.ts` | `IntakeTopUpResponse` + `counts_toward_balance` |
| `backend/src/intake-top-ups/intake-top-ups.service.ts` | Create, void, findOne, list |
| `backend/src/intake-top-ups/intake-top-ups.controller.ts` | Four routes |
| `backend/src/intake-top-ups/intake-top-ups.module.ts` | Wiring |
| `backend/src/supplier-balance/supplier-balance.service.ts` | **Modify** — the third term in `debtSql` |
| `backend/src/audit/audit-log.entity.ts` | **Modify** — two new `AUDIT_ACTIONS` members |
| `backend/src/app.module.ts` | **Modify** — register the module |
| `backend/eslint.config.mjs` | **Modify** — the money guard's `files` list |
| `backend/src/seed/dev-seed.ts`, `dev-seed.data.ts` | **Modify** — one seeded top-up |
| `28-db-schema.dbml`, `CLAUDE.md` | **Modify** — the schema of record (spec §12) |

Tests live beside their subject, per the repo's convention: `intake-top-ups.service.spec.ts` (mocked), `intake-top-ups-schema.db-spec.ts` and `intake-top-ups-balance.db-spec.ts` (real Postgres), and an extension to `src/testing/documents-pipeline.db-spec.ts`.

**Run tests with:** `npm test` (unit, from `backend/`) and `npm run test:db` (database specs — these need Postgres up; `docker compose up -d postgres` from the repo root).

---

### Task 1: The table

**Files:**
- Create: `backend/src/intake-top-ups/intake-top-up.entity.ts`
- Create: `backend/src/migrations/1788600000011-YagodaIntakeTopUps.ts`
- Test: `backend/src/migrations/intake-top-ups-schema.db-spec.ts`

**Interfaces:**
- Consumes: `Intake` from `../intakes/intake.entity`, `User` from `../users/user.entity`.
- Produces: class `IntakeTopUp` with fields `id, intake_id, amount, reason, created_by_user_id, voided_at, voided_by_user_id, void_reason, created_at, updated_at`, and relations `intake?`, `created_by?`. Every later task imports it from `../intake-top-ups/intake-top-up.entity`.

- [ ] **Step 1: Write the failing schema spec**

Create `backend/src/migrations/intake-top-ups-schema.db-spec.ts`. Model the fixture setup on the existing `intakes-payouts-schema.db-spec.ts` in the same directory — read it first for how it opens the data source and builds a point/supplier/shift/intake chain.

```ts
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';

/**
 * `intake_top_ups` constraints, against a real Postgres. What is under test is
 * the DDL and nothing else — every assertion here fails if the migration is
 * wrong and passes regardless of what the service does.
 *
 * Per-run uuids in every fixture: the throwaway database persists between runs
 * and nothing in this file truncates.
 */
describe('intake_top_ups schema (Postgres)', () => {
  let ds: DataSource;
  let run: string;
  let intakeId: string;
  let userId: string;

  beforeAll(async () => {
    ds = await openTestDataSource();
    run = randomUUID().slice(0, 8);

    const [{ id: pointId }] = await ds.query(
      `INSERT INTO collection_points (name, kind, code) VALUES ($1, 'reception', $2) RETURNING id`,
      [`Доплати ${run}`, `T${run.slice(0, 5).toUpperCase()}`],
    );
    [{ id: userId }] = await ds.query(
      `INSERT INTO users (first_name, last_name, role)
       VALUES ('Власник', $1, 'network_owner') RETURNING id`,
      [`Тест-${run}`],
    );
    const [{ id: supplierId }] = await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name, is_active)
       VALUES ($1, 'Іван', $2, true) RETURNING id`,
      [pointId, `Тест-${run}`],
    );
    const [{ id: shiftId }] = await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date)
       VALUES ($1, $2, '2026-09-08') RETURNING id`,
      [pointId, userId],
    );
    [{ id: intakeId }] = await ds.query(
      `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id)
       VALUES ($1, $2, $3, '100.00', $4) RETURNING id`,
      [`T-IN-${run}`, shiftId, supplierId, userId],
    );
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  const insert = (amount: string, reason = 'доплата') =>
    ds.query(
      `INSERT INTO intake_top_ups (intake_id, amount, reason, created_by_user_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [intakeId, amount, reason, userId],
    );

  it('accepts a positive amount', async () => {
    const [row] = await insert('2000.00');
    expect(row.id).toEqual(expect.any(String));
  });

  it('refuses zero — a top-up that changes no debt is not a document', async () => {
    await expect(insert('0.00')).rejects.toThrow(/CHK_intake_top_ups_amount/);
  });

  it('refuses a negative amount — spec §3.3, void-and-reissue is the downward path', async () => {
    await expect(insert('-1.00')).rejects.toThrow(/CHK_intake_top_ups_amount/);
  });

  it('accepts two top-ups on one intake — §9.3 makes a correction a void plus a new row', async () => {
    await insert('10.00', 'перша');
    await expect(insert('20.00', 'друга')).resolves.toBeDefined();
  });

  it('refuses a partial void trio', async () => {
    const [row] = await insert('5.00');
    await expect(
      ds.query(`UPDATE intake_top_ups SET voided_at = now() WHERE id = $1`, [row.id]),
    ).rejects.toThrow(/CHK_intake_top_ups_void_trio/);
  });

  it('accepts a complete void trio', async () => {
    const [row] = await insert('5.00');
    await expect(
      ds.query(
        `UPDATE intake_top_ups
            SET voided_at = now(), voided_by_user_id = $2, void_reason = 'помилка'
          WHERE id = $1`,
        [row.id, userId],
      ),
    ).resolves.toBeDefined();
  });

  it('requires a reason', async () => {
    await expect(
      ds.query(
        `INSERT INTO intake_top_ups (intake_id, amount, created_by_user_id)
         VALUES ($1, '1.00', $2)`,
        [intakeId, userId],
      ),
    ).rejects.toThrow(/reason/);
  });

  it('refuses an orphan — intake_id is NOT NULL', async () => {
    await expect(
      ds.query(
        `INSERT INTO intake_top_ups (intake_id, amount, reason, created_by_user_id)
         VALUES (NULL, '1.00', 'x', $1)`,
        [userId],
      ),
    ).rejects.toThrow(/intake_id/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd backend && npm run test:db -- intake-top-ups-schema
```

Expected: every test fails with `relation "intake_top_ups" does not exist`.

- [ ] **Step 3: Write the entity**

Create `backend/src/intake-top-ups/intake-top-up.entity.ts`:

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
  UpdateDateColumn,
} from 'typeorm';
import { Intake } from '../intakes/intake.entity';
import { User } from '../users/user.entity';

/**
 * «Фантомний залишок» (#61) — a fixed sum the owner owes a supplier for berries
 * already received, at a price agreed after the receipt was printed.
 *
 * THERE IS NO `supplier_id`, NO `shift_id`, NO `collection_point_id` AND NO
 * DATE COLUMN, and all four absences are the design. The supplier arrives
 * through `intake_id`; the point arrives through the supplier (§3.9 —
 * «supplier_id уже означає точку»). Storing any of them again would be «два
 * примірники одного факту», which the DBML header forbids. The practical
 * consequence is the same one `Intake` warns about, one hop longer: SCOPING TO
 * A POINT IS A TWO-HOP JOIN — `intake_top_ups → intakes → suppliers`.
 *
 * THE `NOT NULL` ON `intake_id` IS LOad-BEARING AND NOT A STYLE CHOICE. A
 * nullable link would make this table the «вступний залишок» mechanism the
 * owner removed on 04.09.2026 — «борг, набутий до запуску, у систему не
 * заводиться взагалі». Requiring a parent means debt can only be topped up
 * where berries were actually received and recorded; it cannot be invented.
 *
 * `amount > 0`, STRICTLY. A negative row would reduce a debt without money
 * leaving the drawer, which is the «Залишок» input field §3.2 refuses «для
 * ЖОДНОЇ ролі». The downward path is §9.3's void-and-reissue of the receipt.
 * Whoever wants a signed column must also revisit the locking argument in the
 * spec's §7.4 — it is safe only because this value cannot shrink a debt.
 *
 * NO `code` COLUMN. `composeDocumentCode` exists because an operator types the
 * number printed in the paper receipt book (§6.2); a top-up has no paper twin,
 * and a synthetic code would be a forged receipt number. `transfers` made the
 * same call for the same reason.
 *
 * A VOIDED PARENT NEUTRALISES THIS ROW WITHOUT TOUCHING IT — see `debtSql` in
 * `supplier-balance.service.ts`. There is deliberately no cascade: voiding an
 * intake is something an OPERATOR may do to their own receipt (§9.4), and a
 * cascade would have that operator stamping `voided_by_user_id` on a row the
 * OWNER created.
 */
@Entity('intake_top_ups')
@Check('CHK_intake_top_ups_amount', `"amount" > 0`)
@Check(
  'CHK_intake_top_ups_void_trio',
  `num_nulls("voided_at", "voided_by_user_id", "void_reason") IN (0, 3)`,
)
@Index('IDX_intake_top_ups_intake', ['intake_id'])
export class IntakeTopUp {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  intake_id: string;

  @ManyToOne(() => Intake, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'intake_id' })
  intake?: Intake;

  /** `numeric` — a STRING, never a number (foundation §5.1). */
  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount: string;

  /** MANDATORY, and free text by decision — #61's second requirement is «щоб
   *  при перегляді історії було ясно зрозуміло, чому». Every explanation field
   *  in this schema is free text; none is enumerated. */
  @Column({ type: 'text' })
  reason: string;

  @Column({ type: 'uuid' })
  created_by_user_id: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by_user_id' })
  created_by?: User;

  @Column({ type: 'timestamptz', nullable: true })
  voided_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  voided_by_user_id: string | null;

  @Column({ type: 'text', nullable: true })
  void_reason: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
```

- [ ] **Step 4: Write the migration**

Create `backend/src/migrations/1788600000011-YagodaIntakeTopUps.ts`:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `intake_top_ups` — «фантомний залишок» (#61), the third source of supplier
 * debt.
 *
 * THIS TABLE IS NOT IN `28-db-schema.dbml`'s original seventeen. It is added by
 * the intake top-ups slice, and that slice also AMENDS the `suppliers` Note,
 * whose canonical debt SQL had two terms and now has three. If you are reading
 * this migration because the DBML and the code disagree, the DBML is the one
 * that was meant to change — see
 * `docs/superpowers/specs/2026-09-11-yagoda-intake-top-ups-slice.md` §12.
 *
 * FOUR ABSENCES THAT ARE DECISIONS, argued in the entity's header: no
 * `supplier_id`, no `shift_id`, no date column, no `code`.
 *
 * `amount > 0` is STRICTLY greater, unlike `CHK_intakes_amount`'s `>= 0`: a
 * zero top-up is a debt document that changes no debt.
 *
 * NO UNIQUE INDEX ON `intake_id`. Several top-ups on one receipt are legal and
 * necessary — §9.3 makes a correction a void plus a NEW row, so uniqueness
 * would make this the only uncorrectable record in the system.
 */
export class YagodaIntakeTopUps1788600000011 implements MigrationInterface {
  name = 'YagodaIntakeTopUps1788600000011';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "intake_top_ups" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "intake_id" uuid NOT NULL,
        "amount" numeric(12,2) NOT NULL,
        "reason" text NOT NULL,
        "created_by_user_id" uuid NOT NULL,
        "voided_at" TIMESTAMP WITH TIME ZONE,
        "voided_by_user_id" uuid,
        "void_reason" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_intake_top_ups" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_intake_top_ups_amount" CHECK ("amount" > 0),
        CONSTRAINT "CHK_intake_top_ups_void_trio"
          CHECK (num_nulls("voided_at", "voided_by_user_id", "void_reason") IN (0, 3)),
        CONSTRAINT "FK_intake_top_ups_intake" FOREIGN KEY ("intake_id")
          REFERENCES "intakes"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_intake_top_ups_created_by" FOREIGN KEY ("created_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_intake_top_ups_voided_by" FOREIGN KEY ("voided_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT
      )
    `);

    // Every read of this table arrives through its parent, including the
    // balance subquery correlated over a page of suppliers.
    await queryRunner.query(`
      CREATE INDEX "IDX_intake_top_ups_intake" ON "intake_top_ups" ("intake_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "intake_top_ups"`);
  }
}
```

- [ ] **Step 5: Run the migration and the spec**

```bash
cd backend && npm run migration:run && npm run test:db -- intake-top-ups-schema
```

Expected: migration applies; all eight tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/intake-top-ups/intake-top-up.entity.ts \
        backend/src/migrations/1788600000011-YagodaIntakeTopUps.ts \
        backend/src/migrations/intake-top-ups-schema.db-spec.ts
git commit -m "feat(top-ups): create intake_top_ups (#61)

Positive-only, reason mandatory, no code, no supplier/shift/date of its
own — all four derive through the NOT NULL parent intake. The NOT NULL
is what keeps the 04.09.2026 'no opening balance' decision true by
construction.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The third term in the debt formula

This is the slice's centre of gravity. `debtSql` is the only place any sum over these tables is written, and `payouts`' ceiling reads it — so this one edit is what makes the money payable.

**Files:**
- Modify: `backend/src/supplier-balance/supplier-balance.service.ts:27-31` (the `debtSql` constant) and its class header comment
- Test: `backend/src/supplier-balance/intake-top-ups-balance.db-spec.ts` (create)
- Test: `backend/src/supplier-balance/supplier-balance.service.spec.ts` (modify — the SQL-text assertions)

**Interfaces:**
- Consumes: the `intake_top_ups` table from Task 1.
- Produces: nothing new in TypeScript. `debtFor(supplierId, manager?)` and `list(actor, query)` keep their exact signatures; only the SQL behind them changes.

- [ ] **Step 1: Write the failing balance spec**

Create `backend/src/supplier-balance/intake-top-ups-balance.db-spec.ts`. Read the existing `supplier-balance-list.db-spec.ts` in the same directory first — copy its per-run-uuid fixture style and its `openTestDataSource` setup.

```ts
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
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd backend && npm run test:db -- intake-top-ups-balance
```

Expected: the first test fails with `Expected: "90.00", Received: "70.00"` — the top-up is not in the formula yet. The "ignores" tests pass vacuously; that is fine and expected at this stage.

- [ ] **Step 3: Add the third term**

In `backend/src/supplier-balance/supplier-balance.service.ts`, replace the `debtSql` constant:

```ts
/**
 * THE FORMULA, WRITTEN ONCE. `supplier` is the SQL naming whose debt is
 * wanted — the bind placeholder `$1` for one row, the outer row's own column
 * `s.id` when correlated down a list. Both call sites pass a code literal;
 * nothing from a request is ever spliced here.
 *
 * THE FALLBACK IS `0.00`, NOT `0`. `SUM` over no rows is NULL, and
 * `COALESCE(NULL, 0)` is an integer zero that Postgres renders as `'0'` — so
 * a supplier with no documents at all read `"0"` where every other balance
 * reads to two places. The DBML writes `0`; the wire contract (every numeric a
 * scale-2 string) is why this diverges from it by a literal.
 *
 * THE MIDDLE TERM IS THE ONE THAT REACHES ITS SUPPLIER THROUGH A JOIN.
 * `intake_top_ups` stores no `supplier_id` — it derives one from its parent
 * receipt — so the correlation runs `intake_top_ups → intakes` and filters
 * `ti.voided_at IS NULL` there. That filter is what makes a voided receipt
 * neutralise its own top-ups WITHOUT any cascading write: the money for
 * berries that were never taken stops counting the moment the receipt is
 * stamped СТОРНОВАНО. `t.voided_at IS NULL` is a SEPARATE filter guarding a
 * separate mistake — a top-up voided on its own merits — and deleting either
 * one is invisible to a test that only exercises the other.
 */
const debtSql = (supplier: string): string =>
  `(COALESCE((SELECT SUM(i.amount) FROM intakes i
               WHERE i.supplier_id = ${supplier} AND i.voided_at IS NULL), 0.00)
  + COALESCE((SELECT SUM(t.amount) FROM intake_top_ups t
                JOIN intakes ti ON ti.id = t.intake_id
               WHERE ti.supplier_id = ${supplier}
                 AND ti.voided_at IS NULL
                 AND t.voided_at  IS NULL), 0.00)
  - COALESCE((SELECT SUM(p.amount) FROM payouts p
               WHERE p.supplier_id = ${supplier} AND p.voided_at IS NULL), 0.00))`;
```

- [ ] **Step 4: Reword the class header**

In the same file, the class doc-comment opens `THE ONLY SUM OVER EITHER DOCUMENT TABLE IN THE BACKEND`. Replace that line and the paragraph under it:

```ts
/**
 * THE ONLY `SUM` OVER ANY OF THE THREE DEBT TABLES IN THE BACKEND.
 *
 * The formula follows the `suppliers` Note in `28-db-schema.dbml`, including
 * ALL THREE `voided_at IS NULL` filters, and that Note explains at length why
 * it may exist in exactly one place:
 *
 *   «фільтр voided_at IS NULL стоїть на ОБОХ історіях, і забути його на
 *    будь-якій означає або гасити борг грошима, яких не видали, або тримати
 *    борг за ягоду, якої не брали»
 *
 * THE THIRD TERM ARRIVED WITH THE INTAKE TOP-UPS SLICE (#61) and the Note was
 * amended in the same change — «обидві історії» is now three. See
 * `docs/superpowers/specs/2026-09-11-yagoda-intake-top-ups-slice.md`.
 */
```

Leave the rest of the header (the cash asymmetry, the no-point-filter rule, the nothing-is-cached paragraph, the negative-is-legal paragraph) exactly as it is — all four still hold.

- [ ] **Step 5: Fix the unit spec's SQL-text assertions**

`backend/src/supplier-balance/supplier-balance.service.spec.ts` asserts on the text of the query. Run it, read which assertions break, and update them to expect the three-term form. Add one new assertion:

```ts
it('correlates top-ups through their parent intake and filters BOTH void columns', () => {
  const sql = (manager.query as jest.Mock).mock.calls[0][0] as string;

  expect(sql).toContain('FROM intake_top_ups t');
  expect(sql).toContain('JOIN intakes ti ON ti.id = t.intake_id');
  // Regexes, not literals: these assert the two filters exist, not how the
  // SQL happens to be indented.
  expect(sql).toMatch(/ti\.voided_at\s+IS NULL/);
  expect(sql).toMatch(/\bt\.voided_at\s+IS NULL/);
});
```

- [ ] **Step 6: Run both suites**

```bash
cd backend && npm test -- supplier-balance && npm run test:db -- intake-top-ups-balance
```

Expected: all PASS, including the two "ignores" tests that were passing vacuously — they are now load-bearing.

- [ ] **Step 7: Also run the existing balance db-spec, unchanged**

```bash
cd backend && npm run test:db -- supplier-balance-list
```

Expected: PASS with no edits. Its six suppliers have no top-ups, so the third term contributes `0.00` to every one of them. **If this suite fails, the new term is wrong** — most likely the `COALESCE` fallback or the join is dropping rows.

- [ ] **Step 8: Commit**

```bash
git add backend/src/supplier-balance/
git commit -m "feat(top-ups): add the third term to the debt formula (#61)

debtSql was the only place any sum over intakes or payouts is written,
so one edit gives the payout ceiling and both balance endpoints the
top-up with no change of their own. The join to intakes is what
neutralises a top-up whose receipt was voided, without cascading.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: DTOs and mapper

**Files:**
- Create: `backend/src/intake-top-ups/dto/create-intake-top-up.dto.ts`
- Create: `backend/src/intake-top-ups/dto/list-intake-top-ups.query.ts`
- Create: `backend/src/intake-top-ups/intake-top-up.mapper.ts`
- Test: `backend/src/intake-top-ups/intake-top-up.mapper.spec.ts`

**Interfaces:**
- Consumes: `IntakeTopUp` (Task 1), `PaginationQueryDto` from `../../common/dto/pagination-query.dto`, `BooleanQueryParam` from `../../common/dto/boolean-query-param`, `CanonicalDecimal` from `../../common/dto/canonical-decimal`.
- Produces:
  - `class CreateIntakeTopUpDto { intake_id: string; amount: string; reason: string }`
  - `class ListIntakeTopUpsQueryDto extends PaginationQueryDto { collection_point_id?: string; supplier_id?: string; intake_id?: string; include_voided: boolean }`
  - `interface IntakeTopUpResponse` and `function toIntakeTopUpResponse(row: IntakeTopUp, parent: { id: string; code: string; voided_at: Date | null }): IntakeTopUpResponse`

- [ ] **Step 1: Write the failing mapper test**

Create `backend/src/intake-top-ups/intake-top-up.mapper.spec.ts`:

```ts
import { IntakeTopUp } from './intake-top-up.entity';
import { toIntakeTopUpResponse } from './intake-top-up.mapper';

const row = (over: Partial<IntakeTopUp> = {}): IntakeTopUp =>
  ({
    id: 'top-up-1',
    intake_id: 'intake-1',
    amount: '2000.00',
    reason: 'перерахували ціну після здачі',
    created_by_user_id: 'owner-1',
    voided_at: null,
    voided_by_user_id: null,
    void_reason: null,
    created_at: new Date('2026-09-11T08:00:00.000Z'),
    updated_at: new Date('2026-09-11T08:00:00.000Z'),
    ...over,
  }) as IntakeTopUp;

const parent = (voided_at: Date | null = null) => ({
  id: 'intake-1',
  code: 'KPG-IN-20260908-04412',
  voided_at,
});

describe('toIntakeTopUpResponse', () => {
  it('counts toward the balance when both the row and its parent are live', () => {
    const res = toIntakeTopUpResponse(row(), parent());

    expect(res.counts_toward_balance).toBe(true);
    expect(res.amount).toBe('2000.00');
    expect(res.intake).toEqual({
      id: 'intake-1',
      code: 'KPG-IN-20260908-04412',
      voided_at: null,
    });
  });

  it('does not count once the row itself is voided', () => {
    const res = toIntakeTopUpResponse(
      row({
        voided_at: new Date('2026-09-12T09:00:00.000Z'),
        voided_by_user_id: 'owner-1',
        void_reason: 'помилка суми',
      }),
      parent(),
    );

    expect(res.counts_toward_balance).toBe(false);
    expect(res.voided_at).toBe('2026-09-12T09:00:00.000Z');
    expect(res.void_reason).toBe('помилка суми');
  });

  it('does not count when the PARENT is voided, and says so through the parent', () => {
    const res = toIntakeTopUpResponse(row(), parent(new Date('2026-09-12T09:00:00.000Z')));

    expect(res.counts_toward_balance).toBe(false);
    expect(res.voided_at).toBeNull();
    expect(res.intake.voided_at).toBe('2026-09-12T09:00:00.000Z');
  });

  it('renders timestamps as ISO strings', () => {
    expect(toIntakeTopUpResponse(row(), parent()).created_at).toBe('2026-09-11T08:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd backend && npm test -- intake-top-up.mapper
```

Expected: FAIL — `Cannot find module './intake-top-up.mapper'`.

- [ ] **Step 3: Write the mapper**

Create `backend/src/intake-top-ups/intake-top-up.mapper.ts`:

```ts
import { IntakeTopUp } from './intake-top-up.entity';

/** The parent fields every response needs. A full `Intake` satisfies it. */
export interface ParentIntakeRef {
  id: string;
  code: string;
  voided_at: Date | null;
}

export interface IntakeTopUpResponse {
  id: string;
  amount: string;
  reason: string;
  counts_toward_balance: boolean;
  intake: { id: string; code: string; voided_at: string | null };
  created_by_user_id: string;
  created_at: string;
  voided_at: string | null;
  voided_by_user_id: string | null;
  void_reason: string | null;
}

/**
 * `counts_toward_balance` IS COMPUTED HERE RATHER THAN LEFT TO THE CLIENT, and
 * it is the one field in this response that is not a column.
 *
 * The rule it states — a top-up on a voided receipt counts for nothing — lives
 * in `debtSql`'s join. Re-deriving it in every client is how it drifts, and
 * this system already centralised `voided_at IS NULL` for exactly that reason.
 * This is NOT the second copy of a fact the DBML forbids: that ban is about
 * STORED duplicates, and this is computed per response from the same two
 * columns the balance query reads.
 *
 * The flag says WHAT; the embedded `intake` says WHY, so a reader looking at a
 * neutralised 2 000 ₴ row can see which receipt killed it.
 */
export function toIntakeTopUpResponse(
  topUp: IntakeTopUp,
  intake: ParentIntakeRef,
): IntakeTopUpResponse {
  return {
    id: topUp.id,
    amount: topUp.amount,
    reason: topUp.reason,
    counts_toward_balance: topUp.voided_at === null && intake.voided_at === null,
    intake: {
      id: intake.id,
      code: intake.code,
      voided_at: intake.voided_at ? intake.voided_at.toISOString() : null,
    },
    created_by_user_id: topUp.created_by_user_id,
    created_at: topUp.created_at.toISOString(),
    voided_at: topUp.voided_at ? topUp.voided_at.toISOString() : null,
    voided_by_user_id: topUp.voided_by_user_id,
    void_reason: topUp.void_reason,
  };
}
```

- [ ] **Step 4: Write the create DTO**

Create `backend/src/intake-top-ups/dto/create-intake-top-up.dto.ts`:

```ts
import { IsString, IsUUID, Length, Matches } from 'class-validator';
import { CanonicalDecimal } from '../../common/dto/canonical-decimal';

export class CreateIntakeTopUpDto {
  /** The receipt this money is for. MANDATORY — see `IntakeTopUp`'s header:
   *  a nullable link would make this table the opening-balance mechanism the
   *  owner removed on 04.09.2026. */
  @IsUUID()
  intake_id: string;

  /**
   * UNSIGNED BY SHAPE, and positivity is refused in the service rather than
   * here — the regex admits '0.00' so the refusal arrives as a sentence about
   * a top-up that changes no debt rather than a shape complaint. The CHECK is
   * the real guarantee; the service pre-check only keeps it a 400 instead of
   * an opaque 500, since this backend maps no QueryFailedError anywhere.
   *
   * NO UPPER BOUND, deliberately. `amount <= intakes.amount` looks right and
   * is wrong: the parent is chosen by RECENCY, so a top-up covering a week of
   * deliveries would be refused because yesterday's receipt was small.
   */
  @Matches(/^\d{1,10}(\.\d{1,2})?$/, {
    message: 'amount must be a decimal string with at most 2 decimal places',
  })
  @CanonicalDecimal()
  amount: string;

  /**
   * #61's second requirement: «щоб при перегляді історії було ясно зрозуміло,
   * чому ми маємо викладати дві тисячі цьому постачальнику».
   *
   * `@Length(1, …)` ALONE IS NOT «NON-BLANK» — it counts characters, so
   * `{"reason":"   "}` passes it and the column ends up holding whitespace on
   * a 2 000 ₴ debt entry. `\S` is the whole test. Same pair as
   * `VoidDocumentDto`, and for the same reason.
   */
  @IsString()
  @Length(1, 500)
  @Matches(/\S/, { message: 'reason must not be blank' })
  reason: string;
}
```

- [ ] **Step 5: Write the list query DTO**

Create `backend/src/intake-top-ups/dto/list-intake-top-ups.query.ts`:

```ts
import { IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { BooleanQueryParam } from '../../common/dto/boolean-query-param';

export class ListIntakeTopUpsQueryDto extends PaginationQueryDto {
  /** Ignored for an operator — `resolvePointFilter` pins them to their point.
   *  Applied through a TWO-HOP join (`intake_top_ups → intakes → suppliers`),
   *  since neither this table nor `intakes` has a point column. */
  @IsOptional()
  @IsUUID()
  collection_point_id?: string;

  @IsOptional()
  @IsUUID()
  supplier_id?: string;

  @IsOptional()
  @IsUUID()
  intake_id?: string;

  /**
   * DEFAULTS TO TRUE, matching `ListIntakesQueryDto`. §9.3 keeps a voided
   * document in the journal «НАЗАВЖДИ з печаткою "СТОРНОВАНО"», and a voided
   * top-up is no different.
   *
   * NOTE THE ASYMMETRY WITH `counts_toward_balance`: this flag hides rows the
   * OWNER voided. A row whose PARENT was voided is never hidden by it — that
   * row is still live, it simply counts for nothing, and hiding it is exactly
   * the silence the mapper's flag exists to prevent.
   */
  @BooleanQueryParam()
  include_voided: boolean = true;
}
```

- [ ] **Step 6: Run the mapper test**

```bash
cd backend && npm test -- intake-top-up.mapper
```

Expected: all four PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/intake-top-ups/dto backend/src/intake-top-ups/intake-top-up.mapper.ts \
        backend/src/intake-top-ups/intake-top-up.mapper.spec.ts
git commit -m "feat(top-ups): DTOs and response mapper (#61)

counts_toward_balance is computed server-side so the 'a top-up on a
voided receipt counts for nothing' rule lives next to the SQL that
enforces it instead of in every client.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Service — create

**Files:**
- Create: `backend/src/intake-top-ups/intake-top-ups.service.ts`
- Modify: `backend/src/audit/audit-log.entity.ts` (the `AUDIT_ACTIONS` array)
- Test: `backend/src/intake-top-ups/intake-top-ups.service.spec.ts`

**Interfaces:**
- Consumes: `IntakeTopUp`, `CreateIntakeTopUpDto`, `toIntakeTopUpResponse` (Tasks 1 and 3); `Intake` from `../intakes/intake.entity`; `AuditService` from `../audit/audit.service`; `gt` from `../common/money`; `AuthenticatedUser` from `../auth/jwt.strategy`.
- Produces: `class IntakeTopUpsService` with `create(actor: AuthenticatedUser, dto: CreateIntakeTopUpDto): Promise<IntakeTopUpResponse>`. Constructor: `(repo: Repository<IntakeTopUp>, dataSource: DataSource, audit: AuditService)`.

Read `backend/src/payouts/payouts.service.ts` before starting — this service is a smaller sibling of it, and the transaction and audit shapes should match.

- [ ] **Step 1: Add the two audit actions FIRST**

In `backend/src/audit/audit-log.entity.ts`, add to the `AUDIT_ACTIONS` array, after `'payout.return-settled'`:

```ts
  'intake-top-up.created',
  'intake-top-up.voided',
```

This comes before the service because `AuditAction` is a **closed string union** and `ts-jest` type-checks: `action: 'intake-top-up.created'` is a compile error until the union contains it, so the service's own test step cannot pass otherwise. No migration — the union is stored as `varchar` by design, precisely so "adding an action never requires a DB migration".

- [ ] **Step 2: Write the failing create tests**

Create `backend/src/intake-top-ups/intake-top-ups.service.spec.ts`:

```ts
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { IntakeTopUpsService } from './intake-top-ups.service';
import { Intake } from '../intakes/intake.entity';
import { IntakeTopUp } from './intake-top-up.entity';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

const OWNER: AuthenticatedUser = {
  sub: 'owner-1',
  role: UserRole.NetworkOwner,
  collection_point_id: null,
} as AuthenticatedUser;

const OPERATOR: AuthenticatedUser = {
  sub: 'op-1',
  role: UserRole.PointOperator,
  collection_point_id: 'point-1',
} as AuthenticatedUser;

const INTAKE = {
  id: 'intake-1',
  code: 'KPG-IN-20260908-04412',
  voided_at: null,
} as Intake;

describe('IntakeTopUpsService.create', () => {
  let service: IntakeTopUpsService;
  let manager: { findOne: jest.Mock; save: jest.Mock };
  let dataSource: { transaction: jest.Mock; manager: unknown };
  let audit: { record: jest.Mock };

  beforeEach(() => {
    manager = {
      findOne: jest.fn().mockResolvedValue(INTAKE),
      save: jest.fn().mockImplementation((_entity, row: IntakeTopUp) => ({
        ...row,
        id: 'top-up-1',
        created_at: new Date('2026-09-11T08:00:00.000Z'),
        updated_at: new Date('2026-09-11T08:00:00.000Z'),
      })),
    };
    dataSource = {
      transaction: jest.fn().mockImplementation((cb: (m: unknown) => unknown) => cb(manager)),
      manager,
    };
    audit = { record: jest.fn() };
    service = new IntakeTopUpsService({} as never, dataSource as never, audit as never);
  });

  it('writes the row and returns it counting toward the balance', async () => {
    const res = await service.create(OWNER, {
      intake_id: 'intake-1',
      amount: '2000.00',
      reason: 'перерахували ціну після здачі',
    });

    expect(res.amount).toBe('2000.00');
    expect(res.counts_toward_balance).toBe(true);
    expect(res.intake.code).toBe('KPG-IN-20260908-04412');
    expect(res.created_by_user_id).toBe('owner-1');
  });

  it('refuses an operator — #61 is «Як керівник»', async () => {
    await expect(
      service.create(OPERATOR, { intake_id: 'intake-1', amount: '10.00', reason: 'x' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('404s an unknown intake', async () => {
    manager.findOne.mockResolvedValue(null);
    await expect(
      service.create(OWNER, { intake_id: 'nope', amount: '10.00', reason: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses zero with a sentence, not a constraint violation', async () => {
    await expect(
      service.create(OWNER, { intake_id: 'intake-1', amount: '0.00', reason: 'x' }),
    ).rejects.toMatchObject({
      response: { code: 'TOP_UP_AMOUNT_NOT_POSITIVE' },
    });
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('trims the reason', async () => {
    await service.create(OWNER, {
      intake_id: 'intake-1',
      amount: '10.00',
      reason: '  доплата  ',
    });

    expect(manager.save).toHaveBeenCalledWith(
      IntakeTopUp,
      expect.objectContaining({ reason: 'доплата' }),
    );
  });

  it('SUCCEEDS against an intake in a CLOSED shift — the primary scenario of #61', async () => {
    // The service must not look at the shift at all: a top-up has no shift_id
    // and the owner is typically not at the point when they decide to top up.
    // This test is the regression guard for anyone who later "adds the missing
    // open-shift check".
    await expect(
      service.create(OWNER, { intake_id: 'intake-1', amount: '2000.00', reason: 'доплата' }),
    ).resolves.toBeDefined();
    expect(manager.findOne).toHaveBeenCalledTimes(1);
    expect(manager.findOne).toHaveBeenCalledWith(Intake, { where: { id: 'intake-1' } });
  });

  it('audits inside the same transaction', async () => {
    await service.create(OWNER, {
      intake_id: 'intake-1',
      amount: '2000.00',
      reason: 'доплата',
    });

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'intake-top-up.created',
        actor_id: 'owner-1',
        target_type: 'intake-top-up',
        target_id: 'top-up-1',
        note: 'доплата',
      }),
      manager,
    );
  });

  it('may be written against an ALREADY VOIDED intake', async () => {
    // Legal but pointless — the row will not count. Refusing it would be a
    // rule the balance formula does not have, and the mapper already tells
    // the caller it counts for nothing.
    manager.findOne.mockResolvedValue({ ...INTAKE, voided_at: new Date() } as Intake);

    const res = await service.create(OWNER, {
      intake_id: 'intake-1',
      amount: '10.00',
      reason: 'x',
    });
    expect(res.counts_toward_balance).toBe(false);
  });
});
```

- [ ] **Step 3: Run and watch it fail**

```bash
cd backend && npm test -- intake-top-ups.service
```

Expected: FAIL — `Cannot find module './intake-top-ups.service'`.

- [ ] **Step 4: Write the service with `create` only**

Create `backend/src/intake-top-ups/intake-top-ups.service.ts`:

```ts
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { IntakeTopUp } from './intake-top-up.entity';
import { CreateIntakeTopUpDto } from './dto/create-intake-top-up.dto';
import { IntakeTopUpResponse, toIntakeTopUpResponse } from './intake-top-up.mapper';
import { Intake } from '../intakes/intake.entity';
import { AuditService } from '../audit/audit.service';
import { gt } from '../common/money';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * «Фантомний залишок» (#61) — the owner's third source of supplier debt.
 *
 * THIS SERVICE NEVER LOOKS AT A SHIFT, and the absence is the feature. A
 * top-up carries no `shift_id`, so no shift rule reaches it: the owner writes
 * one against a receipt whose shift closed days ago, with no shift open
 * anywhere in the network. That is the scenario #61 describes — «після того,
 * як він уже здав» — and it is why the row hangs off an intake rather than
 * off a shift of its own, which would have forced an open shift onto an owner
 * who is not at the point.
 *
 * IT ALSO TAKES NO SUPPLIER LOCK, and that is safe only because the amount is
 * strictly positive. `PayoutsService.create` reads the ceiling under a lock on
 * the SUPPLIER row; this insert never touches that row, so the two do not
 * serialise. A payout racing a top-up computes a ceiling that is stale-LOW —
 * it refuses money that is now owed, which is retryable and never an
 * overpayment. Anyone making this column signed must add the lock in the same
 * change; see the spec's §7.4.
 */
@Injectable()
export class IntakeTopUpsService {
  constructor(
    @InjectRepository(IntakeTopUp)
    private readonly repo: Repository<IntakeTopUp>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async create(
    actor: AuthenticatedUser,
    dto: CreateIntakeTopUpDto,
  ): Promise<IntakeTopUpResponse> {
    // Owner only. #61 is written «Як керівник», and the amount is a pricing
    // decision with no operator scenario. The controller's @Auth already says
    // this; the service says it again because the service is what a later
    // internal caller would reach.
    if (actor.role !== UserRole.NetworkOwner) {
      throw new ForbiddenException({
        message: 'Only the network owner can top up a receipt',
        code: 'OWNER_ONLY',
      });
    }

    // `gt` and not `>`: `amount` is a decimal STRING and JS comparison on
    // strings would make '9.00' greater than '10.00' (foundation §5.1).
    if (!gt(dto.amount, '0')) {
      throw new BadRequestException({
        message: 'A top-up must add some money to the debt',
        code: 'TOP_UP_AMOUNT_NOT_POSITIVE',
      });
    }

    return this.dataSource.transaction(async (m) => {
      const intake = await m.findOne(Intake, { where: { id: dto.intake_id } });
      if (!intake) throw new NotFoundException('Intake not found');

      // NO CHECK ON `intake.voided_at`. Writing against a voided receipt is
      // legal and pointless: the row simply will not count, and the response
      // says so through `counts_toward_balance`. Refusing it would be a rule
      // the balance formula does not have.
      const saved = await m.save(IntakeTopUp, {
        intake_id: intake.id,
        amount: dto.amount,
        reason: dto.reason.trim(),
        created_by_user_id: actor.sub,
        voided_at: null,
        voided_by_user_id: null,
        void_reason: null,
      } as IntakeTopUp);

      await this.audit.record(
        {
          action: 'intake-top-up.created',
          actor_id: actor.sub,
          target_type: 'intake-top-up',
          target_id: saved.id,
          after: { amount: saved.amount, intake_id: intake.id, intake_code: intake.code },
          note: saved.reason,
        },
        m,
      );

      return toIntakeTopUpResponse(saved, intake);
    });
  }
}
```

Note on `reason.trim()`: `TransfersService` trims and `IntakesService` / `PayoutsService` do not. That disagreement is an existing follow-up. **Do not touch those three services in this slice** — this one simply declines to inherit the ambiguity.

- [ ] **Step 5: Run the tests**

```bash
cd backend && npm test -- intake-top-ups.service
```

Expected: all eight PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/intake-top-ups/intake-top-ups.service.ts \
        backend/src/intake-top-ups/intake-top-ups.service.spec.ts \
        backend/src/audit/audit-log.entity.ts
git commit -m "feat(top-ups): create a top-up (#61)

Owner-only, positive-only, reason trimmed. Deliberately consults no
shift: the owner writes these against closed shifts from a desk, which
is the whole scenario in the issue.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Service — void

**Files:**
- Modify: `backend/src/intake-top-ups/intake-top-ups.service.ts`
- Modify: `backend/src/intake-top-ups/intake-top-ups.service.spec.ts`

**Interfaces:**
- Consumes: `VoidDocumentDto` from `../intakes/dto/void-document.dto`.
- Produces: `void(actor: AuthenticatedUser, id: string, dto: VoidDocumentDto): Promise<IntakeTopUpResponse>` on `IntakeTopUpsService`.

Read `IntakesService.void` (`backend/src/intakes/intakes.service.ts:196`) first — the lock-then-check ordering there is the pattern to copy, and its header explains why.

- [ ] **Step 1: Write the failing void tests**

Append to `backend/src/intake-top-ups/intake-top-ups.service.spec.ts`:

```ts
describe('IntakeTopUpsService.void', () => {
  let service: IntakeTopUpsService;
  let manager: { findOne: jest.Mock; save: jest.Mock };
  let dataSource: { transaction: jest.Mock; manager: unknown };
  let audit: { record: jest.Mock };

  const live = (): IntakeTopUp =>
    ({
      id: 'top-up-1',
      intake_id: 'intake-1',
      amount: '2000.00',
      reason: 'доплата',
      created_by_user_id: 'owner-1',
      voided_at: null,
      voided_by_user_id: null,
      void_reason: null,
      created_at: new Date('2026-09-11T08:00:00.000Z'),
      updated_at: new Date('2026-09-11T08:00:00.000Z'),
    }) as IntakeTopUp;

  beforeEach(() => {
    manager = {
      findOne: jest.fn().mockImplementation((entity: unknown) =>
        entity === IntakeTopUp ? live() : INTAKE,
      ),
      save: jest.fn().mockImplementation((_e, row: IntakeTopUp) => row),
    };
    dataSource = {
      transaction: jest.fn().mockImplementation((cb: (m: unknown) => unknown) => cb(manager)),
      manager,
    };
    audit = { record: jest.fn() };
    service = new IntakeTopUpsService({} as never, dataSource as never, audit as never);
  });

  it('writes the whole trio and stops counting', async () => {
    const res = await service.void(OWNER, 'top-up-1', { reason: 'помилка суми' });

    expect(res.counts_toward_balance).toBe(false);
    expect(res.void_reason).toBe('помилка суми');
    expect(res.voided_by_user_id).toBe('owner-1');
    expect(res.voided_at).not.toBeNull();
  });

  it('reads the row under a write lock, inside the transaction', async () => {
    await service.void(OWNER, 'top-up-1', { reason: 'x' });

    expect(manager.findOne).toHaveBeenCalledWith(IntakeTopUp, {
      where: { id: 'top-up-1' },
      lock: { mode: 'pessimistic_write' },
    });
  });

  it('refuses an operator — even one at the right point', async () => {
    await expect(
      service.void(OPERATOR, 'top-up-1', { reason: 'x' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('409s an already-voided row', async () => {
    manager.findOne.mockImplementation((entity: unknown) =>
      entity === IntakeTopUp
        ? { ...live(), voided_at: new Date(), voided_by_user_id: 'owner-1', void_reason: 'вже' }
        : INTAKE,
    );

    await expect(service.void(OWNER, 'top-up-1', { reason: 'x' })).rejects.toMatchObject({
      response: { code: 'ALREADY_VOIDED' },
    });
  });

  it('404s an unknown id', async () => {
    manager.findOne.mockResolvedValue(null);
    await expect(service.void(OWNER, 'nope', { reason: 'x' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('audits inside the transaction', async () => {
    await service.void(OWNER, 'top-up-1', { reason: 'помилка суми' });

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'intake-top-up.voided',
        actor_id: 'owner-1',
        target_type: 'intake-top-up',
        target_id: 'top-up-1',
        before: { voided_at: null },
        note: 'помилка суми',
      }),
      manager,
    );
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
cd backend && npm test -- intake-top-ups.service
```

Expected: the six new tests fail with `service.void is not a function`; the eight from Task 4 still pass.

- [ ] **Step 3: Implement `void`**

Add to `IntakeTopUpsService`:

```ts
  /**
   * §9.3 — a document is never edited. A wrong amount or a wrong reason is
   * corrected by voiding this row and writing a new one; there is no PATCH and
   * there never will be.
   *
   * OWNER ONLY, unlike `IntakesService.void`, which lets an operator void
   * their own receipt in their own open shift (§9.4). The asymmetry is not an
   * oversight: an operator never creates one of these, so «своя квитанція»
   * has no meaning here, and there is no shift whose closure could gate it.
   *
   * THE LOAD AND THE STATE CHECK ARE INSIDE THE TRANSACTION, under a row lock,
   * for the reason `IntakesService.void` spells out: reading `voided_at`
   * before the transaction opens is a check-then-write, and a double-tapped
   * button would write two audit entries naming possibly different reasons
   * while `voided_by_user_id` is last-writer-wins.
   */
  async void(
    actor: AuthenticatedUser,
    id: string,
    dto: VoidDocumentDto,
  ): Promise<IntakeTopUpResponse> {
    if (actor.role !== UserRole.NetworkOwner) {
      throw new ForbiddenException({
        message: 'Only the network owner can void a top-up',
        code: 'OWNER_ONLY',
      });
    }

    return this.dataSource.transaction(async (m) => {
      const topUp = await m.findOne(IntakeTopUp, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!topUp) throw new NotFoundException('Intake top-up not found');

      if (topUp.voided_at) {
        throw new ConflictException({
          message: 'That top-up is already voided',
          code: 'ALREADY_VOIDED',
        });
      }

      const intake = await m.findOne(Intake, { where: { id: topUp.intake_id } });
      if (!intake) throw new NotFoundException('Intake top-up not found');

      topUp.voided_at = new Date();
      topUp.voided_by_user_id = actor.sub;
      topUp.void_reason = dto.reason.trim();
      const saved = await m.save(IntakeTopUp, topUp);

      await this.audit.record(
        {
          action: 'intake-top-up.voided',
          actor_id: actor.sub,
          target_type: 'intake-top-up',
          target_id: saved.id,
          before: { voided_at: null },
          after: { voided_at: saved.voided_at, amount: saved.amount, intake_id: intake.id },
          note: saved.void_reason,
        },
        m,
      );

      return toIntakeTopUpResponse(saved, intake);
    });
  }
```

Add `ConflictException` to the `@nestjs/common` import and `VoidDocumentDto` to the imports at the top of the file.

- [ ] **Step 4: Run the tests**

```bash
cd backend && npm test -- intake-top-ups.service
```

Expected: all fourteen PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/intake-top-ups/
git commit -m "feat(top-ups): void a top-up (#61)

Owner-only and locked before the state check, the same check-then-write
hazard IntakesService.void argues. A correction is a void plus a new
row (§9.3); there is no PATCH.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Service — reads

**Files:**
- Modify: `backend/src/intake-top-ups/intake-top-ups.service.ts`
- Modify: `backend/src/intake-top-ups/intake-top-ups.service.spec.ts`
- Test: `backend/src/intake-top-ups/intake-top-ups-list.db-spec.ts` (create)

**Interfaces:**
- Consumes: `resolvePointFilter` from `../auth/access/point-scope`, `Paginated` from `../common/dto/paginated`, `skipOf` from `../common/dto/pagination-query.dto`.
- Produces: `findOne(actor, id): Promise<IntakeTopUpResponse>` and `list(actor, query: ListIntakeTopUpsQueryDto): Promise<Paginated<IntakeTopUpResponse>>`.

- [ ] **Step 1: Write the failing list db-spec**

The point scope is a two-hop join and cannot be proved with mocks. Create `backend/src/intake-top-ups/intake-top-ups-list.db-spec.ts`, reusing the fixture helpers from Task 2's spec (copy them; the two files build different worlds and sharing a helper module across db-specs is not the repo's pattern).

```ts
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { IntakeTopUpsService } from './intake-top-ups.service';
import { IntakeTopUp } from './intake-top-up.entity';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * `GET /intake-top-ups`'s scoping and filtering, against a real Postgres.
 *
 * What is under test is the TWO-HOP JOIN. `intake_top_ups` has no point column
 * and neither does `intakes`, so an operator's scope is
 * `intake_top_ups → intakes → suppliers.collection_point_id`, and a unit spec
 * can only assert the text of that.
 */
describe('IntakeTopUpsService.list (Postgres)', () => {
  let ds: DataSource;
  let service: IntakeTopUpsService;
  let run: string;
  let pointA: string;
  let pointB: string;
  let ownerId: string;
  let topUpOnA: string;

  const owner = (): AuthenticatedUser =>
    ({ sub: ownerId, role: UserRole.NetworkOwner, collection_point_id: null }) as AuthenticatedUser;
  const operatorAt = (pointId: string): AuthenticatedUser =>
    ({ sub: ownerId, role: UserRole.PointOperator, collection_point_id: pointId }) as AuthenticatedUser;

  const makePoint = async (label: string): Promise<string> => {
    const [row] = await ds.query(
      `INSERT INTO collection_points (name, kind, code) VALUES ($1, 'reception', $2) RETURNING id`,
      [`Список ${label} ${run}`, `${label}${run.slice(0, 4).toUpperCase()}`],
    );
    return row.id;
  };

  /** One point's whole chain: supplier → shift → intake → top-up. */
  const world = async (pointId: string, label: string): Promise<string> => {
    const [supplier] = await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name, is_active)
       VALUES ($1, 'Іван', $2, true) RETURNING id`,
      [pointId, `${label}-${run}`],
    );
    const [shift] = await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date)
       VALUES ($1, $2, '2026-09-08') RETURNING id`,
      [pointId, ownerId],
    );
    const [intake] = await ds.query(
      `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id)
       VALUES ($1, $2, $3, '100.00', $4) RETURNING id`,
      [`${label}-IN-${run}`, shift.id, supplier.id, ownerId],
    );
    const [topUp] = await ds.query(
      `INSERT INTO intake_top_ups (intake_id, amount, reason, created_by_user_id)
       VALUES ($1, '750.00', 'доплата', $2) RETURNING id`,
      [intake.id, ownerId],
    );
    return topUp.id;
  };

  beforeAll(async () => {
    ds = await openTestDataSource();
    service = new IntakeTopUpsService(ds.getRepository(IntakeTopUp), ds, {
      record: async () => undefined,
    } as never);
    run = randomUUID().slice(0, 8);

    const [user] = await ds.query(
      `INSERT INTO users (first_name, last_name, role)
       VALUES ('Власник', $1, 'network_owner') RETURNING id`,
      [`Список-${run}`],
    );
    ownerId = user.id;

    pointA = await makePoint('A');
    pointB = await makePoint('B');
    topUpOnA = await world(pointA, 'A');
    await world(pointB, 'B');
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it('an owner with no filter sees both points', async () => {
    const page = await service.list(owner(), {
      include_voided: true,
      page: 1,
      limit: 50,
    } as never);

    const codes = page.data.map((r) => r.intake.code);
    expect(codes).toContain(`A-IN-${run}`);
    expect(codes).toContain(`B-IN-${run}`);
  });

  it('an operator sees only their own point, through the two-hop join', async () => {
    const page = await service.list(operatorAt(pointA), {
      include_voided: true,
      page: 1,
      limit: 50,
    } as never);

    expect(page.data.map((r) => r.id)).toContain(topUpOnA);
    expect(page.total).toBe(1);
  });

  it("an operator's requested collection_point_id is ignored, not honoured", async () => {
    const page = await service.list(operatorAt(pointA), {
      collection_point_id: pointB,
      include_voided: true,
      page: 1,
      limit: 50,
    } as never);

    expect(page.data.map((r) => r.id)).toEqual([topUpOnA]);
  });

  it('include_voided=false hides rows the owner voided', async () => {
    await ds.query(
      `UPDATE intake_top_ups
          SET voided_at = now(), voided_by_user_id = $2, void_reason = 'помилка'
        WHERE id = $1`,
      [topUpOnA, ownerId],
    );

    const page = await service.list(operatorAt(pointA), {
      include_voided: false,
      page: 1,
      limit: 50,
    } as never);
    expect(page.data).toHaveLength(0);
  });

  it('include_voided=false does NOT hide a row whose PARENT is voided', async () => {
    // The row is still live; it simply counts for nothing. Hiding it here is
    // exactly the silence `counts_toward_balance` exists to prevent.
    const [{ id }] = await ds.query(
      `SELECT i.id FROM intakes i
         JOIN intake_top_ups t ON t.intake_id = i.id
        WHERE t.id = $1`,
      [topUpOnA],
    );
    await ds.query(
      `UPDATE intakes SET voided_at = now(), voided_by_user_id = $2, void_reason = 'сторно'
        WHERE id = $1`,
      [id, ownerId],
    );
    await ds.query(
      `UPDATE intake_top_ups SET voided_at = NULL, voided_by_user_id = NULL, void_reason = NULL
        WHERE id = $1`,
      [topUpOnA],
    );

    const page = await service.list(operatorAt(pointA), {
      include_voided: false,
      page: 1,
      limit: 50,
    } as never);

    expect(page.data.map((r) => r.id)).toEqual([topUpOnA]);
    expect(page.data[0].counts_toward_balance).toBe(false);
  });
});
```

Fill in the `beforeAll` body before running — the comment names exactly which helpers to copy.

- [ ] **Step 2: Run and watch it fail**

```bash
cd backend && npm run test:db -- intake-top-ups-list
```

Expected: FAIL — `service.list is not a function`.

- [ ] **Step 3: Implement `findOne` and `list`**

Add to `IntakeTopUpsService`:

```ts
  /**
   * ONE ROW, SCOPED. Another point's top-up is a 404 and never a 403: these
   * rows carry a supplier's name and a money amount, so their existence must
   * not be confirmed to someone who may not see them — the same rule
   * `IntakesService` follows.
   */
  async findOne(actor: AuthenticatedUser, id: string): Promise<IntakeTopUpResponse> {
    const pointId = resolvePointFilter(actor);
    const row = await this.queryBase(pointId)
      .andWhere('t.id = :id', { id })
      .getRawOne<RawTopUpRow>();

    if (!row) throw new NotFoundException('Intake top-up not found');
    return this.toResponse(row);
  }

  /**
   * THE POINT FILTER IS A TWO-HOP JOIN, and there is no shortcut. Neither
   * `intake_top_ups` nor `intakes` stores a point; the supplier does (§3.9).
   * Anyone tempted to denormalise a `collection_point_id` onto this table
   * should read the entity header first — the duplication is the thing the
   * schema forbids, not the join.
   */
  async list(
    actor: AuthenticatedUser,
    query: ListIntakeTopUpsQueryDto,
  ): Promise<Paginated<IntakeTopUpResponse>> {
    const pointId = resolvePointFilter(actor, query.collection_point_id);
    const qb = this.queryBase(pointId);

    if (query.supplier_id) qb.andWhere('i.supplier_id = :supplierId', { supplierId: query.supplier_id });
    if (query.intake_id) qb.andWhere('t.intake_id = :intakeId', { intakeId: query.intake_id });
    if (!query.include_voided) qb.andWhere('t.voided_at IS NULL');

    const total = await qb.getCount();
    const rows = await qb
      .orderBy('t.created_at', 'DESC')
      .addOrderBy('t.id', 'ASC')
      .limit(query.limit)
      .offset(skipOf(query))
      .getRawMany<RawTopUpRow>();

    return {
      data: rows.map((row) => this.toResponse(row)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  /** The join every read shares, so the scope rule is written once. */
  private queryBase(pointId?: string) {
    const qb = this.repo
      .createQueryBuilder('t')
      .innerJoin(Intake, 'i', 'i.id = t.intake_id')
      .innerJoin('suppliers', 's', 's.id = i.supplier_id')
      .select([
        't.id AS t_id',
        't.intake_id AS t_intake_id',
        't.amount AS t_amount',
        't.reason AS t_reason',
        't.created_by_user_id AS t_created_by_user_id',
        't.created_at AS t_created_at',
        't.updated_at AS t_updated_at',
        't.voided_at AS t_voided_at',
        't.voided_by_user_id AS t_voided_by_user_id',
        't.void_reason AS t_void_reason',
        'i.code AS i_code',
        'i.voided_at AS i_voided_at',
      ]);

    if (pointId) qb.andWhere('s.collection_point_id = :pointId', { pointId });
    return qb;
  }

  private toResponse(row: RawTopUpRow): IntakeTopUpResponse {
    return toIntakeTopUpResponse(
      {
        id: row.t_id,
        intake_id: row.t_intake_id,
        amount: row.t_amount,
        reason: row.t_reason,
        created_by_user_id: row.t_created_by_user_id,
        created_at: row.t_created_at,
        updated_at: row.t_updated_at,
        voided_at: row.t_voided_at,
        voided_by_user_id: row.t_voided_by_user_id,
        void_reason: row.t_void_reason,
      } as IntakeTopUp,
      { id: row.t_intake_id, code: row.i_code, voided_at: row.i_voided_at },
    );
  }
```

And above the class:

```ts
/** The raw shape `queryBase` projects. Aliased columns, because a raw query is
 *  the only way to bring the parent's `code` and `voided_at` back in one trip. */
interface RawTopUpRow {
  t_id: string;
  t_intake_id: string;
  t_amount: string;
  t_reason: string;
  t_created_by_user_id: string;
  t_created_at: Date;
  t_updated_at: Date;
  t_voided_at: Date | null;
  t_voided_by_user_id: string | null;
  t_void_reason: string | null;
  i_code: string;
  i_voided_at: Date | null;
}
```

Add the imports: `resolvePointFilter`, `Paginated`, `skipOf`, `ListIntakeTopUpsQueryDto`.

- [ ] **Step 4: Run the db-spec**

```bash
cd backend && npm run test:db -- intake-top-ups-list
```

Expected: all five PASS.

- [ ] **Step 5: Run the whole unit suite for regressions**

```bash
cd backend && npm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/intake-top-ups/
git commit -m "feat(top-ups): scoped reads (#61)

The point scope is a two-hop join through intakes to suppliers, because
neither this table nor intakes stores a point. include_voided hides rows
the owner voided and deliberately does not hide rows whose parent was
voided — those stay visible and count for nothing.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Controller, module, audit actions, eslint

Everything needed to make the routes reachable. These belong in one task because none of them is independently testable — a controller with no module is dead code, and an audit action with no writer does not type-check into existence.

**Files:**
- Create: `backend/src/intake-top-ups/intake-top-ups.controller.ts`
- Create: `backend/src/intake-top-ups/intake-top-ups.module.ts`
- Modify: `backend/src/app.module.ts` (imports list)
- Modify: `backend/eslint.config.mjs` (the money guard's `files`)

**Interfaces:**
- Consumes: `IntakeTopUpsService` (Tasks 4–6), `Auth` / `CurrentUser` decorators from `../auth/decorators/`.
- Produces: `IntakeTopUpsModule`, exporting `IntakeTopUpsService` for the pipeline spec and any later consumer.

The two `AUDIT_ACTIONS` members were added in Task 4, where the first writer of them lives — `AuditAction` is a closed union and the service could not compile without them. Nothing to do here.

- [ ] **Step 1: Write the controller**

Create `backend/src/intake-top-ups/intake-top-ups.controller.ts`:

```ts
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { IntakeTopUpsService } from './intake-top-ups.service';
import { CreateIntakeTopUpDto } from './dto/create-intake-top-up.dto';
import { ListIntakeTopUpsQueryDto } from './dto/list-intake-top-ups.query';
import { VoidDocumentDto } from '../intakes/dto/void-document.dto';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * «Фантомний залишок» (#61).
 *
 * A FLAT RESOURCE, not `POST /intakes/:id/top-ups` and not
 * `GET /suppliers/:id/top-ups`. Hanging the reads off `/suppliers/:id` would
 * put a second module's route at the same depth as
 * `GET /suppliers/:id/balance`, and `supplier-balance.controller.ts` carries a
 * standing warning about exactly that: cross-module registration order is not
 * ours to control and a collision there produces no startup error.
 * `/intake-top-ups` shares a prefix with nothing.
 *
 * THE ROLE SPLIT IS `transfers`': the owner writes, both roles read. An
 * operator must be able to see the top-up because they are the one handing
 * over the cash — after one, the supplier's «Разом» is 2 000 ₴ higher than
 * anything else on the operator's screen explains, and §3.1 promises the
 * operator one number they can stand behind.
 *
 * CREATE TAKES NO `collection_point_id` and calls no `resolveWritePoint`: the
 * point is implied by the intake, and only an owner can write, and an owner
 * owns every point.
 */
@Controller('intake-top-ups')
export class IntakeTopUpsController {
  constructor(private readonly topUps: IntakeTopUpsService) {}

  @Post()
  @Auth(UserRole.NetworkOwner)
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateIntakeTopUpDto) {
    return this.topUps.create(actor, dto);
  }

  @Get()
  @Auth()
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListIntakeTopUpsQueryDto) {
    return this.topUps.list(actor, query);
  }

  @Get(':id')
  @Auth()
  findOne(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.topUps.findOne(actor, id);
  }

  @Post(':id/void')
  @Auth(UserRole.NetworkOwner)
  voidOne(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidDocumentDto,
  ) {
    return this.topUps.void(actor, id, dto);
  }
}
```

- [ ] **Step 2: Write the module**

Create `backend/src/intake-top-ups/intake-top-ups.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntakeTopUp } from './intake-top-up.entity';
import { IntakeTopUpsService } from './intake-top-ups.service';
import { IntakeTopUpsController } from './intake-top-ups.controller';
import { AuditModule } from '../audit/audit.module';

/**
 * IMPORTS NEITHER `ShiftsModule` NOR `SuppliersModule`, and both absences are
 * deliberate. There is no shift rule to apply (see the service header), and
 * the supplier is reached by JOIN rather than by service call because the
 * scope question here is "which rows", not "may this actor see this supplier".
 *
 * That keeps this module a leaf: it imports only `AuditModule`, so no cycle is
 * possible through it.
 */
@Module({
  imports: [TypeOrmModule.forFeature([IntakeTopUp]), AuditModule],
  providers: [IntakeTopUpsService],
  controllers: [IntakeTopUpsController],
  exports: [IntakeTopUpsService],
})
export class IntakeTopUpsModule {}
```

- [ ] **Step 3: Register it**

In `backend/src/app.module.ts`, add the import statement alongside the others and insert `IntakeTopUpsModule,` into the `imports` array immediately after `PayoutsModule,` — the debt tables stay grouped.

- [ ] **Step 4: Extend the money eslint guard**

In `backend/eslint.config.mjs`, add to the `files` array of the money-arithmetic block:

```js
      'src/intake-top-ups/**/*.ts',
```

And update the comment above it. Change "Scoped to the seven modules that handle money" to "eight modules", and add a paragraph after the `cash-counts` one:

```js
    // `intake-top-ups` joins with the top-ups slice (#61). Like `transfers`
    // and `point-cash` before it, it does no JavaScript arithmetic today —
    // the third term of the debt formula is computed in Postgres, and this
    // module only compares its amount against zero through `money.ts`'s `gt`.
    // The guard is what keeps a later `debt + top_up` from being written in
    // TypeScript, where it would look perfectly reasonable in review.
```

- [ ] **Step 5: Lint, build and run everything**

```bash
cd backend && npm run lint && npm run build && npm test
```

Expected: all PASS. A lint error inside `src/intake-top-ups/` means the new guard is working and something needs `money.ts`.

- [ ] **Step 6: Smoke-test the routes**

```bash
cd /Users/glebvasilevskiy/Projects/webspirio/yagoda/web-starter && docker compose up -d && sleep 15
curl -s localhost:3000/health/ready
```

Expected: the app boots with the new module and reports ready. If Nest fails to start, the most likely cause is the `app.module.ts` import.

- [ ] **Step 7: Commit**

```bash
git add backend/src/intake-top-ups/ backend/src/app.module.ts \
        backend/eslint.config.mjs
git commit -m "feat(top-ups): routes, module wiring and the money guard (#61)

A flat /intake-top-ups resource rather than a route under /suppliers/:id,
which would share a depth with /suppliers/:id/balance across module
boundaries — the hazard supplier-balance.controller.ts warns about.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Prove the payout ceiling inherits the top-up

The spec claims the topped-up money becomes payable "for free", with no change in `payouts`. That claim is worth exactly one test, and it is the end-to-end proof the slice delivers what #61 asked for: money the supplier «може потім від нас отримати».

**Files:**
- Test: `backend/src/payouts/payout-ceiling-top-ups.db-spec.ts` (create)

**Interfaces:**
- Consumes: `PayoutsService`, `IntakeTopUpsService`, the table from Task 1, the formula from Task 2.
- Produces: nothing. This task adds no production code — **if it needs any, something earlier is wrong.**

- [ ] **Step 1: Write the ceiling spec**

Create `backend/src/payouts/payout-ceiling-top-ups.db-spec.ts`.

`PayoutsService` takes six collaborators, so construct nothing by hand — boot the real container and pull the services out of it, the way `src/testing/documents-pipeline.db-spec.ts` does:

```ts
import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
// MUST precede `../app.module` — it loads `.env`, and AppModule's decorator
// runs ConfigModule.forRoot() eagerly at import time.
import { relaxThrottleForTests, resolveTestDatabaseName } from '../testing/db-harness';
import { AppModule } from '../app.module';
import { PayoutsService } from './payouts.service';
import { IntakesService } from '../intakes/intakes.service';
import { IntakeTopUpsService } from '../intake-top-ups/intake-top-ups.service';
import { SupplierBalanceService } from '../supplier-balance/supplier-balance.service';
import { PointCashService } from '../point-cash/point-cash.service';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * THE SPEC'S §7.2 CLAIM, UNDER TEST: centralising the formula in `debtSql`
 * makes a top-up payable through the ordinary payout flow with no change in
 * `payouts`. If this file ever needs production code to pass, that claim is
 * false and the slice has a second formula somewhere.
 *
 * §7.3 IS HERE TOO, AS A NEGATIVE: a top-up moves no cash. `movementsSql` has
 * three terms and a top-up is none of them, which is easy to break later by
 * "helpfully" adding a fourth.
 */
describe('payout ceiling with top-ups (Postgres)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let payouts: PayoutsService;
  let intakes: IntakesService;
  let topUps: IntakeTopUpsService;
  let balance: SupplierBalanceService;
  let pointCash: PointCashService;
  let run: string;
  let pointId: string;
  let ownerId: string;
  let shiftId: string;

  const owner = (): AuthenticatedUser =>
    ({ sub: ownerId, role: UserRole.NetworkOwner, collection_point_id: null }) as AuthenticatedUser;

  beforeAll(async () => {
    process.env.DB_NAME = resolveTestDatabaseName();
    relaxThrottleForTests();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    ds = app.get(DataSource);
    payouts = app.get(PayoutsService);
    intakes = app.get(IntakesService);
    topUps = app.get(IntakeTopUpsService);
    balance = app.get(SupplierBalanceService);
    pointCash = app.get(PointCashService);
    run = randomUUID().slice(0, 8);

    // Point, owner, open shift — same raw-SQL fixture style as
    // `intake-top-ups-balance.db-spec.ts` Step 1, plus an opening cash count so
    // the point has a cash anchor (a point with no counts reads 0.00 whatever
    // its documents say).
  });

  afterAll(async () => {
    await app?.close();
  });
```

Then the assertions:

```ts
  it('a fully-paid receipt plus a 2000 top-up can be paid exactly 2000', async () => {
    // 100.00 intake, 100.00 payout → debt 0.00. Then a 2 000 top-up.
    const supplierId = await supplier('Стеля');
    const intakeId = await intake(supplierId, '100.00');
    await payout(supplierId, '100.00');
    expect(await balance.debtFor(supplierId)).toBe('0.00');

    await topUps.create(owner(), {
      intake_id: intakeId,
      amount: '2000.00',
      reason: 'перерахували ціну після здачі',
    });

    expect(await balance.debtFor(supplierId)).toBe('2000.00');

    const paid = await payouts.create(owner(), {
      code: `CEIL-${run}`,
      collection_point_id: pointId,
      supplier_id: supplierId,
      amount: '2000.00',
    });

    expect(paid.amount).toBe('2000.00');
    expect(await balance.debtFor(supplierId)).toBe('0.00');
  });

  it('refuses one kopiyka more than the top-up made available', async () => {
    const supplierId = await supplier('Копійка');
    const intakeId = await intake(supplierId, '100.00');
    await payout(supplierId, '100.00');
    await topUps.create(owner(), {
      intake_id: intakeId,
      amount: '2000.00',
      reason: 'доплата',
    });

    await expect(
      payouts.create(owner(), {
        code: `CEIL2-${run}`,
        collection_point_id: pointId,
        supplier_id: supplierId,
        amount: '2000.01',
      }),
    ).rejects.toBeDefined();
  });

  it('voiding the parent receipt takes the ceiling back down', async () => {
    const supplierId = await supplier('Сторно');
    const intakeId = await intake(supplierId, '100.00');
    await topUps.create(owner(), {
      intake_id: intakeId,
      amount: '2000.00',
      reason: 'доплата',
    });
    expect(await balance.debtFor(supplierId)).toBe('2100.00');

    await intakes.void(owner(), intakeId, { reason: 'не та людина' });

    // BOTH terms drop: the receipt and the money that hung off it.
    expect(await balance.debtFor(supplierId)).toBe('0.00');
  });

  it('a top-up moves NO cash — spec §7.3', async () => {
    const before = await pointCash.forPoint(pointId);

    const supplierId = await supplier('Каса');
    const intakeId = await intake(supplierId, '100.00');
    await topUps.create(owner(), {
      intake_id: intakeId,
      amount: '5000.00',
      reason: 'доплата',
    });

    const after = await pointCash.forPoint(pointId);

    // The receipt moved no cash either — only payouts and transfers do — so
    // the figure must be byte-identical, not merely close.
    expect(after.cash).toBe(before.cash);
  });
```

Check `PointCashService`'s actual read method name and response shape before writing that last test — `point-cash.service.ts` is short, and the method is whatever `point-cash.controller.ts` calls. Adjust `forPoint`/`.cash` to match; the assertion is the part that matters.

- [ ] **Step 2: Run it**

```bash
cd backend && npm run test:db -- payout-ceiling-top-ups
```

Expected: all four PASS **with no production code written in this task**. If the first fails with a ceiling error, Task 2's formula did not reach `PayoutsService` — check that `debtFor` is the method the ceiling calls and that nothing caches.

- [ ] **Step 3: Commit**

```bash
git add backend/src/payouts/payout-ceiling-top-ups.db-spec.ts
git commit -m "test(top-ups): the payout ceiling inherits the top-up (#61)

No production code — that is the point. Centralising the formula in
debtSql is what makes the topped-up money payable through the ordinary
payout flow, and voiding the parent receipt takes both terms back down.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Seed a top-up

**Files:**
- Modify: `backend/src/seed/dev-seed.data.ts`
- Modify: `backend/src/seed/dev-seed.ts`
- Modify: `backend/src/seed/dev-seed.spec.ts`

**Interfaces:**
- Consumes: the table from Task 1.
- Produces: a `topUps` count on the seed summary object, so `dev-seed.spec.ts` can assert it.

Read `backend/src/seed/dev-seed.ts` around the payout insert (near line 503) first — the whole seed is idempotent and every insert is guarded by a lookup.

- [ ] **Step 1: Add the data row**

In `dev-seed.data.ts`, after `SEED_PAYOUTS`, add one top-up. **Address the parent the way every other seed fixture does — by `{ point, day, typed }`, never by a composed code.** `SEED_INTAKES` stores only the typed part (`'00412'`); the full `SHP-IN-…` code is assembled by the server at insert time, so a hand-written code would be a guess about `composeDocumentCode`'s output.

```ts
export interface SeedTopUp {
  /** Addresses the parent exactly as `SEED_INTAKES` identifies itself. */
  point: string;
  day: SeedDay;
  typed: string;
  amount: string;
  reason: string;
}

/**
 * ONE TOP-UP, on YESTERDAY's Шипинки receipt — whose shift is CLOSED. That is
 * the #61 scenario exactly: the owner renegotiated after the fact, and by then
 * the shift was long shut. The card work that follows this slice needs a row
 * exercising the normal case, not an edge one.
 */
export const SEED_TOP_UPS: readonly SeedTopUp[] = [
  {
    point: 'Шипинки',
    day: 'yesterday',
    typed: '00412',
    amount: '750.00',
    reason: 'Домовились про 48 ₴/кг замість 45 ₴/кг після здачі',
  },
];
```

`{ point: 'Шипинки', day: 'yesterday', typed: '00412' }` is Галина Кушнірук's raspberry receipt — the first entry in `SEED_INTAKES`. Confirm it is still first before relying on it.

- [ ] **Step 2: Add the idempotent insert**

The intakes loop in `dev-seed.ts` already composes a receipt code from point, business date and typed part before looking the row up. **Extract that composition into a local helper** — `const intakeCodeFor = (point: string, day: SeedDay, typed: string): string => …` — and call it from both the intakes loop and the new one, so the two can never disagree about what a code looks like.

Then, after the payouts loop:

```ts
  // IDEMPOTENT ON (intake id, reason), because `intake_top_ups` has no `code`
  // — a top-up has no paper twin to carry one. Re-running the seed must not
  // stack a second 750 ₴ onto the same receipt.
  for (const row of SEED_TOP_UPS) {
    const code = intakeCodeFor(row.point, row.day, row.typed);
    const intake = await one<{ id: string }>(
      qr,
      `SELECT id FROM intakes WHERE code = $1`,
      [code],
    );
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
      [intake.id, row.amount, row.reason, ownerUserId],
    );
    summary.topUps += 1;
  }
```

Add `topUps: number` to the summary interface (near `intakes: number; payouts: number;`) and `topUps: 0` to its initialiser.

- [ ] **Step 3: Assert it in the seed spec**

In `dev-seed.spec.ts`, extend the summary assertion to expect `topUps: 1`, and add the idempotency check the file already makes for other tables — running the seed twice must still leave one row.

- [ ] **Step 4: Run the seed end to end**

```bash
cd /Users/glebvasilevskiy/Projects/webspirio/yagoda/web-starter && npm run db:seed && npm run db:seed
```

Expected: both runs succeed; the second reports the same counts. Then verify by hand:

```bash
docker compose exec -T postgres psql -U app -d app -c \
  "SELECT t.amount, t.reason, i.code FROM intake_top_ups t JOIN intakes i ON i.id = t.intake_id;"
```

Expected: exactly one row.

- [ ] **Step 5: Run the seed specs**

```bash
cd backend && npm test -- dev-seed && npm run test:db -- dev-seed
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/seed/
git commit -m "feat(top-ups): seed one top-up on a closed shift's receipt (#61)

Idempotent on (intake code, reason), because a top-up has no code to
key on — it has no paper twin.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Amend the schema of record

The spec's §12. This is the task most likely to be skipped and the one whose absence does the most damage: `28-db-schema.dbml` is where every later reader goes to learn how debt is computed, and after Task 2 it documents a formula the backend no longer runs.

**Files:**
- Modify: `28-db-schema.dbml` — new `Table intake_top_ups` block; the `suppliers` Note
- Modify: `CLAUDE.md` — the Domain paragraph's table inventory

**Interfaces:** none — documentation only.

- [ ] **Step 1: Add the table block**

In `28-db-schema.dbml`, after the `payouts` block and before the `/* ящики */` divider, add:

```
Table intake_top_ups {
  id uuid [pk]

  intake_id uuid [not null, ref: > intakes.id]

  amount numeric(12,2) [not null]
  reason text [not null]

  created_by_user_id uuid [not null, ref: > users.id]

  voided_at timestamp
  voided_by_user_id uuid [ref: > users.id]
  void_reason text

  created_at timestamp [not null]
  updated_at timestamp [not null]

  indexes {
    (intake_id)
  }

  Note: '''
**ДОПЛАТА ДО КВИТАНЦІЇ** — те, що замовник називає «фантомний залишок» (#61, 11.09.2026).
Третє джерело боргу постачальника, поряд із `intakes` і `payouts`.

Навіщо: ціну перерахували ПІСЛЯ того, як людина здала і квитанцію провели. §2.7 заморожує
`intakes.amount` назавжди, тож без цієї таблиці лишалося два виходи — сторнувати правильну
квитанцію й набити заново (і розійтися з папером у руках людини) або доплатити повз систему
(і лишити борг брехливим). Тепер є третій.

**ЦЕ НЕ «ВСТУПНИЙ ЗАЛИШОК», І САМЕ ТОМУ `intake_id` NOT NULL.** Рішення власника 04.09.2026
лишається чинним: борг, набутий до запуску, у систему не заводиться взагалі. Таблиця, що
дозволяла б написати `(постачальник, 2000, причина)` без квитанції, БУЛА Б тим механізмом під
іншою назвою. Обовʼязковий батько означає, що борг можна доплатити лише там, де ягоду справді
прийняли й записали; вигадати його з нічого не можна. Наступному читачеві, який захоче зробити
`intake_id` nullable «щоб завести старі борги»: саме це тут і заборонено.

Точки, постачальника, зміни й дати ТУТ НЕМАЄ — усе береться через `intake_id`, а точка ще через
`suppliers` (§3.9). Практичний наслідок: фільтр за точкою це JOIN у ДВА кроки.

**ТІЛЬКИ ПЛЮС.** `CHECK (amount > 0)` — це рішення, а не пропуск. Відʼємний рядок гасив би борг
без грошей із шухляди, тобто був би тим самим полем «Залишок», яке §3.2 забороняє «для ЖОДНОЇ
ролі», і створив би ДРУГИЙ шлях у мінус там, де Note suppliers називає рівно один. Шлях униз уже
є і він §9.3: сторнувати квитанцію й виписати нову за правильною ціною. Стелі зверху НЕМАЄ
навмисно — квитанцію-батька обирають за свіжістю, тому її сума нічого не каже про правильний
розмір доплати.

**КОДУ НЕМАЄ.** `code` існує там, де приймальник переписує номер із паперової книги (§6.2). У
доплати паперового двійника немає — її створює керівник за столом, — а синтетичний номер був би
підробленим номером квитанції. `transfers` вирішив так само й з тієї самої причини.

**СТОРНОВАНА КВИТАНЦІЯ ЗНЕСИЛЮЄ СВОЇ ДОПЛАТИ, АЛЕ НЕ ЧІПАЄ ЇХ.** У формулі боргу стоїть
`ti.voided_at IS NULL` на батькові — ягоди не брали, значить і доплати за ті ягоди немає.
Каскадного запису НЕМАЄ навмисно: сторнувати квитанцію може ПРИЙМАЛЬНИК, свою і у своїй
відкритій зміні (§9.4), а каскад означав би, що приймальник проставляє `voided_by_user_id` на
рядку, який створив КЕРІВНИК. Ціна названа: рядок лишається живим на вигляд і не входить у
жоден баланс, тому кожен екран мусить показувати його як «при сторнованій квитанції», а не
ховати.

**ДЕНЬ ДОПЛАТИ — ДЕНЬ ЇЇ СТВОРЕННЯ**, а не бізнес-дата квитанції. Сьогодні цього не читає ніхто:
«приріст боргу за точку» описаний у Note suppliers, але в застосунку його ще немає. Записано,
щоб той, хто його зробить, не вгадував. Підстава — той самий вибір, що в `transfers`, де гроші
датуються `accepted_date`, а не відправленням: борг не існував у день квитанції, він виник у
день, коли керівник вирішив доплатити. Датувати назад означало б тихо збільшити вже закритий і
переглянутий день.

Кілька доплат на одну квитанцію ДОЗВОЛЕНО — унікального індексу на `intake_id` немає, бо §9.3
робить виправлення сторно ПЛЮС новий рядок.
'''
}
```

Check the block against the migration column by column before committing — the DBML is the schema of record and a drift here is worse than no entry.

- [ ] **Step 2: Amend the `suppliers` Note — the formula**

Replace the two-term SQL block in the `suppliers` Note with the three-term form from Task 2, and amend the sentence «фільтр voided_at IS NULL стоїть на ОБОХ історіях» to cover three, keeping the superseded text visible as a dated amendment — the convention every previous slice used:

> **ПРАВКА 11.09.2026 (#61):** борг має ТРЕТЄ джерело — `intake_top_ups`. …

- [ ] **Step 3: Amend the `suppliers` Note — the card**

Amend «Картка показує ДВА ОКРЕМІ СПИСКИ — квитанції й виплати — і одне число під ними» to three lists, dated the same way, and record why nesting the top-up inside its parent receipt was rejected: it would imply §2.7's frozen `amount` moved, and it would put a figure on screen contradicting the paper in the supplier's hand.

- [ ] **Step 4: Update `CLAUDE.md`**

In the Architecture section's **Domain** bullet, add `intake_top_ups` to the implemented list and note that it is a table the DBML gained after the fact. Leave "Three tables remain, all of them crates" — it is still true of the DBML's original seventeen — but make the sentence unambiguous about which count it refers to.

- [ ] **Step 5: Verify no contradiction remains**

```bash
cd /Users/glebvasilevskiy/Projects/webspirio/yagoda/web-starter
grep -n "SUM(p.amount)" 28-db-schema.dbml
grep -n "ДВА ОКРЕМІ СПИСКИ" 28-db-schema.dbml
```

Expected: the first shows the formula inside a three-term block; the second shows the old sentence only inside a superseded-and-dated amendment, never as a live claim.

- [ ] **Step 6: Commit**

```bash
git add 28-db-schema.dbml CLAUDE.md
git commit -m "docs(schema): record intake_top_ups and the three-term debt (#61)

The suppliers Note carried the canonical two-term SQL and the 'two
lists' sentence; both became false when the formula gained its third
term. Amended in place with the superseded text left visible.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Pipeline spec — the whole slice through HTTP

**Files:**
- Modify: `backend/src/testing/documents-pipeline.db-spec.ts`

**Interfaces:**
- Consumes: everything. This is the only test that goes through the real routes, guards and validation pipe.

Read the existing file first — it boots the full Nest app and logs in as seeded users, and your additions must reuse that machinery rather than build a second app.

- [ ] **Step 1: Add the scenario**

Append a `describe('intake top-ups', …)` block covering, in order:

```ts
  it('an operator cannot create one', async () => {
    await request(app.getHttpServer())
      .post('/intake-top-ups')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ intake_id: intakeId, amount: '2000.00', reason: 'доплата' })
      .expect(403);
  });

  it('the owner creates one against a receipt on a CLOSED shift', async () => {
    const res = await request(app.getHttpServer())
      .post('/intake-top-ups')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ intake_id: closedShiftIntakeId, amount: '2000.00', reason: '  доплата  ' })
      .expect(201);

    expect(res.body.reason).toBe('доплата');
    expect(res.body.counts_toward_balance).toBe(true);
    topUpId = res.body.id;
  });

  it('a blank reason is a 400', async () => {
    await request(app.getHttpServer())
      .post('/intake-top-ups')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ intake_id: intakeId, amount: '10.00', reason: '   ' })
      .expect(400);
  });

  it('zero is a 400 with a sentence, not a 500', async () => {
    const res = await request(app.getHttpServer())
      .post('/intake-top-ups')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ intake_id: intakeId, amount: '0.00', reason: 'x' })
      .expect(400);

    expect(res.body.code).toBe('TOP_UP_AMOUNT_NOT_POSITIVE');
  });

  it('the operator at that point reads it, and the balance shows it', async () => {
    await request(app.getHttpServer())
      .get(`/intake-top-ups/${topUpId}`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);

    const balance = await request(app.getHttpServer())
      .get(`/suppliers/${supplierId}/balance`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);

    expect(balance.body.debt).toBe(expectedDebtWithTopUp);
  });

  it("an operator at another point gets 404, not 403", async () => {
    await request(app.getHttpServer())
      .get(`/intake-top-ups/${topUpId}`)
      .set('Authorization', `Bearer ${otherPointOperatorToken}`)
      .expect(404);
  });

  it('the operator pays out the raised «Разом»', async () => {
    await request(app.getHttpServer())
      .post('/payouts')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ code: 'PIPE-TU-1', supplier_id: supplierId, amount: '2000.00' })
      .expect(201);
  });

  it('the owner voids a top-up and it stops counting', async () => {
    const res = await request(app.getHttpServer())
      .post(`/intake-top-ups/${secondTopUpId}/void`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ reason: 'помилка суми' })
      .expect(201);

    expect(res.body.counts_toward_balance).toBe(false);
  });

  it('an operator cannot void one', async () => {
    await request(app.getHttpServer())
      .post(`/intake-top-ups/${thirdTopUpId}/void`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ reason: 'x' })
      .expect(403);
  });
```

Declare `topUpId`, `secondTopUpId`, `thirdTopUpId`, `expectedDebtWithTopUp` and the token variables in the enclosing scope, and create the second and third top-ups in the block's `beforeAll` so the void tests have their own rows and do not depend on test ordering.

- [ ] **Step 2: Run it**

```bash
cd backend && npm run test:db -- documents-pipeline
```

Expected: all PASS.

- [ ] **Step 3: Full verification**

```bash
cd /Users/glebvasilevskiy/Projects/webspirio/yagoda/web-starter
npm run lint && npm run build && npm test
cd backend && npm run test:db
```

Expected: everything green. This is the gate for the slice.

- [ ] **Step 4: Commit**

```bash
git add backend/src/testing/documents-pipeline.db-spec.ts
git commit -m "test(top-ups): end-to-end through the real routes (#61)

Covers the role split, the 404-not-403 rule for another point, and the
thing the issue actually asked for — the supplier collecting the money
through an ordinary payout.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Out of Scope

Named here so nobody implements them by accident. Each is a follow-up issue, per the spec's §11 and §14:

- **The supplier card's third list.** This slice is backend-only. #61 is not done in the owner's eyes until the card ships.
- **A confirmation dialog for large amounts.** Frontend, and it belongs with the card.
- **Negative top-ups.** Refused by decision; the downward path is void-and-reissue.
- **An `amount <= intakes.amount` ceiling.** Argued and rejected in the spec's §3.4 — the parent is chosen by recency, so its amount carries no relationship to the correct top-up.
- **The day screen's third term.** The screen does not exist; the creation-day rule is recorded in the DBML Note, not implemented.
- **Re-attaching a top-up after its parent is corrected.** Manual today.
- **Fixing the `reason.trim()` disagreement in `intakes` / `payouts` / `transfers`.** A pre-existing follow-up. This slice does not touch those three services.

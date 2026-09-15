# Yagoda Crates Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record rented crates — who holds how many, at what deposit, and what comes back — as three tables, one module and a FIFO allocator, completing the schema of record.

**Architecture:** Two documents (`crate_issuances`, `crate_returns`) joined by `crate_return_allocations`. A return consumes issuance tranches oldest-first through a **pure allocator** with no database behind it, and the refund for each row comes from the tranche it consumes, so receipt-mode crates refund `0.00` with no branch on mode anywhere. Both documents learn their point and business date from `shift_id`, as every document in this codebase does. The crates cash book is derived, never stored.

**Tech Stack:** NestJS 11, TypeORM (`synchronize: false`, hand-written migrations), PostgreSQL 16, Jest (unit `*.spec.ts`, DB-backed `*.db-spec.ts`).

**Spec:** `docs/superpowers/specs/2026-09-15-yagoda-crates-slice.md` — read it first. This plan argues from it and does not repeat its reasoning.

## Global Constraints

- **`numeric` is a string end to end.** Entity columns are typed `string`, never `number`. No TypeORM transformer.
- **All money arithmetic goes through `backend/src/common/money.ts`.** `add`, `sub`, `mul`, `sum`, `cmp`, `gt`, `gte`, `lt`, `lte`, `isZero`, `isNegative`. Rounding is **per row, then summed**.
- **`crates/` must be added to the eslint money-guard list** in `backend/eslint.config.mjs`, which bans `*`, `/`, `Number()`, `parseFloat` and `toFixed` in money-handling modules. Task 3 does this.
- **Migrations are frozen once written.** Fix forward; never edit an applied migration.
- **`@Auth()` = any authenticated user; `@Auth(UserRole.NetworkOwner)` = owner only.** Roles match exactly, no hierarchy. Rules that need a row are `assert*` methods on the service, never guards.
- **A document is never edited.** No `PATCH`, no `DELETE`, no update method. A correction is a void plus a new document (§2.7, §9.3).
- **Pagination** uses `PaginationQueryDto` + `Paginated<T>` + `skipOf(query)`.
- **Tests:** `npm test -w backend` (unit), `npm run test:db -w backend` (DB). Both need `NODE_OPTIONS=--experimental-vm-modules`, already wired in the scripts.
- **Commit after every task.** Branch is `feat/box-distribution`; do not switch to `main`.

---

### Task 1: Schema — three tables, one index, one migration

**Files:**
- Create: `backend/src/crates/crate-issuance.entity.ts`
- Create: `backend/src/crates/crate-return.entity.ts`
- Create: `backend/src/crates/crate-return-allocation.entity.ts`
- Create: `backend/src/crates/crate-issuance-mode.enum.ts`
- Create: `backend/src/migrations/1788600000011-YagodaCrates.ts`
- Modify: `backend/src/tare-types/tare-type.entity.ts` (add the partial unique index)
- Test: `backend/src/migrations/crates-schema.db-spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `CrateIssuanceMode` (`'deposit' | 'receipt'`), entities `CrateIssuance`, `CrateReturn`, `CrateReturnAllocation`, and the table shapes every later task writes against.

- [ ] **Step 1: Write the failing schema spec**

Create `backend/src/migrations/crates-schema.db-spec.ts`. Model the harness usage on the existing `backend/src/migrations/intakes-payouts-schema.db-spec.ts` (open it first and copy its `beforeAll`/`afterAll` shape verbatim — it boots the DB harness and applies migrations).

```ts
import { DataSource } from 'typeorm';
import { createTestDataSource } from '../testing/db-harness';

describe('YagodaCrates schema', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = await createTestDataSource();
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  /** A shift + supplier + user to hang documents on. Returns their ids. */
  const fixture = async () => {
    const tag = crypto.randomUUID().slice(0, 8);
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
      code: `X-CD-20260915-${crypto.randomUUID().slice(0, 8)}`,
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
        code: `X-CR-20260915-${crypto.randomUUID().slice(0, 8)}`,
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
    const code = `X-CD-20260915-${crypto.randomUUID().slice(0, 8)}`;
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
    const tag = crypto.randomUUID().slice(0, 8);
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:db -w backend -- crates-schema`
Expected: FAIL — `relation "crate_issuances" does not exist`.

- [ ] **Step 3: Write the mode enum**

Create `backend/src/crates/crate-issuance-mode.enum.ts`:

```ts
/**
 * §6.2 — «до 50 завдаток, від 51 розписка». THE THRESHOLD IS NOT HERE AND NEVER
 * WILL BE: ticket #60 is explicit that it does not restrict the choice («ми не
 * обмежуємо вибір»), so the number is a default the client pre-selects and the
 * server records whatever it is told. A server-side threshold would be the
 * blocking validation the client refused.
 *
 * `receipt` means a paper розписка was written by hand and carries this
 * document's `code`; `deposit` means money changed hands instead. Both put
 * crates on the supplier's balance identically — §6.4: «різниця лише в грошах».
 */
export enum CrateIssuanceMode {
  Deposit = 'deposit',
  Receipt = 'receipt',
}
```

- [ ] **Step 4: Write the three entities**

Create `backend/src/crates/crate-issuance.entity.ts`:

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
import { Shift } from '../shifts/shift.entity';
import { Supplier } from '../suppliers/supplier.entity';
import { User } from '../users/user.entity';
import { CrateIssuanceMode } from './crate-issuance-mode.enum';

/**
 * Crates handed to a supplier. Like `intakes` and `payouts`, it stores neither
 * the point nor the business date — both come from `shift_id` (§2.3).
 *
 * THE TRANCHE. A return consumes issuances oldest-first and copies `per_unit`
 * from the one it consumes, so this row is what makes «людина, яка брала по 120
 * і по 130, отримує назад саме те, що платила» true (§6.5).
 *
 * `deposit_per_unit` IS A SNAPSHOT (§2.7). Repricing the crate in the catalogue
 * does not touch a July issuance — ticket #60: «якщо хтось взяв ящики за 120
 * гривень кожен, то повертає він також за 120 гривень кожен ящик».
 *
 * THERE IS NO `remaining_units`. It is derived as `units − Σ allocations from
 * non-voided returns`, for the reason `intakes` has no stored `remaining`
 * (§3.2): a stored balance is a second copy of a fact.
 *
 * NO `tare_type_id`, AND THAT IS A DECISION (spec §4.2). The facility rents one
 * standard crate; the catalogue's variety serves the berry side alone. Which
 * catalogue row IS that crate is `tare_types.is_crate`, which is exclusive.
 */
@Entity('crate_issuances')
@Unique('UQ_crate_issuances_code', ['code'])
@Check('CHK_crate_issuances_units', `"units" > 0`)
@Check('CHK_crate_issuances_deposit_per_unit', `"deposit_per_unit" >= 0`)
@Check('CHK_crate_issuances_deposit_taken', `"deposit_taken" >= 0`)
@Check(
  'CHK_crate_issuances_receipt_no_money',
  `"mode" <> 'receipt' OR ("deposit_per_unit" = 0 AND "deposit_taken" = 0)`,
)
@Check(
  'CHK_crate_issuances_void_trio',
  `num_nulls("voided_at", "voided_by_user_id", "void_reason") IN (0, 3)`,
)
@Index('IDX_crate_issuances_supplier_created', ['supplier_id', 'created_at'])
@Index('IDX_crate_issuances_shift_mode', ['shift_id', 'mode'])
export class CrateIssuance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** `{POINT}-{CR|CD}-{YYYYMMDD}-{NNN}`, GENERATED by the server — see
   *  `crate-code.ts`. The operator copies it onto the paper розписка; for a
   *  deposit issuance it is an internal identifier that reaches no paper. */
  @Column({ type: 'varchar' })
  code: string;

  @Column({ type: 'uuid' })
  shift_id: string;

  @ManyToOne(() => Shift, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'shift_id' })
  shift?: Shift;

  @Column({ type: 'uuid' })
  supplier_id: string;

  @ManyToOne(() => Supplier, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'supplier_id' })
  supplier?: Supplier;

  @Column({ type: 'int' })
  units: number;

  @Column({ type: 'enum', enum: CrateIssuanceMode, enumName: 'crate_issuance_mode' })
  mode: CrateIssuanceMode;

  /** `numeric` — a STRING, never a number. Zero for a receipt issuance, by CHECK. */
  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  deposit_per_unit: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  deposit_taken: string;

  /** §10.6 — «підпис під документом належить тому, хто натиснув». */
  @Column({ type: 'uuid' })
  issued_by_user_id: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'issued_by_user_id' })
  issued_by?: User;

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

Create `backend/src/crates/crate-return.entity.ts`:

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
import { Shift } from '../shifts/shift.entity';
import { Supplier } from '../suppliers/supplier.entity';
import { User } from '../users/user.entity';

/**
 * Crates coming back. `deposit_refund` is the SUM OF ITS ALLOCATION ROWS and is
 * stored because it is the document's frozen total (§2.7) — the rows are the
 * derivation, this is the figure the operator handed over.
 *
 * NO `code`. A return has no paper twin: the log of §6.4 is a log of розписки,
 * and nothing in the rules or tickets numbers a return.
 *
 * VOIDING A RETURN RESTORES TRANCHE CAPACITY, because `remaining` is derived
 * through `voided_at IS NULL` on this row. No allocation is deleted — the
 * evidence survives (§9.3).
 */
@Entity('crate_returns')
@Check('CHK_crate_returns_units', `"units" > 0`)
@Check('CHK_crate_returns_deposit_refund', `"deposit_refund" >= 0`)
@Check(
  'CHK_crate_returns_void_trio',
  `num_nulls("voided_at", "voided_by_user_id", "void_reason") IN (0, 3)`,
)
@Index('IDX_crate_returns_supplier_created', ['supplier_id', 'created_at'])
export class CrateReturn {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  shift_id: string;

  @ManyToOne(() => Shift, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'shift_id' })
  shift?: Shift;

  @Column({ type: 'uuid' })
  supplier_id: string;

  @ManyToOne(() => Supplier, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'supplier_id' })
  supplier?: Supplier;

  @Column({ type: 'int' })
  units: number;

  /** `numeric` — a STRING. Zero when every consumed tranche was receipt-mode. */
  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  deposit_refund: string;

  @Column({ type: 'uuid' })
  accepted_by_user_id: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'accepted_by_user_id' })
  accepted_by?: User;

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

Create `backend/src/crates/crate-return-allocation.entity.ts`:

```ts
import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { CrateIssuance } from './crate-issuance.entity';
import { CrateReturn } from './crate-return.entity';

/**
 * One line of a return: «these N crates came off THAT issuance».
 *
 * §6.5 — the oldest issuance is consumed first and `per_unit` is copied FROM
 * THAT ISSUANCE, not from the catalogue. The operator «нічого не питає і не
 * обирає».
 *
 * §6.6 AS AMENDED (spec §4.1): the queue is single and spans both modes, but
 * money still cannot mix — a receipt tranche has `deposit_per_unit = 0` by
 * CHECK, so a row consuming one carries `per_unit = 0` and `amount = 0`
 * without a single branch on mode.
 *
 * A COMPOSITION CHILD of its return: `ON DELETE CASCADE`, no routes of its own.
 * The issuance side is `RESTRICT` — an issuance must never vanish from under
 * rows that point at it.
 */
@Entity('crate_return_allocations')
@Check('CHK_crate_return_allocations_units', `"units" > 0`)
@Check('CHK_crate_return_allocations_per_unit', `"per_unit" >= 0`)
@Check('CHK_crate_return_allocations_amount', `"amount" >= 0`)
@Index('IDX_crate_return_allocations_issuance', ['issuance_id'])
export class CrateReturnAllocation {
  @PrimaryColumn({ type: 'uuid' })
  return_id: string;

  @ManyToOne(() => CrateReturn, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'return_id' })
  return?: CrateReturn;

  @PrimaryColumn({ type: 'uuid' })
  issuance_id: string;

  @ManyToOne(() => CrateIssuance, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'issuance_id' })
  issuance?: CrateIssuance;

  @Column({ type: 'int' })
  units: number;

  /** Copied from the issuance — see this class's header. */
  @Column({ type: 'numeric', precision: 12, scale: 2 })
  per_unit: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount: string;
}
```

- [ ] **Step 5: Add the partial unique index to `TareType`**

In `backend/src/tare-types/tare-type.entity.ts`, add to the imports from `typeorm` whatever is missing (`Index`) and put this decorator on the class, above `export class TareType`:

```ts
/**
 * ONE CRATE, NETWORK-WIDE (spec §5.4). A unique index on a column that is
 * `true` for every row it covers admits exactly one such row. `is_crate` is
 * what `crate_issuances.deposit_per_unit` is snapshotted from, so two flagged
 * rows would make «the price of a crate» ambiguous — which is what the seeded
 * catalogue was until this slice.
 *
 * The owner never meets this index: `TareTypesService` demotes every other row
 * in the same transaction when the flag is set. It is the backstop, not the
 * error path.
 */
@Index('UQ_tare_types_single_crate', ['is_crate'], { unique: true, where: '"is_crate"' })
```

- [ ] **Step 6: Write the migration**

Create `backend/src/migrations/1788600000011-YagodaCrates.ts`:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The crates slice — spec `docs/superpowers/specs/2026-09-15-yagoda-crates-slice.md`.
 * With these three tables the schema of record is complete: 17 of 17.
 *
 * FOUR THINGS A READER SHOULD NOT "FIX":
 *
 * 1. `crate_issuance_mode` ALREADY EXISTS as a Postgres type only if an earlier
 *    migration made it — it did not. The DBML declares the enum; this migration
 *    creates it.
 * 2. `code` IS NOT NULL ON BOTH MODES. The DBML's `receipt_no` was nullable;
 *    ЗАПИТАННЯ 2 is now closed in favour of generation, and a nullable
 *    identifier would make every query branch on mode.
 * 3. THE `is_crate` DEMOTION BEFORE THE INDEX IS LOAD-BEARING. The seeded
 *    catalogue flags two rows (Чешка and Ящик); creating the unique index
 *    without demoting one would fail on every existing database. The rule is
 *    deterministic — keep the oldest — and the owner re-designates through the
 *    catalogue screen whenever they like.
 * 4. CHECK REGEXES AND `\d`: this SQL lives in a JavaScript template literal
 *    where `\d` collapses to a bare `d`. There is no regex here today; if one
 *    is added, use bracket expressions. Same warning as `…0006` and `…0007`.
 */
export class YagodaCrates1788600000011 implements MigrationInterface {
  name = 'YagodaCrates1788600000011';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "crate_issuance_mode" AS ENUM ('deposit', 'receipt')`);

    await queryRunner.query(`
      CREATE TABLE "crate_issuances" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "code" character varying NOT NULL,
        "shift_id" uuid NOT NULL,
        "supplier_id" uuid NOT NULL,
        "units" integer NOT NULL,
        "mode" "crate_issuance_mode" NOT NULL,
        "deposit_per_unit" numeric(12,2) NOT NULL DEFAULT 0,
        "deposit_taken" numeric(12,2) NOT NULL DEFAULT 0,
        "issued_by_user_id" uuid NOT NULL,
        "voided_at" TIMESTAMP WITH TIME ZONE,
        "voided_by_user_id" uuid,
        "void_reason" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_crate_issuances" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_crate_issuances_code" UNIQUE ("code"),
        CONSTRAINT "FK_crate_issuances_shift" FOREIGN KEY ("shift_id")
          REFERENCES "shifts"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_crate_issuances_supplier" FOREIGN KEY ("supplier_id")
          REFERENCES "suppliers"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_crate_issuances_issued_by" FOREIGN KEY ("issued_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_crate_issuances_voided_by" FOREIGN KEY ("voided_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_crate_issuances_units" CHECK ("units" > 0),
        CONSTRAINT "CHK_crate_issuances_deposit_per_unit" CHECK ("deposit_per_unit" >= 0),
        CONSTRAINT "CHK_crate_issuances_deposit_taken" CHECK ("deposit_taken" >= 0),
        -- §6.4: «за розписку грошей немає взагалі». The dash on screen is a
        -- rendering of THIS, not of a zero that happens to be stored.
        CONSTRAINT "CHK_crate_issuances_receipt_no_money"
          CHECK ("mode" <> 'receipt' OR ("deposit_per_unit" = 0 AND "deposit_taken" = 0)),
        CONSTRAINT "CHK_crate_issuances_void_trio"
          CHECK (num_nulls("voided_at", "voided_by_user_id", "void_reason") IN (0, 3))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_crate_issuances_supplier_created"
         ON "crate_issuances" ("supplier_id", "created_at")`,
    );
    // The code counter reads exactly this pair — see `crate-code.ts`.
    await queryRunner.query(
      `CREATE INDEX "IDX_crate_issuances_shift_mode" ON "crate_issuances" ("shift_id", "mode")`,
    );

    await queryRunner.query(`
      CREATE TABLE "crate_returns" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "shift_id" uuid NOT NULL,
        "supplier_id" uuid NOT NULL,
        "units" integer NOT NULL,
        "deposit_refund" numeric(12,2) NOT NULL DEFAULT 0,
        "accepted_by_user_id" uuid NOT NULL,
        "voided_at" TIMESTAMP WITH TIME ZONE,
        "voided_by_user_id" uuid,
        "void_reason" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_crate_returns" PRIMARY KEY ("id"),
        CONSTRAINT "FK_crate_returns_shift" FOREIGN KEY ("shift_id")
          REFERENCES "shifts"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_crate_returns_supplier" FOREIGN KEY ("supplier_id")
          REFERENCES "suppliers"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_crate_returns_accepted_by" FOREIGN KEY ("accepted_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_crate_returns_voided_by" FOREIGN KEY ("voided_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_crate_returns_units" CHECK ("units" > 0),
        CONSTRAINT "CHK_crate_returns_deposit_refund" CHECK ("deposit_refund" >= 0),
        CONSTRAINT "CHK_crate_returns_void_trio"
          CHECK (num_nulls("voided_at", "voided_by_user_id", "void_reason") IN (0, 3))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_crate_returns_supplier_created"
         ON "crate_returns" ("supplier_id", "created_at")`,
    );

    await queryRunner.query(`
      CREATE TABLE "crate_return_allocations" (
        "return_id" uuid NOT NULL,
        "issuance_id" uuid NOT NULL,
        "units" integer NOT NULL,
        "per_unit" numeric(12,2) NOT NULL,
        "amount" numeric(12,2) NOT NULL,
        CONSTRAINT "PK_crate_return_allocations" PRIMARY KEY ("return_id", "issuance_id"),
        -- CASCADE on the return (a composition child, like intake_items),
        -- RESTRICT on the issuance (nothing may vanish under these rows).
        CONSTRAINT "FK_crate_return_allocations_return" FOREIGN KEY ("return_id")
          REFERENCES "crate_returns"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_crate_return_allocations_issuance" FOREIGN KEY ("issuance_id")
          REFERENCES "crate_issuances"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_crate_return_allocations_units" CHECK ("units" > 0),
        CONSTRAINT "CHK_crate_return_allocations_per_unit" CHECK ("per_unit" >= 0),
        CONSTRAINT "CHK_crate_return_allocations_amount" CHECK ("amount" >= 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_crate_return_allocations_issuance"
         ON "crate_return_allocations" ("issuance_id")`,
    );

    // ---- tare_types: exactly one crate -------------------------------------
    // Demote every flagged row but the oldest, THEN build the index. See this
    // file's header, point 3.
    await queryRunner.query(`
      UPDATE "tare_types" SET "is_crate" = false
       WHERE "is_crate"
         AND "id" <> (SELECT "id" FROM "tare_types" WHERE "is_crate"
                       ORDER BY "created_at", "id" LIMIT 1)
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_tare_types_single_crate"
         ON "tare_types" ("is_crate") WHERE "is_crate"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_tare_types_single_crate"`);
    await queryRunner.query(`DROP TABLE "crate_return_allocations"`);
    await queryRunner.query(`DROP TABLE "crate_returns"`);
    await queryRunner.query(`DROP TABLE "crate_issuances"`);
    await queryRunner.query(`DROP TYPE "crate_issuance_mode"`);
  }
}
```

- [ ] **Step 7: Run the schema spec**

Run: `npm run test:db -w backend -- crates-schema`
Expected: PASS, all seven tests.

- [ ] **Step 8: Check for entity/schema drift**

Run: `DB_NAME=app_test npm run migration:generate -w backend -- src/migrations/ScratchCratesDrift`
Then read the generated file, ignoring every line naming an `FK_`/`UQ_`/`PK_` rename, and confirm no column, type or CHECK body drift is proposed. Delete the scratch file:
`rm backend/src/migrations/*ScratchCratesDrift.ts`

- [ ] **Step 9: Commit**

```bash
git add backend/src/crates backend/src/migrations backend/src/tare-types/tare-type.entity.ts
git commit -m "feat(crates): three tables, one crate type, one migration

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The document code — two kinds, a per-(shift, mode) counter

**Files:**
- Modify: `backend/src/common/document-code.ts`
- Create: `backend/src/crates/crate-code.ts`
- Test: `backend/src/crates/crate-code.spec.ts`

**Interfaces:**
- Consumes: `CrateIssuanceMode` (Task 1); `composeDocumentCode(pointCode, kind, businessDate, typed)` from `common/document-code.ts`.
- Produces:
  - `DocumentKind` widened to `'IN' | 'PO' | 'CR' | 'CD'`
  - `padSequence(n: number): string`
  - `nextIssuanceCode(manager: EntityManager, params: { pointCode: string; businessDate: string; shiftId: string; mode: CrateIssuanceMode }): Promise<string>`

- [ ] **Step 1: Write the failing test**

Create `backend/src/crates/crate-code.spec.ts`:

```ts
import { CrateIssuanceMode } from './crate-issuance-mode.enum';
import { nextIssuanceCode, padSequence } from './crate-code';

describe('padSequence', () => {
  it('pads to three digits', () => {
    expect(padSequence(1)).toBe('001');
    expect(padSequence(42)).toBe('042');
    expect(padSequence(999)).toBe('999');
  });

  /**
   * THE `lpad` TRAP, in JavaScript form. Migration …0007 shipped a truncating
   * pad once already: document 1000 rendered as '100' and collided with
   * document 100. `padStart` does not truncate — this test is what keeps
   * anyone from "fixing" it into something that does.
   */
  it('does not truncate past three digits', () => {
    expect(padSequence(1000)).toBe('1000');
    expect(padSequence(12345)).toBe('12345');
  });
});

describe('nextIssuanceCode', () => {
  const managerWithCount = (n: number) => ({
    query: jest.fn().mockImplementation((sql: string) => {
      if (sql.includes('pg_advisory_xact_lock')) return Promise.resolve([{}]);
      return Promise.resolve([{ n }]);
    }),
  });

  it('numbers receipts and deposits on separate counters', async () => {
    const manager = managerWithCount(6);
    const code = await nextIssuanceCode(manager as never, {
      pointCode: 'SHP',
      businessDate: '2026-09-15',
      shiftId: 'a-shift',
      mode: CrateIssuanceMode.Receipt,
    });
    expect(code).toBe('SHP-CR-20260915-007');
  });

  it('uses the CD kind for a deposit issuance', async () => {
    const manager = managerWithCount(13);
    const code = await nextIssuanceCode(manager as never, {
      pointCode: 'SHP',
      businessDate: '2026-09-15',
      shiftId: 'a-shift',
      mode: CrateIssuanceMode.Deposit,
    });
    expect(code).toBe('SHP-CD-20260915-014');
  });

  it('takes the advisory lock before counting', async () => {
    const manager = managerWithCount(0);
    await nextIssuanceCode(manager as never, {
      pointCode: 'KON',
      businessDate: '2026-09-15',
      shiftId: 'a-shift',
      mode: CrateIssuanceMode.Deposit,
    });
    const [first] = manager.query.mock.calls[0] as [string];
    expect(first).toContain('pg_advisory_xact_lock');
  });

  it('counts voided rows too, so a number is never reissued', async () => {
    const manager = managerWithCount(3);
    await nextIssuanceCode(manager as never, {
      pointCode: 'KON',
      businessDate: '2026-09-15',
      shiftId: 'a-shift',
      mode: CrateIssuanceMode.Deposit,
    });
    const counting = (manager.query.mock.calls as [string][]).find(([sql]) =>
      sql.includes('count(*)'),
    );
    expect(counting?.[0]).not.toContain('voided_at');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -w backend -- crate-code`
Expected: FAIL — cannot find module `./crate-code`.

- [ ] **Step 3: Widen `DocumentKind`**

In `backend/src/common/document-code.ts`, replace the `DocumentKind` line and extend the header comment:

```ts
/**
 * …existing header…
 *
 * FOUR KINDS, AND THE LAST TWO INVERT THE SEAM. `IN` and `PO` prefix a number
 * the operator READ OFF PAPER. `CR` (розписка) and `CD` (завдаток) are
 * GENERATED here and copied BY the operator ONTO paper — see
 * `crates/crate-code.ts`. Same format, opposite direction of trust.
 *
 * `CR` and `CD` are separate kinds so their day counters are separate: the
 * paper log receives розписки only, and a shared counter would riddle it with
 * gaps that mean nothing, destroying the one control a log provides.
 */
export type DocumentKind = 'IN' | 'PO' | 'CR' | 'CD';
```

- [ ] **Step 4: Write `crate-code.ts`**

Create `backend/src/crates/crate-code.ts`:

```ts
import { EntityManager } from 'typeorm';
import { composeDocumentCode } from '../common/document-code';
import { CrateIssuanceMode } from './crate-issuance-mode.enum';

/**
 * Pads to three digits and NEVER TRUNCATES. `lpad('1000', 3, '0')` in Postgres
 * is `'100'`, which collides with document 100; migration …0007 shipped that
 * bug once. `padStart` grows instead.
 */
export function padSequence(n: number): string {
  return String(n).padStart(3, '0');
}

/**
 * The next code for an issuance at this shift, in this mode.
 *
 * THE COUNT INCLUDES VOIDED ROWS. A number is burnt permanently when its
 * document is voided — §9.3 keeps the voided document in the journal «НАЗАВЖДИ
 * з печаткою», and reissuing its number would point two documents at one line
 * of the paper log.
 *
 * THE ADVISORY LOCK, not a retry loop. Two issuances in one (shift, mode) would
 * otherwise both read the same count and compose the same code; the loser gets
 * a 23505 on `UQ_crate_issuances_code` mid-transaction with a supplier waiting.
 * §2.2 («одна людина за раз») makes contention almost theoretical, which is
 * exactly why the cheap deterministic fix beats retry infrastructure this repo
 * does not have. It is an `xact` lock: it releases on commit or rollback with
 * nothing to clean up.
 *
 * THE SHIFT IS THE COUNTER KEY because `UQ_shifts_point_business_date` makes a
 * shift exactly one (point, day). No counters table exists or is needed.
 *
 * THIS DEPENDS ON ISSUANCES NEVER BEING HARD-DELETED. True today — there is no
 * DELETE route anywhere in this backend — and load-bearing tomorrow: a cleanup
 * script would silently restart the numbering.
 */
export async function nextIssuanceCode(
  manager: EntityManager,
  params: {
    pointCode: string;
    businessDate: string;
    shiftId: string;
    mode: CrateIssuanceMode;
  },
): Promise<string> {
  const kind = params.mode === CrateIssuanceMode.Receipt ? 'CR' : 'CD';

  await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    `crate-code:${params.shiftId}:${params.mode}`,
  ]);

  const rows: Array<{ n: string | number }> = await manager.query(
    `SELECT count(*)::int AS n FROM crate_issuances WHERE shift_id = $1 AND mode = $2`,
    [params.shiftId, params.mode],
  );
  const used = Number(rows[0]?.n ?? 0);

  return composeDocumentCode(
    params.pointCode,
    kind,
    params.businessDate,
    padSequence(used + 1),
  );
}
```

`Number()` here is a row-count conversion, not money. It sits in `crate-code.ts`, which Task 3 keeps OUT of the eslint money-guard paths for this reason — see that task's note.

- [ ] **Step 5: Run the tests**

Run: `npm test -w backend -- crate-code`
Expected: PASS, six tests.

- [ ] **Step 6: Commit**

```bash
git add backend/src/common/document-code.ts backend/src/crates/crate-code.ts backend/src/crates/crate-code.spec.ts
git commit -m "feat(crates): generated document codes on two per-day counters

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The allocator — pure FIFO

**Files:**
- Create: `backend/src/crates/crate-allocation.ts`
- Modify: `backend/eslint.config.mjs`
- Test: `backend/src/crates/crate-allocation.spec.ts`

**Interfaces:**
- Consumes: `money.ts` (`mul`, `sum`); `CrateIssuanceMode` (Task 1).
- Produces:
  - `CrateTranche = { issuance_id: string; remaining_units: number; per_unit: string; mode: CrateIssuanceMode }`
  - `CrateAllocationRow = { issuance_id: string; units: number; per_unit: string; amount: string }`
  - `CrateAllocationResult = { allocations: CrateAllocationRow[]; deposit_refund: string; shortfall: number }`
  - `allocate(tranches: CrateTranche[], requestedUnits: number): CrateAllocationResult`

- [ ] **Step 1: Write the failing test**

Create `backend/src/crates/crate-allocation.spec.ts`:

```ts
import { CrateIssuanceMode } from './crate-issuance-mode.enum';
import { allocate, CrateTranche } from './crate-allocation';

const deposit = (id: string, units: number, perUnit: string): CrateTranche => ({
  issuance_id: id,
  remaining_units: units,
  per_unit: perUnit,
  mode: CrateIssuanceMode.Deposit,
});

const receipt = (id: string, units: number): CrateTranche => ({
  issuance_id: id,
  remaining_units: units,
  per_unit: '0.00',
  mode: CrateIssuanceMode.Receipt,
});

describe('allocate', () => {
  /** §6.5, the rule's own example, number for number. */
  it('consumes the oldest tranche first and refunds ITS price', () => {
    const result = allocate([deposit('jul18', 20, '120.00'), deposit('jul28', 20, '130.00')], 7);

    expect(result.allocations).toEqual([
      { issuance_id: 'jul18', units: 7, per_unit: '120.00', amount: '840.00' },
    ]);
    expect(result.deposit_refund).toBe('840.00');
    expect(result.shortfall).toBe(0);
  });

  it('spans tranches when the first cannot cover the request', () => {
    const result = allocate([deposit('jul18', 20, '120.00'), deposit('jul28', 20, '130.00')], 25);

    expect(result.allocations).toEqual([
      { issuance_id: 'jul18', units: 20, per_unit: '120.00', amount: '2400.00' },
      { issuance_id: 'jul28', units: 5, per_unit: '130.00', amount: '650.00' },
    ]);
    expect(result.deposit_refund).toBe('3050.00');
  });

  /**
   * Spec §4.1 — the queue is single and spans modes, and the money still does
   * not mix. The receipt tranche contributes crates and 0,00 ₴.
   */
  it('interleaves receipt tranches by date and refunds nothing for them', () => {
    const result = allocate(
      [deposit('jul18', 20, '120.00'), receipt('jul24', 30), deposit('jul28', 20, '130.00')],
      45,
    );

    expect(result.allocations).toEqual([
      { issuance_id: 'jul18', units: 20, per_unit: '120.00', amount: '2400.00' },
      { issuance_id: 'jul24', units: 25, per_unit: '0.00', amount: '0.00' },
    ]);
    expect(result.deposit_refund).toBe('2400.00');
  });

  it('exhausts a tranche exactly without touching the next', () => {
    const result = allocate([deposit('a', 20, '120.00'), deposit('b', 20, '130.00')], 20);

    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0]).toEqual({
      issuance_id: 'a',
      units: 20,
      per_unit: '120.00',
      amount: '2400.00',
    });
  });

  it('spans three tranches', () => {
    const result = allocate(
      [deposit('a', 2, '10.00'), deposit('b', 2, '20.00'), deposit('c', 2, '30.00')],
      6,
    );

    expect(result.allocations.map((r) => r.amount)).toEqual(['20.00', '40.00', '60.00']);
    expect(result.deposit_refund).toBe('120.00');
  });

  it('handles a one-unit return', () => {
    const result = allocate([deposit('a', 20, '120.00')], 1);
    expect(result.deposit_refund).toBe('120.00');
  });

  /**
   * ROUNDING IS PER ROW, THEN SUMMED — the repo's rule, held here even though
   * THIS DOMAIN CANNOT PRODUCE A DISAGREEMENT. A scale-2 price times an INTEGER
   * unit count is exact, so `round(Σ)` always equals `Σ round(each)` for
   * crates; `intakes` is where the kopiyka actually moves, because its
   * quantities are weights with decimals.
   *
   * The test asserts exactness rather than pretending otherwise. The per-row
   * discipline stays in the implementation so that the day a fractional
   * quantity appears here, the rows the supplier can check are already the
   * rows being summed.
   */
  it('produces exact per-row amounts that sum to the refund', () => {
    const result = allocate([deposit('a', 3, '0.33'), deposit('b', 3, '0.67')], 6);

    expect(result.allocations.map((r) => r.amount)).toEqual(['0.99', '2.01']);
    expect(result.deposit_refund).toBe('3.00');
  });

  it('reports a shortfall rather than inventing tranches', () => {
    const result = allocate([deposit('a', 20, '120.00')], 25);

    expect(result.shortfall).toBe(5);
    expect(result.allocations).toHaveLength(1);
    expect(result.deposit_refund).toBe('2400.00');
  });

  it('reports the whole request as a shortfall when nothing is outstanding', () => {
    const result = allocate([], 10);

    expect(result.shortfall).toBe(10);
    expect(result.allocations).toEqual([]);
    expect(result.deposit_refund).toBe('0.00');
  });

  it('skips exhausted tranches', () => {
    const result = allocate([deposit('a', 0, '120.00'), deposit('b', 5, '130.00')], 3);

    expect(result.allocations).toEqual([
      { issuance_id: 'b', units: 3, per_unit: '130.00', amount: '390.00' },
    ]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -w backend -- crate-allocation`
Expected: FAIL — cannot find module `./crate-allocation`.

- [ ] **Step 3: Write the allocator**

Create `backend/src/crates/crate-allocation.ts`:

```ts
import { mul, sum } from '../common/money';
import { CrateIssuanceMode } from './crate-issuance-mode.enum';

/**
 * THE WHOLE COMPUTATION OF THIS SLICE, PURE. No Nest, no database, no clock —
 * the same shape as `intakes/intake-lines.ts`, and for the same reason: the
 * rules worth testing exhaustively are here, and testing them must not require
 * a transaction.
 *
 * §6.5 — «гаситься найстаріша видача першою, і per_unit береться З ТІЄЇ
 * видачі, а не з довідника». The caller supplies tranches ALREADY ORDERED
 * oldest-first; ordering is a database concern (`created_at`, then `id`).
 *
 * THERE IS NO BRANCH ON `mode`, AND THAT IS THE DESIGN. §6.6 as amended (spec
 * §4.1) says the queue is single and the money still does not mix — which is
 * true by construction, because a receipt issuance has `deposit_per_unit = 0`
 * by CHECK, so a row consuming one carries `per_unit = 0` and `amount = 0`.
 * `mode` is carried through for DISPLAY only: the screen must be able to say
 * «5 — за розпискою, без грошей» rather than show a silent zero.
 *
 * A SHORTFALL IS RETURNED, NOT THROWN. §6.5 calls over-return «помилка вводу, а
 * не подія», and the caller owns the wording of that 400; a pure function that
 * threw an HTTP exception would be neither pure nor reusable by the preview.
 */
export interface CrateTranche {
  issuance_id: string;
  remaining_units: number;
  per_unit: string;
  mode: CrateIssuanceMode;
}

export interface CrateAllocationRow {
  issuance_id: string;
  units: number;
  per_unit: string;
  amount: string;
}

export interface CrateAllocationResult {
  allocations: CrateAllocationRow[];
  deposit_refund: string;
  /** Units the tranches could not cover. `0` means the request was satisfied. */
  shortfall: number;
}

export function allocate(
  tranches: CrateTranche[],
  requestedUnits: number,
): CrateAllocationResult {
  const allocations: CrateAllocationRow[] = [];
  let left = requestedUnits;

  for (const tranche of tranches) {
    if (left <= 0) break;
    if (tranche.remaining_units <= 0) continue;

    const units = Math.min(tranche.remaining_units, left);
    allocations.push({
      issuance_id: tranche.issuance_id,
      units,
      per_unit: tranche.per_unit,
      // Rounded HERE, per row, before anything is summed.
      amount: mul(tranche.per_unit, String(units)),
    });
    left -= units;
  }

  return {
    allocations,
    deposit_refund: sum(allocations.map((row) => row.amount)),
    shortfall: left,
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -w backend -- crate-allocation`
Expected: PASS, ten tests. If `sum([])` does not return `'0.00'`, fix the call site here with `allocations.length ? sum(...) : '0.00'` rather than changing `money.ts`.

- [ ] **Step 5: Add `crates/` to the eslint money guard**

Open `backend/eslint.config.mjs`, find the array of paths that currently lists `intakes/`, `payouts/`, `shifts/`, `supplier-balance/`, `transfers/`, `point-cash/` and `cash-counts/`, and add the crates money files. Scope it to the files that handle money rather than the whole directory, so `crate-code.ts`'s row-count `Number()` stays legal:

```js
// crates/: the money files only. `crate-code.ts` converts a row COUNT with
// Number() and is deliberately outside this guard — it touches no currency.
'src/crates/crate-allocation.ts',
'src/crates/crates.service.ts',
'src/crates/crate-balance.service.ts',
```

Match the surrounding syntax exactly — if the existing entries are directory globs like `src/intakes/**`, write these three as file paths in the same array.

- [ ] **Step 6: Run lint**

Run: `npm run lint -w backend`
Expected: PASS. `Math.min` and `-=` on integer unit COUNTS are not money operators; if the rule flags `String(units)`, that is a false positive on a non-currency conversion — leave the code and narrow the rule's selector, never add a disable comment.

- [ ] **Step 7: Commit**

```bash
git add backend/src/crates/crate-allocation.ts backend/src/crates/crate-allocation.spec.ts backend/eslint.config.mjs
git commit -m "feat(crates): pure FIFO allocator, money guarded by eslint

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: One crate type — the catalogue demotes the others

**Files:**
- Modify: `backend/src/tare-types/tare-types.service.ts`
- Test: `backend/src/tare-types/tare-types.service.spec.ts` (extend; create if absent)

**Interfaces:**
- Consumes: `TareType` entity, `UQ_tare_types_single_crate` (Task 1).
- Produces: `TareTypesService.findCrateType(manager?: EntityManager): Promise<TareType | null>` — the active crate row, or `null`. Tasks 5 and 6 call it.

- [ ] **Step 1: Write the failing tests**

Add to `backend/src/tare-types/tare-types.service.spec.ts` (follow the file's existing mocking of the repository and `DataSource.transaction`; if the file does not exist, create it modelled on `backend/src/payouts/payouts.service.spec.ts`):

```ts
describe('the single crate type', () => {
  it('demotes every other row when a type is marked as the crate', async () => {
    const manager = { getRepository: jest.fn(), query: jest.fn().mockResolvedValue([]) };
    // …wire `dataSource.transaction` to call its callback with `manager`, and
    // the repository mock to return an existing tare type…

    await service.update(owner, 'tare-id', { is_crate: true });

    const demotion = (manager.query.mock.calls as [string, unknown[]][]).find(([sql]) =>
      sql.includes('UPDATE "tare_types"'),
    );
    expect(demotion?.[0]).toContain('SET "is_crate" = false');
    expect(demotion?.[1]).toEqual(['tare-id']);
  });

  it('does not demote anything when the flag is untouched', async () => {
    const manager = { getRepository: jest.fn(), query: jest.fn().mockResolvedValue([]) };
    await service.update(owner, 'tare-id', { deposit_price: '130.00' });
    expect(manager.query).not.toHaveBeenCalled();
  });

  it('findCrateType returns only an ACTIVE flagged row', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(service.findCrateType()).resolves.toBeNull();
    expect(repo.findOne).toHaveBeenCalledWith({ where: { is_crate: true, is_active: true } });
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npm test -w backend -- tare-types`
Expected: FAIL — `service.findCrateType is not a function`, and no demotion query.

- [ ] **Step 3: Implement the demotion and the lookup**

In `backend/src/tare-types/tare-types.service.ts`:

Inside `create`'s transaction, immediately before `repo.save(...)`, and inside `update`'s transaction, immediately before `manager.getRepository(TareType).save(tare)`, add the demotion. For `create` there is no id to exclude yet, so demote everything and let the new row carry the flag:

```ts
// ONE CRATE, NETWORK-WIDE (spec §5.4). Switching the network's crate is ONE
// owner action, not two: flagging a type clears the flag everywhere else in
// the same transaction. `UQ_tare_types_single_crate` is the backstop; if the
// owner ever meets it, this line failed to run.
if (tare.is_crate) {
  await manager.query(`UPDATE "tare_types" SET "is_crate" = false WHERE "is_crate" AND "id" <> $1`, [
    tare.id,
  ]);
}
```

For `create`, run the same statement AFTER the insert (the new row needs an id to be excluded), still inside the transaction. For `update`, run it after `save` for the same reason.

Then add the lookup method, and replace the TODO comment above `update`:

```ts
/**
 * The catalogue row that IS the rented crate, or `null`.
 *
 * ACTIVE ONLY. `crate_issuances.deposit_per_unit` is snapshotted from this
 * row, so a retired crate type must stop new issuances — but it must NOT stop
 * returns, which read the frozen price off the issuance and never come here.
 *
 * THE DEACTIVATION RULE (formerly a TODO on `update`): deactivating a crate
 * type with outstanding deposits is a WARNING on the client, never a refusal.
 * §6.1 and правка 14 — a management decision gets a warning, not a locked
 * button, and the schema's stance throughout is that a blocked button teaches
 * people to look for a way around it.
 */
async findCrateType(manager?: EntityManager): Promise<TareType | null> {
  const repo = manager ? manager.getRepository(TareType) : this.repo;
  return repo.findOne({ where: { is_crate: true, is_active: true } });
}
```

Import `EntityManager` from `typeorm` if it is not already imported.

- [ ] **Step 4: Run the tests**

Run: `npm test -w backend -- tare-types`
Expected: PASS.

- [ ] **Step 5: Export the service if it is not exported**

Confirm `backend/src/tare-types/tare-types.module.ts` has `exports: [TareTypesService]` — Tasks 5 and 6 import this module. Add it if missing.

- [ ] **Step 6: Commit**

```bash
git add backend/src/tare-types
git commit -m "feat(tare-types): exactly one crate type, network-wide

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Issue crates

**Files:**
- Create: `backend/src/crates/dto/create-crate-issuance.dto.ts`
- Create: `backend/src/crates/crate-issuance.mapper.ts`
- Create: `backend/src/crates/crates.service.ts`
- Create: `backend/src/crates/crate-issuances.controller.ts`
- Create: `backend/src/crates/crates.module.ts`
- Modify: `backend/src/app.module.ts`
- Modify: `backend/src/audit/audit-log.entity.ts`
- Test: `backend/src/crates/crates.service.spec.ts`

**Interfaces:**
- Consumes: `nextIssuanceCode` (Task 2); `TareTypesService.findCrateType` (Task 4); `ShiftsService.findOpenAtPoint(pointId, manager?)`; `SuppliersService.findOne(actor, id)`; `CollectionPointsService.findOneRaw(id)`; `resolveWritePoint`, `resolvePointFilter`, from `auth/access/point-scope`; `AuditService.record(entry, manager)`.
- Produces:
  - `CrateIssuanceResponse` + `toCrateIssuanceResponse(issuance, shift)`
  - `CratesService.issue(actor, dto): Promise<CrateIssuanceResponse>`
  - Audit actions `crate-issuance.created`, `crate-issuance.voided`, `crate-return.created`, `crate-return.voided`

- [ ] **Step 1: Write the failing tests**

Create `backend/src/crates/crates.service.spec.ts`. Mock every collaborator; model the harness on `backend/src/payouts/payouts.service.spec.ts`.

```ts
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CratesService } from './crates.service';
import { CrateIssuanceMode } from './crate-issuance-mode.enum';
import { UserRole } from '../users/user-role.enum';

describe('CratesService.issue', () => {
  const operator = {
    sub: 'op-1',
    role: UserRole.PointOperator,
    collection_point_id: 'point-1',
  } as never;

  // …build `service` with jest mocks for repo, dataSource, shifts, suppliers,
  // points, tareTypes, audit, matching the constructor in Step 3…

  it('refuses when the point has no open shift', async () => {
    shifts.findOpenAtPoint.mockResolvedValue(null);

    await expect(
      service.issue(operator, { supplier_id: 's-1', units: 20, mode: CrateIssuanceMode.Deposit }),
    ).rejects.toMatchObject({ response: { code: 'NO_OPEN_SHIFT' } });
  });

  it('refuses a supplier belonging to another point, as a 404', async () => {
    suppliers.findOne.mockResolvedValue({ id: 's-1', collection_point_id: 'point-2', is_active: true });

    await expect(
      service.issue(operator, { supplier_id: 's-1', units: 20, mode: CrateIssuanceMode.Deposit }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses when no crate type is configured', async () => {
    tareTypes.findCrateType.mockResolvedValue(null);

    await expect(
      service.issue(operator, { supplier_id: 's-1', units: 20, mode: CrateIssuanceMode.Deposit }),
    ).rejects.toMatchObject({ response: { code: 'NO_CRATE_TYPE' } });
  });

  it('snapshots the catalogue price and computes the deposit', async () => {
    tareTypes.findCrateType.mockResolvedValue({ id: 't-1', deposit_price: '120.00' });

    await service.issue(operator, {
      supplier_id: 's-1',
      units: 20,
      mode: CrateIssuanceMode.Deposit,
    });

    expect(manager.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ deposit_per_unit: '120.00', deposit_taken: '2400.00', units: 20 }),
    );
  });

  /** §6.4 — «за розписку грошей немає взагалі». */
  it('writes zeros for a receipt issuance whatever the catalogue says', async () => {
    tareTypes.findCrateType.mockResolvedValue({ id: 't-1', deposit_price: '120.00' });

    await service.issue(operator, {
      supplier_id: 's-1',
      units: 200,
      mode: CrateIssuanceMode.Receipt,
    });

    expect(manager.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ deposit_per_unit: '0.00', deposit_taken: '0.00' }),
    );
  });

  it('does not enforce §6.2 threshold in either direction', async () => {
    tareTypes.findCrateType.mockResolvedValue({ id: 't-1', deposit_price: '120.00' });

    await expect(
      service.issue(operator, { supplier_id: 's-1', units: 200, mode: CrateIssuanceMode.Deposit }),
    ).resolves.toBeDefined();
    await expect(
      service.issue(operator, { supplier_id: 's-1', units: 5, mode: CrateIssuanceMode.Receipt }),
    ).resolves.toBeDefined();
  });

  it('refuses a deactivated supplier', async () => {
    suppliers.findOne.mockResolvedValue({ id: 's-1', collection_point_id: 'point-1', is_active: false });

    await expect(
      service.issue(operator, { supplier_id: 's-1', units: 20, mode: CrateIssuanceMode.Deposit }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npm test -w backend -- crates.service`
Expected: FAIL — cannot find module `./crates.service`.

- [ ] **Step 3: Write the DTO, mapper, service, controller and module**

Create `backend/src/crates/dto/create-crate-issuance.dto.ts`:

```ts
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { CrateIssuanceMode } from '../crate-issuance-mode.enum';

/**
 * WHAT IS ABSENT IS THE DESIGN. No `code` (the server generates it — the seam
 * is inverted relative to `intakes`, where the operator types what is printed
 * on paper), no `shift_id` (resolved from the point's open shift), no
 * `deposit_per_unit` and no `deposit_taken` (snapshotted and computed
 * server-side). Accepting any of them would make the catalogue decorative.
 *
 * `mode` IS ACCEPTED VERBATIM. §6.2's «до 50 завдаток, від 51 розписка» is a
 * default the client pre-selects; ticket #60: «ми не обмежуємо вибір».
 */
export class CreateCrateIssuanceDto {
  /** Owner only. An operator's point comes from their token. */
  @IsOptional()
  @IsUUID()
  collection_point_id?: string;

  @IsUUID()
  supplier_id: string;

  /** `Max` is a typo guard, not a business rule — the largest real issuance in
   *  the client's workbook is in the low hundreds. */
  @IsInt()
  @Min(1)
  @Max(10000)
  units: number;

  @IsEnum(CrateIssuanceMode)
  mode: CrateIssuanceMode;
}
```

Create `backend/src/crates/crate-issuance.mapper.ts`:

```ts
import { Shift } from '../shifts/shift.entity';
import { CrateIssuance } from './crate-issuance.entity';
import { CrateIssuanceMode } from './crate-issuance-mode.enum';

/** `collection_point_id` and `business_date` are joined in from the shift and
 *  stored nowhere — see `CrateIssuance`'s header. */
export interface CrateIssuanceResponse {
  id: string;
  code: string;
  shift_id: string;
  collection_point_id: string;
  business_date: string;
  supplier_id: string;
  units: number;
  mode: CrateIssuanceMode;
  deposit_per_unit: string;
  deposit_taken: string;
  issued_by_user_id: string;
  voided_at: string | null;
  voided_by_user_id: string | null;
  void_reason: string | null;
  created_at: string;
}

export function toCrateIssuanceResponse(
  issuance: CrateIssuance,
  shift: Shift,
): CrateIssuanceResponse {
  return {
    id: issuance.id,
    code: issuance.code,
    shift_id: issuance.shift_id,
    collection_point_id: shift.collection_point_id,
    business_date: shift.business_date,
    supplier_id: issuance.supplier_id,
    units: issuance.units,
    mode: issuance.mode,
    deposit_per_unit: issuance.deposit_per_unit,
    deposit_taken: issuance.deposit_taken,
    issued_by_user_id: issuance.issued_by_user_id,
    voided_at: issuance.voided_at ? issuance.voided_at.toISOString() : null,
    voided_by_user_id: issuance.voided_by_user_id,
    void_reason: issuance.void_reason,
    created_at: issuance.created_at.toISOString(),
  };
}
```

Create `backend/src/crates/crates.service.ts` with the constructor and `issue`. (Tasks 6 and 7 add `returnCrates`, `previewReturn`, `voidIssuance`, `voidReturn` to this same class.)

```ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CrateIssuance } from './crate-issuance.entity';
import { CrateIssuanceMode } from './crate-issuance-mode.enum';
import { CreateCrateIssuanceDto } from './dto/create-crate-issuance.dto';
import { CrateIssuanceResponse, toCrateIssuanceResponse } from './crate-issuance.mapper';
import { nextIssuanceCode } from './crate-code';
import { ShiftsService } from '../shifts/shifts.service';
import { SuppliersService } from '../suppliers/suppliers.service';
import { CollectionPointsService } from '../collection-points/collection-points.service';
import { TareTypesService } from '../tare-types/tare-types.service';
import { AuditService } from '../audit/audit.service';
import { mul } from '../common/money';
import { resolveWritePoint } from '../auth/access/point-scope';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

@Injectable()
export class CratesService {
  constructor(
    @InjectRepository(CrateIssuance)
    private readonly issuances: Repository<CrateIssuance>,
    private readonly dataSource: DataSource,
    private readonly shifts: ShiftsService,
    private readonly suppliers: SuppliersService,
    private readonly points: CollectionPointsService,
    private readonly tareTypes: TareTypesService,
    private readonly audit: AuditService,
  ) {}

  /**
   * §6.3 and §6.4 in one method — the two modes differ ONLY in money, and the
   * difference is three lines below, not two code paths.
   *
   * NO THRESHOLD CHECK. §6.2's «до 50 завдаток, від 51 розписка» is the
   * client's default selection; ticket #60 is explicit that the choice is not
   * restricted («ми не обмежуємо вибір»), and a server-side rule here would be
   * the blocking validation the client refused.
   *
   * NO `target_crates` CHECK EITHER. Правка 14: an unset target WARNS and never
   * blocks an issuance — «забороняти видачу через порожній target_crates
   * означало б відтворити скасовану заборону».
   */
  async issue(
    actor: AuthenticatedUser,
    dto: CreateCrateIssuanceDto,
  ): Promise<CrateIssuanceResponse> {
    const pointId = resolveWritePoint(actor, dto.collection_point_id);

    const point = await this.points.findOneRaw(pointId);
    if (!point) throw new NotFoundException('Collection point not found');

    const supplier = await this.suppliers.findOne(actor, dto.supplier_id);
    // 404, not 403 — these rows carry a real person's name.
    if (supplier.collection_point_id !== pointId) {
      throw new NotFoundException('Supplier not found');
    }
    if (!supplier.is_active) {
      throw new BadRequestException({
        message: 'That supplier is deactivated',
        code: 'SUPPLIER_INACTIVE',
      });
    }

    return this.dataSource.transaction(async (m) => {
      const shift = await this.shifts.findOpenAtPoint(pointId, m);
      if (!shift) {
        throw new ConflictException({
          message: 'No open shift at this point — open one first',
          code: 'NO_OPEN_SHIFT',
        });
      }

      // A receipt issuance never reads the catalogue price, but it DOES require
      // a crate type to exist: without one, «ящик» has no definition at this
      // network at all, and the units about to be recorded would mean nothing.
      const crateType = await this.tareTypes.findCrateType(m);
      if (!crateType) {
        throw new ConflictException({
          message: 'No crate type is configured — mark one tare type as the crate first',
          code: 'NO_CRATE_TYPE',
        });
      }

      // §2.7 — the SNAPSHOT. Repricing the catalogue never touches this row.
      const perUnit =
        dto.mode === CrateIssuanceMode.Receipt ? '0.00' : crateType.deposit_price;
      const taken =
        dto.mode === CrateIssuanceMode.Receipt ? '0.00' : mul(perUnit, String(dto.units));

      const code = await nextIssuanceCode(m, {
        pointCode: point.code,
        businessDate: shift.business_date,
        shiftId: shift.id,
        mode: dto.mode,
      });

      const issuance = await m.save(
        CrateIssuance,
        m.create(CrateIssuance, {
          code,
          shift_id: shift.id,
          supplier_id: supplier.id,
          units: dto.units,
          mode: dto.mode,
          deposit_per_unit: perUnit,
          deposit_taken: taken,
          issued_by_user_id: actor.sub,
        }),
      );

      await this.audit.record(
        {
          action: 'crate-issuance.created',
          actor_id: actor.sub,
          target_type: 'crate_issuance',
          target_id: issuance.id,
          after: {
            code,
            units: dto.units,
            mode: dto.mode,
            deposit_taken: taken,
            supplier_id: supplier.id,
          },
        },
        m,
      );

      return toCrateIssuanceResponse(issuance, shift);
    });
  }
}
```

Create `backend/src/crates/crate-issuances.controller.ts`:

```ts
import { Body, Controller, Post } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CratesService } from './crates.service';
import { CreateCrateIssuanceDto } from './dto/create-crate-issuance.dto';
import { CrateIssuanceResponse } from './crate-issuance.mapper';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * Crates going out. BOTH ROLES — handing crates over is a point action, and
 * §6.10 makes the balance the operator's own working number.
 */
@Controller('crate-issuances')
export class CrateIssuancesController {
  constructor(private readonly crates: CratesService) {}

  @Post()
  @Auth()
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateCrateIssuanceDto,
  ): Promise<CrateIssuanceResponse> {
    return this.crates.issue(actor, dto);
  }
}
```

Check the exact import path and name of the `@CurrentUser` decorator against `backend/src/payouts/payouts.controller.ts` and match it.

Create `backend/src/crates/crates.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CrateIssuance } from './crate-issuance.entity';
import { CrateReturn } from './crate-return.entity';
import { CrateReturnAllocation } from './crate-return-allocation.entity';
import { CratesService } from './crates.service';
import { CrateIssuancesController } from './crate-issuances.controller';
import { ShiftsModule } from '../shifts/shifts.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { CollectionPointsModule } from '../collection-points/collection-points.module';
import { TareTypesModule } from '../tare-types/tare-types.module';
import { AuditModule } from '../audit/audit.module';

/**
 * ONE MODULE, THREE TABLES. No separate `crate-balance` module: `supplier-
 * balance` and `point-cash` are their own modules because their queries span
 * tables owned by others, and this one reads only crate tables.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([CrateIssuance, CrateReturn, CrateReturnAllocation]),
    ShiftsModule,
    SuppliersModule,
    CollectionPointsModule,
    TareTypesModule,
    AuditModule,
  ],
  providers: [CratesService],
  controllers: [CrateIssuancesController],
  exports: [CratesService],
})
export class CratesModule {}
```

Register `CratesModule` in `backend/src/app.module.ts`'s `imports` array, beside the other feature modules.

- [ ] **Step 4: Add the audit actions**

In `backend/src/audit/audit-log.entity.ts`, add to `AUDIT_ACTIONS` after `'cash-count.recorded'`:

```ts
  'crate-issuance.created',
  'crate-issuance.voided',
  'crate-return.created',
  'crate-return.voided',
```

- [ ] **Step 5: Run the tests**

Run: `npm test -w backend -- crates.service`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/crates backend/src/app.module.ts backend/src/audit/audit-log.entity.ts
git commit -m "feat(crates): issue crates against a deposit or a receipt

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Return crates — tranches, allocation, preview

**Files:**
- Create: `backend/src/crates/dto/create-crate-return.dto.ts`
- Create: `backend/src/crates/crate-return.mapper.ts`
- Create: `backend/src/crates/crate-balance.service.ts`
- Create: `backend/src/crates/crate-balance.controller.ts`
- Create: `backend/src/crates/crate-returns.controller.ts`
- Modify: `backend/src/crates/crates.service.ts`
- Modify: `backend/src/crates/crates.module.ts`
- Test: `backend/src/crates/crates.service.spec.ts` (extend)

**Interfaces:**
- Consumes: `allocate`, `CrateTranche` (Task 3); everything Task 5 produced.
- Produces:
  - `CrateTrancheView = CrateTranche & { code: string; issued_at: string }`
  - `CrateBalanceResponse = { supplier_id: string; outstanding_units: number; deposit_held: string; tranches: CrateTrancheView[] }`
  - `CrateBalanceService.tranchesFor(supplierId, manager?): Promise<CrateTrancheView[]>`
  - `CrateBalanceService.balanceFor(supplierId, manager?): Promise<CrateBalanceResponse>`
  - `CrateReturnResponse` + `toCrateReturnResponse(ret, shift, allocations)`
  - `CratesService.returnCrates(actor, dto)`, `CratesService.previewReturn(actor, dto)`

- [ ] **Step 1: Write the failing tests**

Add to `backend/src/crates/crates.service.spec.ts`:

```ts
describe('CratesService.returnCrates', () => {
  const tranches = [
    { issuance_id: 'jul18', remaining_units: 20, per_unit: '120.00', mode: CrateIssuanceMode.Deposit },
    { issuance_id: 'jul28', remaining_units: 20, per_unit: '130.00', mode: CrateIssuanceMode.Deposit },
  ];

  it('locks the supplier row before reading tranches', async () => {
    balance.tranchesFor.mockResolvedValue(tranches);

    await service.returnCrates(operator, { supplier_id: 's-1', units: 7 });

    const [firstSql, firstParams] = manager.query.mock.calls[0] as [string, unknown[]];
    expect(firstSql).toContain('FOR UPDATE');
    expect(firstParams).toEqual(['s-1']);
  });

  it('writes the allocation rows and the frozen refund', async () => {
    balance.tranchesFor.mockResolvedValue(tranches);

    await service.returnCrates(operator, { supplier_id: 's-1', units: 7 });

    expect(manager.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ units: 7, deposit_refund: '840.00' }),
    );
  });

  /** §6.5 — «повернути більше, ніж узято, не можна… помилка вводу, а не подія». */
  it('refuses to return more than is outstanding, naming the number', async () => {
    balance.tranchesFor.mockResolvedValue([tranches[0]]);

    await expect(
      service.returnCrates(operator, { supplier_id: 's-1', units: 25 }),
    ).rejects.toMatchObject({ response: { code: 'RETURN_EXCEEDS_OUTSTANDING' } });
  });

  it('refuses when the point has no open shift', async () => {
    shifts.findOpenAtPoint.mockResolvedValue(null);

    await expect(
      service.returnCrates(operator, { supplier_id: 's-1', units: 5 }),
    ).rejects.toMatchObject({ response: { code: 'NO_OPEN_SHIFT' } });
  });

  /**
   * §6.7's assertion. It cannot fire under valid documents — FIFO guarantees a
   * refund never exceeds what that supplier deposited — so this test drives an
   * IMPOSSIBLE state deliberately to prove the guard is wired, not decorative.
   */
  it('refuses when the crates book would go negative', async () => {
    balance.tranchesFor.mockResolvedValue(tranches);
    balance.pointDepositBook.mockResolvedValue('100.00');

    await expect(
      service.returnCrates(operator, { supplier_id: 's-1', units: 7 }),
    ).rejects.toMatchObject({ response: { code: 'CRATE_CASH_INSUFFICIENT' } });
  });
});

describe('CratesService.previewReturn', () => {
  it('returns the split without writing anything', async () => {
    balance.tranchesFor.mockResolvedValue([
      { issuance_id: 'a', remaining_units: 20, per_unit: '120.00', mode: CrateIssuanceMode.Deposit },
      { issuance_id: 'b', remaining_units: 30, per_unit: '0.00', mode: CrateIssuanceMode.Receipt },
    ]);

    const preview = await service.previewReturn(operator, { supplier_id: 's-1', units: 45 });

    expect(preview.deposit_refund).toBe('2400.00');
    expect(preview.allocations).toHaveLength(2);
    expect(manager.save).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npm test -w backend -- crates.service`
Expected: FAIL — `service.returnCrates is not a function`.

- [ ] **Step 3: Write the DTO and the return mapper**

Create `backend/src/crates/dto/create-crate-return.dto.ts`:

```ts
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/**
 * No money, no allocations, no `shift_id`. WHICH issuances are repaid is the
 * server's FIFO answer — §6.5: the operator «нічого не питає і не обирає».
 */
export class CreateCrateReturnDto {
  @IsOptional()
  @IsUUID()
  collection_point_id?: string;

  @IsUUID()
  supplier_id: string;

  @IsInt()
  @Min(1)
  @Max(10000)
  units: number;
}
```

Create `backend/src/crates/crate-return.mapper.ts`:

```ts
import { Shift } from '../shifts/shift.entity';
import { CrateReturn } from './crate-return.entity';
import { CrateAllocationRow } from './crate-allocation';

export interface CrateReturnResponse {
  id: string;
  shift_id: string;
  collection_point_id: string;
  business_date: string;
  supplier_id: string;
  units: number;
  deposit_refund: string;
  allocations: CrateAllocationRow[];
  accepted_by_user_id: string;
  voided_at: string | null;
  voided_by_user_id: string | null;
  void_reason: string | null;
  created_at: string;
}

/** The allocations travel WITH the document: they are what the operator shows
 *  the supplier — «20 × 120,00 ₴», «25 за розпискою, без грошей» — and a total
 *  without them reads as a shortchange. */
export function toCrateReturnResponse(
  ret: CrateReturn,
  shift: Shift,
  allocations: CrateAllocationRow[],
): CrateReturnResponse {
  return {
    id: ret.id,
    shift_id: ret.shift_id,
    collection_point_id: shift.collection_point_id,
    business_date: shift.business_date,
    supplier_id: ret.supplier_id,
    units: ret.units,
    deposit_refund: ret.deposit_refund,
    allocations,
    accepted_by_user_id: ret.accepted_by_user_id,
    voided_at: ret.voided_at ? ret.voided_at.toISOString() : null,
    voided_by_user_id: ret.voided_by_user_id,
    void_reason: ret.void_reason,
    created_at: ret.created_at.toISOString(),
  };
}
```

- [ ] **Step 4: Write `crate-balance.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { CrateIssuanceMode } from './crate-issuance-mode.enum';
import { CrateTranche } from './crate-allocation';
import { mul, sum } from '../common/money';

export interface CrateTrancheView extends CrateTranche {
  code: string;
  issued_at: string;
}

export interface CrateBalanceResponse {
  supplier_id: string;
  outstanding_units: number;
  deposit_held: string;
  tranches: CrateTrancheView[];
}

/**
 * THE CRATES BOOK, IN SQL, IN ONE PLACE. Both the balance below and
 * `point-cash`'s crates figure read this file rather than re-deriving the
 * `voided_at IS NULL` filters that make it correct — the same discipline
 * `supplier-balance` holds for the berry debt.
 *
 * POINT-LIFETIME, NO DATE FLOOR. §7.5: «завдаток, узятий у липні, лежить у
 * шухляді в серпні», «від першої видачі». This is a DIFFERENT SHAPE from the
 * berry book, which is anchored on the last physical count and bounded by
 * `as_of`, and the two must not be made to share SQL.
 */
export const CRATE_BOOK_SQL = (point: string): string => `(
    COALESCE((SELECT SUM(ci.deposit_taken)
         FROM crate_issuances ci
         JOIN shifts cs ON cs.id = ci.shift_id
        WHERE cs.collection_point_id = ${point}
          AND ci.voided_at IS NULL), 0.00)
  - COALESCE((SELECT SUM(cr.deposit_refund)
         FROM crate_returns cr
         JOIN shifts rs ON rs.id = cr.shift_id
        WHERE rs.collection_point_id = ${point}
          AND cr.voided_at IS NULL), 0.00)
)`;

@Injectable()
export class CrateBalanceService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Open tranches, OLDEST FIRST, with `created_at` then `id` as the order —
   * the `intakes` tiebreaker, because two documents in one millisecond are
   * ordinary rather than exceptional.
   *
   * `remaining` is DERIVED, never stored (§3.2). A voided return releases its
   * allocations here, by the `cr.voided_at IS NULL` filter on the join, and no
   * allocation row is ever deleted.
   */
  async tranchesFor(supplierId: string, manager?: EntityManager): Promise<CrateTrancheView[]> {
    const runner = manager ?? this.dataSource.manager;
    const rows: Array<{
      issuance_id: string;
      code: string;
      per_unit: string;
      mode: CrateIssuanceMode;
      issued_at: Date;
      remaining_units: string | number;
    }> = await runner.query(
      `SELECT ci.id            AS issuance_id,
              ci.code          AS code,
              ci.deposit_per_unit AS per_unit,
              ci.mode          AS mode,
              ci.created_at    AS issued_at,
              (ci.units - COALESCE((
                  SELECT SUM(a.units)
                    FROM crate_return_allocations a
                    JOIN crate_returns cr ON cr.id = a.return_id
                   WHERE a.issuance_id = ci.id
                     AND cr.voided_at IS NULL), 0))::int AS remaining_units
         FROM crate_issuances ci
        WHERE ci.supplier_id = $1
          AND ci.voided_at IS NULL
        ORDER BY ci.created_at ASC, ci.id ASC`,
      [supplierId],
    );

    return rows
      .map((row) => ({
        issuance_id: row.issuance_id,
        code: row.code,
        per_unit: row.per_unit,
        mode: row.mode,
        issued_at: new Date(row.issued_at).toISOString(),
        remaining_units: Number(row.remaining_units),
      }))
      .filter((tranche) => tranche.remaining_units > 0);
  }

  /** §6.3's header — «у цієї людини вже на руках 20 ящ., завдатку за них 2 400 ₴». */
  async balanceFor(supplierId: string, manager?: EntityManager): Promise<CrateBalanceResponse> {
    const tranches = await this.tranchesFor(supplierId, manager);
    const held = tranches.map((t) => mul(t.per_unit, String(t.remaining_units)));

    return {
      supplier_id: supplierId,
      outstanding_units: tranches.reduce((total, t) => total + t.remaining_units, 0),
      deposit_held: held.length ? sum(held) : '0.00',
      tranches,
    };
  }

  /** The point's crates drawer (spec §4.3). One number, no `as_of`. */
  async pointDepositBook(pointId: string, manager?: EntityManager): Promise<string> {
    const runner = manager ?? this.dataSource.manager;
    const rows: Array<{ book: string }> = await runner.query(
      `SELECT ${CRATE_BOOK_SQL('$1')} AS book`,
      [pointId],
    );
    return rows[0]?.book ?? '0.00';
  }
}
```

`Number()` on a row count is not money; if eslint's guard (Task 3) flags this file, convert with `Number.parseInt(String(row.remaining_units), 10)` only if the rule permits it — otherwise remove `crate-balance.service.ts` from the guard list and note in the config that its only arithmetic is on integer unit counts.

- [ ] **Step 5: Add `returnCrates` and `previewReturn` to `CratesService`**

Add the imports (`CrateReturn`, `CrateReturnAllocation`, `CreateCrateReturnDto`, `toCrateReturnResponse`, `allocate`, `CrateBalanceService`, `lt`) and the `CrateBalanceService` constructor parameter, then:

```ts
  /**
   * §6.5 — the oldest issuance first, at the price it was taken at. The
   * operator chooses nothing.
   *
   * THE SUPPLIER ROW IS LOCKED FIRST, exactly as `PayoutsService.create` locks
   * it: the tranches are a read-then-write over a derived sum, and no CHECK can
   * express «not more than is outstanding». Without the lock two returns in
   * flight both read `remaining = 20`, both allocate it, and the supplier is
   * refunded twice for one set of crates.
   *
   * OVER-RETURN IS A 400, NEVER A SILENT CLAMP. Правка 15's case — 25 arrive
   * against 20 issued — is resolved at the counter: 20 enter the system and the
   * other 5 are the supplier's own, swapped for empties, «в системі це не
   * записується». A server that quietly wrote 20 when asked for 25 would be
   * editing a document.
   */
  async returnCrates(
    actor: AuthenticatedUser,
    dto: CreateCrateReturnDto,
  ): Promise<CrateReturnResponse> {
    const pointId = resolveWritePoint(actor, dto.collection_point_id);

    const supplier = await this.suppliers.findOne(actor, dto.supplier_id);
    if (supplier.collection_point_id !== pointId) {
      throw new NotFoundException('Supplier not found');
    }

    return this.dataSource.transaction(async (m) => {
      await m.query('SELECT id FROM suppliers WHERE id = $1 FOR UPDATE', [dto.supplier_id]);

      const shift = await this.shifts.findOpenAtPoint(pointId, m);
      if (!shift) {
        throw new ConflictException({
          message: 'No open shift at this point — open one first',
          code: 'NO_OPEN_SHIFT',
        });
      }

      // Read INSIDE the transaction, under the lock — otherwise the value
      // checked is not the value that was locked.
      const tranches = await this.balance.tranchesFor(dto.supplier_id, m);
      const result = allocate(tranches, dto.units);

      if (result.shortfall > 0) {
        const outstanding = dto.units - result.shortfall;
        // The message NAMES the number, because a refusal the operator cannot
        // act on just gets retried with the same input.
        throw new BadRequestException({
          message: `That supplier is holding ${outstanding} crates, not ${dto.units}`,
          code: 'RETURN_EXCEEDS_OUTSTANDING',
        });
      }

      /**
       * §6.7, AND IT SHOULD NEVER FIRE. FIFO guarantees a refund never exceeds
       * what this supplier deposited, so the point's crates book cannot go
       * negative through any sequence of valid documents. It ships anyway: if
       * it ever fires, the data is wrong, and a named 409 beats a silently
       * negative drawer. The REAL §6.7 risk — deposit cash spent on berries out
       * of the one physical drawer — is invisible to a book nobody counts.
       */
      const book = await this.balance.pointDepositBook(pointId, m);
      if (lt(book, result.deposit_refund)) {
        throw new ConflictException({
          message: `The crate deposits book holds ${book}, less than the ${result.deposit_refund} this return refunds`,
          code: 'CRATE_CASH_INSUFFICIENT',
        });
      }

      const ret = await m.save(
        CrateReturn,
        m.create(CrateReturn, {
          shift_id: shift.id,
          supplier_id: supplier.id,
          units: dto.units,
          deposit_refund: result.deposit_refund,
          accepted_by_user_id: actor.sub,
        }),
      );

      for (const row of result.allocations) {
        await m.save(
          CrateReturnAllocation,
          m.create(CrateReturnAllocation, {
            return_id: ret.id,
            issuance_id: row.issuance_id,
            units: row.units,
            per_unit: row.per_unit,
            amount: row.amount,
          }),
        );
      }

      await this.audit.record(
        {
          action: 'crate-return.created',
          actor_id: actor.sub,
          target_type: 'crate_return',
          target_id: ret.id,
          after: {
            units: dto.units,
            deposit_refund: result.deposit_refund,
            supplier_id: supplier.id,
          },
        },
        m,
      );

      return toCrateReturnResponse(ret, shift, result.allocations);
    });
  }

  /**
   * Create minus the write — the same seam as `POST /intakes/preview`.
   *
   * IT EXISTS BECAUSE THE SERVER OWNS FIFO. The reception screen must show
   * «20 × 120,00 = 2 400,00 ₴» before the operator commits; if the only way to
   * learn that number were to POST the return, the client would reimplement the
   * allocator to fill the label, and the two would disagree the first time a
   * void landed.
   *
   * NO LOCK AND NO SHIFT CHECK: nothing is written, and a preview that refused
   * outside a shift would be useless exactly when the operator is deciding
   * whether to open one.
   */
  async previewReturn(
    actor: AuthenticatedUser,
    dto: CreateCrateReturnDto,
  ): Promise<{ allocations: CrateAllocationRow[]; deposit_refund: string; shortfall: number }> {
    const pointId = resolveWritePoint(actor, dto.collection_point_id);
    const supplier = await this.suppliers.findOne(actor, dto.supplier_id);
    if (supplier.collection_point_id !== pointId) {
      throw new NotFoundException('Supplier not found');
    }

    const tranches = await this.balance.tranchesFor(dto.supplier_id);
    return allocate(tranches, dto.units);
  }
```

- [ ] **Step 6: Write the two controllers**

Create `backend/src/crates/crate-returns.controller.ts` with `POST /crate-returns` → `returnCrates` and `POST /crate-returns/preview` → `previewReturn`, both `@Auth()`, following the shape of `crate-issuances.controller.ts` from Task 5.

Create `backend/src/crates/crate-balance.controller.ts`:

```ts
import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CrateBalanceService, CrateBalanceResponse } from './crate-balance.service';
import { SuppliersService } from '../suppliers/suppliers.service';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/** §6.3's header and the reception screen's «на руках». `SuppliersService.findOne`
 *  is what enforces point scope — a supplier at another point 404s there. */
@Controller('suppliers')
export class CrateBalanceController {
  constructor(
    private readonly balance: CrateBalanceService,
    private readonly suppliers: SuppliersService,
  ) {}

  @Get(':id/crate-balance')
  @Auth()
  async bySupplier(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CrateBalanceResponse> {
    await this.suppliers.findOne(actor, id);
    return this.balance.balanceFor(id);
  }
}
```

Register `CrateBalanceService` as a provider, export it, and add both controllers in `crates.module.ts`.

- [ ] **Step 7: Run the tests**

Run: `npm test -w backend -- crates`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/src/crates
git commit -m "feat(crates): FIFO returns with allocations and a preview

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Voids

**Files:**
- Modify: `backend/src/crates/crates.service.ts`
- Modify: `backend/src/crates/crate-issuances.controller.ts`
- Modify: `backend/src/crates/crate-returns.controller.ts`
- Test: `backend/src/crates/crates.service.spec.ts` (extend)

**Interfaces:**
- Consumes: `VoidDocumentDto` from `../intakes/dto/void-document.dto` (reused, as `payouts` reuses it); everything Tasks 5–6 produced.
- Produces: `CratesService.voidIssuance(actor, id, dto)`, `CratesService.voidReturn(actor, id, dto)`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('voids', () => {
  it('lets an operator void a COLLEAGUE’s document at their own point', async () => {
    loadIssuance({ issued_by_user_id: 'someone-else', shift: { collection_point_id: 'point-1', closed_at: null } });

    await expect(
      service.voidIssuance(operator, 'i-1', { reason: 'помилка вводу' }),
    ).resolves.toBeDefined();
  });

  it('refuses an operator voiding a CLOSED shift’s document', async () => {
    loadIssuance({ shift: { collection_point_id: 'point-1', closed_at: new Date() } });

    await expect(
      service.voidIssuance(operator, 'i-1', { reason: 'помилка' }),
    ).rejects.toMatchObject({ response: { code: 'SHIFT_CLOSED' } });
  });

  it('lets the owner void a closed shift’s document', async () => {
    loadIssuance({ shift: { collection_point_id: 'point-9', closed_at: new Date() } });

    await expect(
      service.voidIssuance(owner, 'i-1', { reason: 'перевірка' }),
    ).resolves.toBeDefined();
  });

  it('404s a document at another point for an operator', async () => {
    loadIssuance({ shift: { collection_point_id: 'point-2', closed_at: null } });

    await expect(
      service.voidIssuance(operator, 'i-1', { reason: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  /** §9.3 — «видачу, на яку вже лягло повернення, сторнувати не можна». */
  it('refuses to void an issuance that has live allocations', async () => {
    loadIssuance({ shift: { collection_point_id: 'point-1', closed_at: null } });
    manager.query.mockImplementation((sql: string) =>
      sql.includes('crate_return_allocations') ? Promise.resolve([{ n: 1 }]) : Promise.resolve([]),
    );

    await expect(
      service.voidIssuance(operator, 'i-1', { reason: 'x' }),
    ).rejects.toMatchObject({ response: { code: 'ISSUANCE_HAS_RETURNS' } });
  });

  it('refuses to void an already-voided document', async () => {
    loadIssuance({ voided_at: new Date(), shift: { collection_point_id: 'point-1', closed_at: null } });

    await expect(
      service.voidIssuance(operator, 'i-1', { reason: 'x' }),
    ).rejects.toMatchObject({ response: { code: 'ALREADY_VOIDED' } });
  });

  it('voiding a return does not delete its allocations', async () => {
    loadReturn({ shift: { collection_point_id: 'point-1', closed_at: null } });

    await service.voidReturn(operator, 'r-1', { reason: 'перерахували' });

    const deletes = (manager.query.mock.calls as [string][]).filter(([sql]) =>
      sql.includes('DELETE'),
    );
    expect(deletes).toHaveLength(0);
    expect(manager.delete).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npm test -w backend -- crates.service`
Expected: FAIL — `service.voidIssuance is not a function`.

- [ ] **Step 3: Implement the authority helper and both voids**

Add to `CratesService`:

```ts
  /**
   * §9.4 AS AMENDED BY THE CLIENT, 2026-09-15 — and the amendment is the whole
   * reason this is not `PayoutsService.loadForWrite`.
   *
   * The rules table says «ящиковий документ → тільки керівник». The client
   * relaxed it: an operator may void ANY crate document at their OWN point
   * while that shift is OPEN. No author check — §10.6's mid-shift cashier swap
   * routinely leaves the person at the counter holding a colleague's mistake.
   *
   * A CLOSED SHIFT IS STILL THE OWNER'S ALONE («квитанція минулого дня → тільки
   * керівник»), and that bound is load-bearing: spec §7 lets a void drop a
   * taken deposit straight out of the crates book with no counted figure
   * anywhere to notice. Today's mistake is the operator's to fix; last week's
   * is not.
   */
  private assertMayVoid(
    actor: AuthenticatedUser,
    shift: { collection_point_id: string; closed_at: Date | null },
  ): void {
    if (actor.role === UserRole.NetworkOwner) return;

    if (actor.collection_point_id !== shift.collection_point_id) {
      // 404 upstream, not 403 — see `loadIssuanceForWrite`.
      throw new NotFoundException('Document not found');
    }
    if (shift.closed_at) {
      throw new ForbiddenException({
        message: 'That shift is closed — ask the network owner',
        code: 'SHIFT_CLOSED',
      });
    }
  }

  async voidIssuance(
    actor: AuthenticatedUser,
    id: string,
    dto: VoidDocumentDto,
  ): Promise<CrateIssuanceResponse> {
    // THE LOAD AND THE STATE CHECK ARE INSIDE THE TRANSACTION, under the row
    // lock: checking `voided_at` before the transaction opens is a
    // check-then-write, and two taps produce two audit entries naming possibly
    // different actors while `voided_by_user_id` is last-writer-wins.
    return this.dataSource.transaction(async (m) => {
      const issuance = await m.findOne(CrateIssuance, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!issuance) throw new NotFoundException('Crate issuance not found');

      const shift = await this.shifts.findOneRaw(issuance.shift_id, m);
      if (!shift) throw new NotFoundException('Crate issuance not found');
      if (
        actor.role !== UserRole.NetworkOwner &&
        actor.collection_point_id !== shift.collection_point_id
      ) {
        throw new NotFoundException('Crate issuance not found');
      }

      this.assertMayVoid(actor, shift);

      if (issuance.voided_at) {
        throw new ConflictException({
          message: 'That issuance is already voided',
          code: 'ALREADY_VOIDED',
        });
      }

      /**
       * §9.3 — «видачу, на яку вже лягло повернення, сторнувати не можна, поки
       * не сторновано повернення». Voiding it out from under a live allocation
       * would refund crates that, on the books, were never issued.
       */
      const live: Array<{ n: number }> = await m.query(
        `SELECT count(*)::int AS n
           FROM crate_return_allocations a
           JOIN crate_returns cr ON cr.id = a.return_id
          WHERE a.issuance_id = $1 AND cr.voided_at IS NULL`,
        [id],
      );
      if (live[0]?.n > 0) {
        throw new ConflictException({
          message: 'A return has already been allocated against this issuance — void the return first',
          code: 'ISSUANCE_HAS_RETURNS',
        });
      }

      issuance.voided_at = new Date();
      issuance.voided_by_user_id = actor.sub;
      issuance.void_reason = dto.reason;
      const saved = await m.save(CrateIssuance, issuance);

      await this.audit.record(
        {
          action: 'crate-issuance.voided',
          actor_id: actor.sub,
          target_type: 'crate_issuance',
          target_id: saved.id,
          after: { code: saved.code, units: saved.units, deposit_taken: saved.deposit_taken },
          note: dto.reason,
        },
        m,
      );

      return toCrateIssuanceResponse(saved, shift);
    });
  }
```

Write `voidReturn` in the same shape, with three differences: it loads `CrateReturn`, it has **no allocation check** (a return is the thing being undone), and it **deletes nothing** — the allocations stay, and `tranchesFor`'s `cr.voided_at IS NULL` filter is what returns their capacity to the tranches. Give it this comment:

```ts
  /**
   * VOIDING A RETURN RESTORES TRANCHE CAPACITY WITHOUT TOUCHING A SINGLE
   * ALLOCATION ROW. The capacity comes back through `cr.voided_at IS NULL` in
   * `tranchesFor`; deleting the rows would destroy the evidence §9.3 keeps
   * «НАЗАВЖДИ з печаткою» and make the refund unexplainable afterwards.
   *
   * The money leaves the crates book at the same instant, by the same filter in
   * `CRATE_BOOK_SQL`. Spec §7: cash physically changing hands afterwards is an
   * out-of-system act — правка 11, «система підказує, а керівник вирішує… за
   * межами системи».
   */
```

Add `POST /crate-issuances/:id/void` and `POST /crate-returns/:id/void` to their controllers, both `@Auth()`, taking `@Body() dto: VoidDocumentDto` and `@Param('id', ParseUUIDPipe) id: string`.

- [ ] **Step 4: Run the tests**

Run: `npm test -w backend -- crates.service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/crates
git commit -m "feat(crates): void an issuance or a return, point-scoped to an open shift

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Lists

**Files:**
- Create: `backend/src/crates/dto/list-crate-issuances.query.ts`
- Create: `backend/src/crates/dto/list-crate-returns.query.ts`
- Modify: `backend/src/crates/crate-balance.service.ts` (add the two list methods)
- Modify: `backend/src/crates/crate-issuances.controller.ts`, `crate-returns.controller.ts`
- Test: `backend/src/crates/crate-balance.service.spec.ts`

**Interfaces:**
- Consumes: `PaginationQueryDto`, `skipOf`, `Paginated<T>`; `resolvePointFilter`.
- Produces: `CrateBalanceService.listIssuances(actor, query): Promise<Paginated<CrateIssuanceResponse>>`, `listReturns(actor, query): Promise<Paginated<CrateReturnResponse>>`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/crates/crate-balance.service.spec.ts` with a mocked query builder (copy the builder-mock shape from `backend/src/payouts/payouts.service.spec.ts`):

```ts
describe('CrateBalanceService.listIssuances', () => {
  it('pins an operator to their own point whatever they ask for', async () => {
    await service.listIssuances(operator, { page: 1, limit: 20, collection_point_id: 'point-9' });
    expect(qb.andWhere).toHaveBeenCalledWith('s.collection_point_id = :pointId', {
      pointId: 'point-1',
    });
  });

  it('hides voided rows unless asked', async () => {
    await service.listIssuances(owner, { page: 1, limit: 20 });
    expect(qb.andWhere).toHaveBeenCalledWith('i.voided_at IS NULL');
  });

  /** The owner's voided-deposit list (spec §7, decision 10's second guard). */
  it('can list ONLY voided deposit issuances', async () => {
    await service.listIssuances(owner, {
      page: 1,
      limit: 20,
      voided: true,
      mode: CrateIssuanceMode.Deposit,
    });
    expect(qb.andWhere).toHaveBeenCalledWith('i.voided_at IS NOT NULL');
    expect(qb.andWhere).toHaveBeenCalledWith('i.mode = :mode', {
      mode: CrateIssuanceMode.Deposit,
    });
  });

  /** Ticket #58 — «показати усі розписки постачальника в його аккаунті». */
  it('filters by supplier and mode together', async () => {
    await service.listIssuances(owner, {
      page: 1,
      limit: 20,
      supplier_id: 's-1',
      mode: CrateIssuanceMode.Receipt,
    });
    expect(qb.andWhere).toHaveBeenCalledWith('i.supplier_id = :supplierId', { supplierId: 's-1' });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -w backend -- crate-balance`
Expected: FAIL — `service.listIssuances is not a function`.

- [ ] **Step 3: Write the query DTOs**

`backend/src/crates/dto/list-crate-issuances.query.ts`:

```ts
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CrateIssuanceMode } from '../crate-issuance-mode.enum';

/**
 * `voided` IS THREE-VALUED ON PURPOSE. Unset hides voided rows (the journal);
 * `true` shows ONLY them, which is the owner's incident list — the crate
 * equivalent of `GET /cash-counts?only_discrepancies=true`, and what «notify
 * the owner» means in a project with no email.
 */
export class ListCrateIssuancesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  collection_point_id?: string;

  @IsOptional()
  @IsUUID()
  supplier_id?: string;

  @IsOptional()
  @IsEnum(CrateIssuanceMode)
  mode?: CrateIssuanceMode;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  voided?: boolean;
}
```

Write `list-crate-returns.query.ts` the same way, without `mode`.

- [ ] **Step 4: Implement both list methods**

In `CrateBalanceService`, using the repository query-builder pattern from `PayoutsService.list` — `innerJoinAndMapOne` the shift, apply `resolvePointFilter`, then:

```ts
    if (query.voided === true) qb.andWhere('i.voided_at IS NOT NULL');
    else if (!query.voided) qb.andWhere('i.voided_at IS NULL');
```

Order by `i.created_at DESC`, then `i.id ASC`; page with `skipOf(query)` and `query.limit`; map through `toCrateIssuanceResponse`. For returns, load each document's allocation rows in ONE query keyed by the page's return ids (never per row — that is an N+1 on a paginated list) and pass them to `toCrateReturnResponse`.

Add `GET /crate-issuances` and `GET /crate-returns` to their controllers, both `@Auth()`.

- [ ] **Step 5: Run the tests**

Run: `npm test -w backend -- crate`
Expected: PASS, the whole crates unit suite.

- [ ] **Step 6: Commit**

```bash
git add backend/src/crates
git commit -m "feat(crates): journal, supplier receipts and the owner's voided-deposit list

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: The crates figure on the point's cash screen

**Files:**
- Modify: `backend/src/point-cash/point-cash.service.ts`
- Modify: `backend/src/point-cash/point-cash.module.ts`
- Modify: `backend/src/cash-counts/cash-book.enum.ts`
- Test: `backend/src/point-cash/point-cash.service.spec.ts` (extend)

**Interfaces:**
- Consumes: `CRATE_BOOK_SQL` (Task 6).
- Produces: `crate_deposits: string` on both point-cash responses.

- [ ] **Step 1: Write the failing test**

```ts
it('reports the crates book as its own field, never folded into cash', async () => {
  const row = await service.forPoint(owner, 'point-1', { as_of: '2026-09-15' });

  expect(row.crate_deposits).toBe('2400.00');
  expect(row.cash).not.toBe('2400.00');
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -w backend -- point-cash`
Expected: FAIL — `crate_deposits` is `undefined`.

- [ ] **Step 3: Add the figure**

Import `CRATE_BOOK_SQL` from `../crates/crate-balance.service`, add it as a selected expression in both the list SQL and the single-point SQL, and add `crate_deposits` to the response interface and mapper. Replace the `WHAT IS NOT HERE` paragraph in the service header with:

```
 * THE CRATES BOOK IS HERE NOW, AND IT IS A SEPARATE FIELD. §7.6: «фізично
 * шухляда одна, книг дві». `crate_deposits` is never added to `cash` — a sum
 * without `GROUP BY book` is exactly what `cash-book.enum.ts` exists to make
 * impossible to write by accident.
 *
 * IT DOES NOT HONOUR `as_of`, AND THAT IS NOT AN OVERSIGHT. §7.5 gives the
 * crates book no lower bound — «від першої видачі» — and no physical count to
 * anchor on, because this book is never counted (spec §4.3). It is a
 * point-lifetime running sum, which is a different shape from the berry book
 * on the same screen; the field name and this comment are what keep a reader
 * from "fixing" one into the other.
```

In `backend/src/cash-counts/cash-book.enum.ts`, replace the paragraph claiming no deposit has ever been taken:

```
 * `crates` IS NOW A REAL BOOK, but it is DERIVED, not counted: `point-cash`
 * reports `Σ deposit_taken − Σ deposit_refund` and no `cash_counts` row is
 * ever written with `book = 'crates'`. The problem named below is therefore
 * DEFERRED, not solved — and it stays deferred deliberately (spec §4.3):
 * правка 10 keeps crate money «тільки в межах точки», so it reconciles against
 * nothing and needs no counted figure to be useful. The day it gets counted,
 * the void semantics of spec §7 come back for review in the same slice.
```

Import `CratesModule` into `PointCashModule` if the SQL constant's import requires it (a bare exported function needs no module import — prefer that).

- [ ] **Step 4: Run the tests**

Run: `npm test -w backend -- point-cash`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/point-cash backend/src/cash-counts/cash-book.enum.ts
git commit -m "feat(point-cash): report the crate deposits book as its own figure

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: DB-backed proof — lifecycle and races

**Files:**
- Create: `backend/src/crates/crates.db-spec.ts`
- Create: `backend/src/crates/crates-race.db-spec.ts`

**Interfaces:**
- Consumes: the whole module.
- Produces: nothing code depends on.

- [ ] **Step 1: Write the lifecycle spec**

Create `backend/src/crates/crates.db-spec.ts`. Boot the real `AppModule` the way `backend/src/point-cash/point-cash.db-spec.ts` does, call `relaxThrottleForTests()` BEFORE importing `AppModule`, and sign tokens with the app's own `JwtService` rather than calling `/auth/login` (the login throttle is shared across the file). Cover, over HTTP:

1. Issue 20 against a deposit at 120,00 → `deposit_taken` is `2400.00`, `code` matches `^[A-Z0-9]+-CD-\d{8}-\d{3}$`.
2. Issue 200 against a receipt → `deposit_per_unit` and `deposit_taken` are `0.00`, code kind is `CR`, and its sequence is `001` — proving the two counters are independent.
3. `GET /suppliers/:id/crate-balance` → `outstanding_units` 220, `deposit_held` `2400.00`, two tranches.
4. `POST /crate-returns/preview` for 210 → allocations `[20 @ 120.00, 190 @ 0.00]`, refund `2400.00`; and no row is written (re-read the balance and assert it is unchanged).
5. `POST /crate-returns` for 210 → refund `2400.00`; balance now 10 units, `0.00` held.
6. Return 11 more → 400 `RETURN_EXCEEDS_OUTSTANDING` naming 10.
7. Void the first issuance → 409 `ISSUANCE_HAS_RETURNS`.
8. Void the return → 200; balance back to 220 units and `2400.00` held; the allocation rows still exist (`SELECT count(*)` direct against the table).
9. Void the first issuance now → 200; `GET /point-cash/:pointId` reports `crate_deposits` of `0.00`.

- [ ] **Step 2: Run it and fix what it finds**

Run: `npm run test:db -w backend -- crates.db-spec`
Expected: PASS. Any failure here is a real defect in Tasks 5–9 — fix the source, never the assertion.

- [ ] **Step 3: Write the race spec**

Create `backend/src/crates/crates-race.db-spec.ts`, modelled on `backend/src/payouts/payout-race.db-spec.ts`:

```ts
it('two concurrent returns for one supplier cannot double-allocate', async () => {
  // Issue 20 @ 120.00. Then fire two returns of 20 in parallel.
  const [a, b] = await Promise.allSettled([
    post('/crate-returns', { supplier_id, units: 20 }),
    post('/crate-returns', { supplier_id, units: 20 }),
  ]);

  const statuses = [a, b].map((r) => (r.status === 'fulfilled' ? r.value.status : 500));
  expect(statuses.filter((s) => s === 201)).toHaveLength(1);
  expect(statuses.filter((s) => s === 400)).toHaveLength(1);

  const [{ n }] = await ds.query(
    `SELECT COALESCE(SUM(units), 0)::int AS n FROM crate_return_allocations WHERE issuance_id = $1`,
    [issuanceId],
  );
  expect(n).toBe(20);
});

it('two concurrent issuances in one shift and mode get distinct codes', async () => {
  const results = await Promise.all([
    post('/crate-issuances', { supplier_id, units: 5, mode: 'deposit' }),
    post('/crate-issuances', { supplier_id, units: 5, mode: 'deposit' }),
  ]);

  const codes = results.map((r) => r.body.code);
  expect(new Set(codes).size).toBe(2);
  expect(results.every((r) => r.status === 201)).toBe(true);
});
```

- [ ] **Step 4: Run it**

Run: `npm run test:db -w backend -- crates-race`
Expected: PASS. If the second test returns a 409 on a duplicate code, the advisory lock in `crate-code.ts` is not being taken inside the same transaction as the insert — fix that, not the test.

- [ ] **Step 5: Commit**

```bash
git add backend/src/crates
git commit -m "test(crates): lifecycle and race proof against a real Postgres

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Dev seed

**Files:**
- Modify: `backend/src/seed/dev-seed.data.ts`
- Modify: `backend/src/seed/dev-seed.ts`
- Modify: `backend/src/seed/dev-seed.spec.ts`

**Interfaces:**
- Consumes: `nextIssuanceCode`, `allocate`.
- Produces: `SEED_CRATE_ISSUANCES`, `SEED_CRATE_RETURNS`.

- [ ] **Step 1: Correct the catalogue and add the data**

In `dev-seed.data.ts`, change `Ящик` to `is_crate: false` (Чешка at 120,00 ₴ stays the crate — §6.3's example is built on that price), then add, after `SEED_PAYOUTS`:

```ts
export interface SeedCrateIssuance {
  point: string;
  supplier: string;
  /** 'yesterday' | 'today' — resolved to that point's seeded shift. */
  day: 'yesterday' | 'today';
  units: number;
  mode: 'deposit' | 'receipt';
  operator: string;
}

/**
 * Оксана holds TWO deposit tranches at DIFFERENT prices, so §6.5's rule has a
 * real case on a fresh database: the older one is partially returned below and
 * the refund comes from it, not from the catalogue. Тарас holds a receipt
 * issuance so ticket #58's list is non-empty.
 */
export const SEED_CRATE_ISSUANCES: readonly SeedCrateIssuance[] = [
  { point: 'Шипинки', supplier: 'Оксана Іваніна', day: 'yesterday', units: 20, mode: 'deposit', operator: 'oksana' },
  { point: 'Шипинки', supplier: 'Оксана Іваніна', day: 'today', units: 20, mode: 'deposit', operator: 'oksana' },
  { point: 'Шипинки', supplier: 'Тарас Гнатюк', day: 'today', units: 200, mode: 'receipt', operator: 'oksana' },
];

export interface SeedCrateReturn {
  point: string;
  supplier: string;
  day: 'today';
  units: number;
  operator: string;
}

export const SEED_CRATE_RETURNS: readonly SeedCrateReturn[] = [
  { point: 'Шипинки', supplier: 'Оксана Іваніна', day: 'today', units: 7, operator: 'oksana' },
];
```

Use supplier and operator names that actually exist in `SEED_SUPPLIERS` and `SEED_OPERATORS` — read those arrays and substitute; the names above are placeholders **only** for the two identifiers, and the shape is exact.

- [ ] **Step 2: Seed them**

In `dev-seed.ts`'s `seedDocuments`, after the payouts block, insert crates idempotently. Look each issuance up by its natural key before inserting, exactly as the surrounding code does. Compose codes with `nextIssuanceCode(qr.manager, …)` and compute the refund with `allocate(...)` over the tranches read back from the database — **never with a hand-written number**, which is the seed's standing rule: it asks the server for its figures so the demo cannot drift from the rule the API enforces.

- [ ] **Step 3: Extend the seed's own consistency spec**

In `dev-seed.spec.ts`, add:

```ts
it('flags exactly one tare type as the crate', () => {
  expect(SEED_TARE_TYPES.filter((t) => t.is_crate)).toHaveLength(1);
});

it('never returns more crates than a supplier was issued', () => {
  for (const ret of SEED_CRATE_RETURNS) {
    const issued = SEED_CRATE_ISSUANCES
      .filter((i) => i.supplier === ret.supplier && i.point === ret.point)
      .reduce((n, i) => n + i.units, 0);
    expect(ret.units).toBeLessThanOrEqual(issued);
  }
});
```

- [ ] **Step 4: Run both suites**

Run: `npm test -w backend -- dev-seed` then `npm run test:db -w backend -- dev-seed`
Expected: PASS, including the existing idempotency test — run the seed twice and confirm no duplicate crate rows.

- [ ] **Step 5: Commit**

```bash
git add backend/src/seed
git commit -m "feat(seed): crates on Шипинки, one crate type in the catalogue

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: The records of truth

**Files:**
- Modify: `28-db-schema.dbml`
- Modify: `26-rules-by-example.md`
- Modify: `docs/26-правки-і-запитання.md`
- Modify: `backend/CLAUDE.md`
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md`

**Interfaces:**
- Consumes: every decision above.
- Produces: documents that no longer contradict the code.

- [ ] **Step 1: `28-db-schema.dbml`**

- `crate_issuances`: rename `receipt_no varchar` to `code varchar [not null, unique]`. Rewrite its Note: ЗАПИТАННЯ 2 is CLOSED (generated, two counters, `CR`/`CD`); §6.2's threshold is a client default; the receipt/deposit money asymmetry is a CHECK; add that `tare_type_id` is absent by decision and why.
- `crate_return_allocations` Note: replace «§6.6 — розписка й завдаток не змішуються навіть у поверненні» with the amended rule — one queue across modes, money unmixed by construction because a receipt tranche's `per_unit` is 0 — and name the client instruction of 2026-09-15 as its source.
- `tare_types` Note: `is_crate` is now EXCLUSIVE (`UQ_tare_types_single_crate`), and ЗАПИТАННЯ 12's two halves close SEPARATELY — counting stays one number, money needs the single crate — so the sentence «обидва боки… закриються вони разом» is no longer true.
- The «**Відкрите, і не полагоджене**» block after the crates book formula: replace with the decision — a void drops the deposit immediately, no settlement trio, mitigated by the open-shift bound and the owner's voided list, and the trigger to revisit is the day the crate drawer is counted.
- Update the header's table inventory if it counts implemented tables.

- [ ] **Step 2: `26-rules-by-example.md`**

- §6.6: replace the rule line with the amendment, keeping the original text visible as superseded (this file's convention is to record reversals, not erase them), citing the client instruction of 2026-09-15.
- §6.4's «→ Примітка»: ЗАПИТАННЯ 2 is answered — generated by the system, written onto the paper by hand.
- §9.4: the «ящиковий документ → тільки керівник» line is relaxed to «свій пункт, відкрита зміна → приймальник; закрита зміна → тільки керівник», with the reason and the date.

- [ ] **Step 3: `docs/26-правки-і-запитання.md`**

ЗАПИТАННЯ 2 and пропозиція 2 both still read «ввід руками (вільний текст), без генерації». Mark both resolved: generated, format `{POINT}-{CR|CD}-{YYYYMMDD}-{NNN}`, implemented in this slice.

- [ ] **Step 4: `backend/CLAUDE.md` and root `CLAUDE.md`**

- `backend/CLAUDE.md`: add the `crates/` line to the module map, in the same voice as its neighbours. Update the `cash-counts/` and `point-cash/` lines to mention the derived crates figure.
- Root `CLAUDE.md`: the Architecture «Domain» paragraph says three tables remain, all of them crates. They no longer do — say the schema of record is complete, and add the crates slice's spec and plan to the list of documents.

- [ ] **Step 5: Follow-ups**

Append to `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md`, each with one line of why it was deferred: `crate_shipments` and §6.8's dispatch; §6.9's «порожніх» term and the `target_crates` comparison; a counted crates drawer together with the settlement trio for voided crate money; the reception screen's intake↔return pairing (ticket #57's client half); §6.2's threshold living only in the client.

- [ ] **Step 6: Full verification**

```bash
npm run lint
npm test
npm run test:db -w backend
npm run build
```
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "docs(crates): reconcile the records of truth with the slice

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Self-review notes

**Spec coverage.** Spec §4.1 → Tasks 3, 6. §4.2 → Tasks 1, 4. §4.3 → Tasks 6, 9. §5.1–5.3 → Task 1. §5.4 → Tasks 1, 4. §5.5 → Task 6 (`tranchesFor` derives `remaining`). §6 surface → Tasks 5–8. §7.1 → Task 3. §7.2 → Task 2. §7.3 → Task 6. §7.4 → Task 7. §7.5 refusals → Tasks 5–7. §8 → Tasks 1, 3, 5–8, 10, 11. §9 out-of-scope → Task 12 follow-ups. §10 → Task 12. §11 risks → recorded in Task 12's DBML and follow-up edits.

**Names used consistently across tasks:** `CrateIssuanceMode`, `allocate`, `CrateTranche`, `CrateAllocationRow`, `CrateAllocationResult`, `nextIssuanceCode`, `padSequence`, `CRATE_BOOK_SQL`, `tranchesFor`, `balanceFor`, `pointDepositBook`, `issue`, `returnCrates`, `previewReturn`, `voidIssuance`, `voidReturn`, `findCrateType`, `toCrateIssuanceResponse`, `toCrateReturnResponse`.

**Two places a worker must read the repo rather than trust this plan:** the exact `@CurrentUser` decorator import (Task 5, copy from `payouts.controller.ts`) and the seeded supplier/operator names (Task 11). Both are called out at their step.

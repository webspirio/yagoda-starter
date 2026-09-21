# Yagoda §8 Reweigh & Cost-of-Day Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record the base's second weighing and the day's expenses, and compute — never store — недостача, собівартість дня, and the network's average price.

**Architecture:** Four new tables. `reweighs` is a columnless header, one per shift, whose lines accumulate freely and are voided individually; `day_expenses` hangs off the shift and is mutable. Every hryvnia in §8 is derived at read time from the intake side through `common/money.ts`, which grows `div` and `allocate`. Nothing about §8 is snapshotted, so a late line moves a past day's cost — deliberately.

**Tech Stack:** NestJS 11 (Express), TypeORM + PostgreSQL 16, Jest (`*.spec.ts` mocked, `*.db-spec.ts` against a real Postgres), `class-validator` DTOs.

**Spec:** `docs/superpowers/specs/2026-09-17-yagoda-reweigh-slice.md`

## Global Constraints

- **`numeric` values are strings end to end.** No `*`, `/`, `Number()`, `parseFloat`, `parseInt`, `toFixed` on a money or weight value anywhere. All arithmetic goes through `src/common/money.ts` (foundation §5.1).
- **Scale 2 everywhere**, half-up away from zero (spec §3.14).
- **Owner-only:** every route in this slice is `@Auth(UserRole.NetworkOwner)`, reads included (spec §3.10).
- **`synchronize: false`.** Entities and migrations are written by hand and must agree; `catalog-schema.db-spec.ts` and friends are the proof.
- **Documents are never edited.** `reweigh_items` has no `PATCH`; a correction is a void plus a new line. `day_expenses` is the single deliberate exception (spec §3.8).
- **Никогда `Number()`** — the eslint `no-restricted-globals`/`no-restricted-syntax` block in `backend/eslint.config.mjs` must be extended to `src/reweighs/**/*.ts` and `src/day-costs/**/*.ts` in Task 3 and Task 7 respectively.
- **Migration filenames continue the sequence:** `1788600000013-YagodaReweigh.ts`, `1788600000014-YagodaDayExpenses.ts`.
- **Branch:** `feat/yagoda-reweigh-slice` in the main checkout — no worktree. PR-A is Tasks 1–6; PR-B branches from PR-A's head as `feat/yagoda-cost-of-day` and is Tasks 7–11.
- **Commit trailer:** every commit ends with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

---

# PR-A — schema, weighing, reconciliation (§8.1, §8.2)

### Task 1: `money.ts` grows `div` and `allocate`

**Files:**
- Modify: `backend/src/common/money.ts`
- Test: `backend/src/common/money.spec.ts`

**Interfaces:**
- Consumes: the private `parse`/`format`/`UNIT`/`SCALE` internals already in the file.
- Produces: `div(a: string, b: string): string` and `allocate(total: string, weights: string[]): string[]`, both imported by Tasks 5, 9 and 10.

- [ ] **Step 1: Write the failing tests**

Append to `backend/src/common/money.spec.ts`:

```ts
import { add, sub, mul, sum, div, allocate } from './money';

describe('div', () => {
  it('rounds the quotient half-up away from zero at scale 2', () => {
    // §8.4's own numbers: 5 460,00 ÷ 854 кг = 6,3934… → 6,39
    expect(div('5460.00', '854.00')).toBe('6.39');
    expect(div('128000.00', '800.00')).toBe('160.00');
    // 162,0253… → 162,03 (half-up, not half-even)
    expect(div('128000.00', '790.00')).toBe('162.03');
  });

  it('mirrors a negative dividend rather than rounding toward -Infinity', () => {
    // Half-up AWAY FROM ZERO, so the negative is the exact mirror of the
    // positive — the same policy `mul` documents for a negative `bonus`.
    expect(div('-5460.00', '854.00')).toBe('-6.39');
    expect(div('5460.00', '-854.00')).toBe('-6.39');
    expect(div('-5460.00', '-854.00')).toBe('6.39');
    // 0,125 → 0,13 up; −0,125 → −0,13 down. Half-to-even would give 0,12.
    expect(div('1.00', '8.00')).toBe('0.13');
    expect(div('-1.00', '8.00')).toBe('-0.13');
  });

  it('throws on a zero divisor rather than returning a placeholder', () => {
    expect(() => div('100.00', '0.00')).toThrow(/divide by zero/i);
  });
});

describe('allocate', () => {
  it('splits pro-rata and the parts sum EXACTLY to the total', () => {
    const parts = allocate('100.00', ['1.00', '1.00', '1.00']);
    expect(sum(parts)).toBe('100.00');
    // largest-remainder: the kopiyka goes to the first largest weight
    expect(parts).toEqual(['33.34', '33.33', '33.33']);
  });

  it('splits by weight, not evenly', () => {
    expect(allocate('2000.00', ['128000.00', '32000.00'])).toEqual(['1600.00', '400.00']);
  });

  it('gives the whole total to a single line', () => {
    expect(allocate('2000.00', ['128000.00'])).toEqual(['2000.00']);
  });

  it('splits evenly when every weight is zero', () => {
    const parts = allocate('10.00', ['0.00', '0.00', '0.00', '0.00']);
    expect(sum(parts)).toBe('10.00');
    expect(parts).toEqual(['2.50', '2.50', '2.50', '2.50']);
  });

  it('mirrors a negative total', () => {
    expect(allocate('-100.00', ['1.00', '1.00', '1.00'])).toEqual([
      '-33.34',
      '-33.33',
      '-33.33',
    ]);
  });

  it('returns an empty array for no weights', () => {
    expect(allocate('100.00', [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd backend && npm test -- src/common/money.spec.ts`
Expected: FAIL — `div is not a function`, `allocate is not a function`.

- [ ] **Step 3: Implement both, in `money.ts`, using only `bigint`**

Append to `backend/src/common/money.ts`:

```ts
/**
 * Scale-2 quotient, HALF-UP AWAY FROM ZERO — the same policy `mul` uses, for
 * the same reason (foundation §5.1, «applied where paper shows a number»).
 *
 * THROWS ON ZERO rather than returning '0.00'. §8.6 is explicit that a day
 * with no weight is «—» and «Це не нуль», and a function that quietly answers
 * zero is how that distinction gets lost three call sites later. Every caller
 * checks the empty case first and renders the dash itself.
 *
 * §8.5's paper arithmetic prints `166,9114` at scale 4. That belongs to the
 * «усе на один товар» strategy this slice does not implement; §8.4's own
 * numbers are scale 2, and so is this.
 */
export function div(a: string, b: string): string {
  const ua = parse(a);
  const ub = parse(b);
  if (ub === 0n) throw new Error('money: divide by zero');

  // Scale the dividend by UNIT twice: once to undo the divisor's scale, once
  // to reach the scale-2 answer, plus one more digit to round on.
  const negative = ua < 0n !== ub < 0n;
  const magnitude = (ua < 0n ? -ua : ua) * UNIT * 10n;
  const divisor = ub < 0n ? -ub : ub;
  const scaled = magnitude / divisor; // scale 3
  const rounded = (scaled + 5n) / 10n; // +0.0005, floor -> half-up
  return format(negative ? -rounded : rounded);
}

/**
 * Split `total` across `weights` pro-rata, LARGEST REMAINDER.
 *
 * The parts sum exactly to the total — that is the whole point, and it is what
 * §8.4's звірка checks on screen: «жодна гривня не загубилася і не з'явилася з
 * нічого». Multiplying each weight by a rounded ratio drifts by a kopiyka per
 * line, which is invisible on a fixture and wrong on a real day.
 *
 * All-zero weights split EVENLY rather than throwing: a доплата against a
 * receipt whose lines are all free (bonus −price) is degenerate but real, and
 * refusing to allocate it would lose the money entirely.
 */
export function allocate(total: string, weights: string[]): string[] {
  if (weights.length === 0) return [];

  const target = parse(total);
  const negative = target < 0n;
  const magnitude = negative ? -target : target;

  const parsed = weights.map((w) => {
    const u = parse(w);
    return u < 0n ? -u : u;
  });
  const totalWeight = parsed.reduce((acc, w) => acc + w, 0n);

  // Even split when there is nothing to be proportional to.
  const basis = totalWeight === 0n ? parsed.map(() => 1n) : parsed;
  const basisTotal = basis.reduce((acc, w) => acc + w, 0n);

  const floors = basis.map((w) => (magnitude * w) / basisTotal);
  const remainders = basis.map((w, i) => (magnitude * w) % basisTotal);

  let left = magnitude - floors.reduce((acc, f) => acc + f, 0n);
  const order = remainders
    .map((r, i) => ({ r, i }))
    .sort((x, y) => (y.r === x.r ? x.i - y.i : y.r > x.r ? 1 : -1));

  const result = [...floors];
  for (const { i } of order) {
    if (left <= 0n) break;
    result[i] += 1n;
    left -= 1n;
  }

  return result.map((u) => format(negative ? -u : u));
}
```

- [ ] **Step 4: Run the tests and make them pass**

Run: `cd backend && npm test -- src/common/money.spec.ts`
Expected: PASS, including the pre-existing `mul`/`sum` cases.

- [ ] **Step 5: Commit**

```bash
git checkout -b feat/yagoda-reweigh-slice
git add backend/src/common/money.ts backend/src/common/money.spec.ts
git commit -m "feat(money): add div and allocate for §8 cost-of-day arithmetic

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Schema — DBML, migration, entities

**Files:**
- Modify: `28-db-schema.dbml`
- Create: `backend/src/migrations/1788600000013-YagodaReweigh.ts`
- Create: `backend/src/reweighs/reweigh.entity.ts`
- Create: `backend/src/reweighs/reweigh-item.entity.ts`
- Create: `backend/src/reweighs/reweigh-item-tare-type.entity.ts`
- Test: `backend/src/migrations/reweigh-schema.db-spec.ts`

**Interfaces:**
- Consumes: `Shift`, `ProductGrade`, `TareType`, `User` entities.
- Produces: `Reweigh { id, shift_id, created_at, updated_at, items? }`, `ReweighItem { id, reweigh_id, item_order, product_grade_id, gross_kg, pallet_kg, tare_weight_kg, net_kg, weighed_by_user_id, voided_at, voided_by_user_id, void_reason, created_at, updated_at, tare? }`, `ReweighItemTareType { item_id, tare_type_id, units }`.

- [ ] **Step 1: Write the failing schema spec**

Create `backend/src/migrations/reweigh-schema.db-spec.ts`, modelled on `crates-schema.db-spec.ts`:

```ts
import { DataSource } from 'typeorm';
import { createTestDataSource } from '../testing/db-harness';

describe('reweigh schema', () => {
  let ds: DataSource;
  beforeAll(async () => {
    ds = await createTestDataSource();
  });
  afterAll(async () => {
    await ds.destroy();
  });

  const columns = async (table: string) =>
    ds.query(
      `SELECT column_name, data_type, is_nullable, numeric_scale
         FROM information_schema.columns WHERE table_name = $1 ORDER BY column_name`,
      [table],
    );

  it('creates the three tables', async () => {
    for (const t of ['reweighs', 'reweigh_items', 'reweigh_item_tare_types']) {
      const rows = await ds.query(`SELECT to_regclass($1) AS t`, [t]);
      expect(rows[0].t).toBe(t);
    }
  });

  it('has NO code, NO posted_at and NO void columns on the header (spec §3.3, §3.4, §3.11)', async () => {
    const names = (await columns('reweighs')).map((c: { column_name: string }) => c.column_name);
    expect(names.sort()).toEqual(['created_at', 'id', 'shift_id', 'updated_at']);
  });

  it('allows exactly one reweigh per shift', async () => {
    const rows = await ds.query(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'reweighs'`,
    );
    expect(rows.some((r: { indexdef: string }) => /UNIQUE.*\(shift_id\)/i.test(r.indexdef))).toBe(
      true,
    );
  });

  it('stores every weight as numeric with scale 2', async () => {
    const weights = (await columns('reweigh_items')).filter((c: { column_name: string }) =>
      c.column_name.endsWith('_kg'),
    );
    expect(weights).toHaveLength(4);
    for (const w of weights) {
      expect(w.data_type).toBe('numeric');
      expect(w.numeric_scale).toBe(2);
    }
  });

  it('refuses a partially filled void trio', async () => {
    await expect(
      ds.query(
        `INSERT INTO reweigh_items (reweigh_id, item_order, product_grade_id, gross_kg,
           pallet_kg, tare_weight_kg, net_kg, weighed_by_user_id, voided_at)
         VALUES (gen_random_uuid(), 1, gen_random_uuid(), 1, 0, 0, 1, gen_random_uuid(), now())`,
      ),
    ).rejects.toThrow();
  });

  it('refuses a non-positive net weight', async () => {
    const rows = await ds.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname = 'CHK_reweigh_items_net_kg'`,
    );
    expect(rows[0].def).toMatch(/net_kg.*> *\(?0/);
  });

  it('allows two lines of the SAME grade in one header (spec §3.15)', async () => {
    const rows = await ds.query(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'reweigh_items'`,
    );
    expect(
      rows.some((r: { indexdef: string }) => /UNIQUE.*product_grade_id/i.test(r.indexdef)),
    ).toBe(false);
    expect(
      rows.some((r: { indexdef: string }) => /UNIQUE.*\(reweigh_id, item_order\)/i.test(r.indexdef)),
    ).toBe(true);
  });

  it('cascades lines and tare from the header, and RESTRICTs the shift', async () => {
    const fks = await ds.query(
      `SELECT c.conname, confdeltype, t.relname AS tbl
         FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
        WHERE c.contype = 'f' AND t.relname LIKE 'reweigh%'`,
    );
    const byName = Object.fromEntries(
      fks.map((f: { conname: string; confdeltype: string }) => [f.conname, f.confdeltype]),
    );
    expect(byName['FK_reweighs_shift']).toBe('r');
    expect(byName['FK_reweigh_items_reweigh']).toBe('c');
    expect(byName['FK_reweigh_item_tare_types_item']).toBe('c');
    expect(byName['FK_reweigh_item_tare_types_tare_type']).toBe('r');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npm run test:db -- src/migrations/reweigh-schema.db-spec.ts`
Expected: FAIL — `to_regclass` returns `null`, tables do not exist.

- [ ] **Step 3: Write the migration**

Create `backend/src/migrations/1788600000013-YagodaReweigh.ts`:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The reweigh slice — spec `docs/superpowers/specs/2026-09-17-yagoda-reweigh-slice.md`.
 * The first tables in this schema that describe the BASE rather than a point.
 *
 * FOUR THINGS A READER SHOULD NOT "FIX":
 *
 * 1. `reweighs` HAS NO COLUMNS OF ITS OWN, and that is the design (spec §3.2).
 *    It is one row per shift whose only job is to be the parent of lines that
 *    accumulate across deliveries. The columns it is waiting for are §8.5's
 *    `expense_allocation` + `allocation_product_id`, which strategy ③ «усе на
 *    один товар» will need — see the follow-ups file.
 * 2. THERE IS NO `posted_at` AND NO STATUS (spec §3.3). Собівартість is computed
 *    live from whatever lines exist. §8.2's «звірка видна ДО проведення» is
 *    implemented as the open-shift rule in the reconciliation read, not as a
 *    posting gate, because §8.1 puts the weighing a day after the shift and
 *    §8.7 puts it in different hands than §10.3 puts the closing.
 * 3. VOID IS ON THE LINE, AND THE HEADER HAS NO `void_*` (spec §3.4). §8.7's own
 *    storno reason is «переважили не ту партію» — a batch. A header-level void
 *    would throw away a day to fix one pallet.
 * 4. NO `code` (spec §3.11). `code` exists where a human walks away holding the
 *    paper (§6.2). Nothing is printed at the base. `transfers` and
 *    `intake_top_ups` decided the same way for the same reason.
 *
 * `reweigh_items` CARRIES TIMESTAMPS although `intake_items` does not: an intake
 * line is frozen with its parent, while a reweigh line is written and voided on
 * its own, days after its header.
 */
export class YagodaReweigh1788600000013 implements MigrationInterface {
  name = 'YagodaReweigh1788600000013';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "reweighs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "shift_id" uuid NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_reweighs" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_reweighs_shift" UNIQUE ("shift_id"),
        CONSTRAINT "FK_reweighs_shift" FOREIGN KEY ("shift_id")
          REFERENCES "shifts"("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "reweigh_items" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "reweigh_id" uuid NOT NULL,
        "item_order" integer NOT NULL,
        "product_grade_id" uuid NOT NULL,
        "gross_kg" numeric(10,2) NOT NULL,
        "pallet_kg" numeric(10,2) NOT NULL DEFAULT 0,
        "tare_weight_kg" numeric(10,2) NOT NULL,
        "net_kg" numeric(10,2) NOT NULL,
        "weighed_by_user_id" uuid NOT NULL,
        "voided_at" TIMESTAMP WITH TIME ZONE,
        "voided_by_user_id" uuid,
        "void_reason" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_reweigh_items" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_reweigh_items_order" UNIQUE ("reweigh_id", "item_order"),
        CONSTRAINT "FK_reweigh_items_reweigh" FOREIGN KEY ("reweigh_id")
          REFERENCES "reweighs"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_reweigh_items_product_grade" FOREIGN KEY ("product_grade_id")
          REFERENCES "product_grades"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_reweigh_items_weighed_by" FOREIGN KEY ("weighed_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_reweigh_items_voided_by" FOREIGN KEY ("voided_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_reweigh_items_gross_kg" CHECK ("gross_kg" > 0),
        CONSTRAINT "CHK_reweigh_items_pallet_kg" CHECK ("pallet_kg" >= 0),
        CONSTRAINT "CHK_reweigh_items_tare_weight_kg" CHECK ("tare_weight_kg" >= 0),
        -- §8.1's net is what remains after the pallet and then the tare. A line
        -- that nets to zero or less is a measurement error, not a document.
        CONSTRAINT "CHK_reweigh_items_net_kg" CHECK ("net_kg" > 0),
        CONSTRAINT "CHK_reweigh_items_order" CHECK ("item_order" > 0),
        CONSTRAINT "CHK_reweigh_items_void_trio"
          CHECK (num_nulls("voided_at", "voided_by_user_id", "void_reason") IN (0, 3))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_reweigh_items_reweigh" ON "reweigh_items" ("reweigh_id")`,
    );
    // The reconciliation groups by grade over a whole header.
    await queryRunner.query(
      `CREATE INDEX "IDX_reweigh_items_grade" ON "reweigh_items" ("product_grade_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "reweigh_item_tare_types" (
        "item_id" uuid NOT NULL,
        "tare_type_id" uuid NOT NULL,
        "units" integer NOT NULL,
        CONSTRAINT "PK_reweigh_item_tare_types" PRIMARY KEY ("item_id", "tare_type_id"),
        CONSTRAINT "FK_reweigh_item_tare_types_item" FOREIGN KEY ("item_id")
          REFERENCES "reweigh_items"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_reweigh_item_tare_types_tare_type" FOREIGN KEY ("tare_type_id")
          REFERENCES "tare_types"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_reweigh_item_tare_types_units" CHECK ("units" > 0)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "reweigh_item_tare_types"`);
    await queryRunner.query(`DROP TABLE "reweigh_items"`);
    await queryRunner.query(`DROP TABLE "reweighs"`);
  }
}
```

- [ ] **Step 4: Write the three entities**

Create `backend/src/reweighs/reweigh.entity.ts`:

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Shift } from '../shifts/shift.entity';
import { ReweighItem } from './reweigh-item.entity';

/**
 * The day at the base. ONE ROW PER SHIFT, and no columns of its own.
 *
 * It is not an omission — see the migration's header. The header exists so that
 * lines accumulate under one parent across however many trips the berries came
 * on («не має значення, скільки разів ягоду привозили; важливо лише, яку зміну
 * ми зважуємо»), and so that §8.5's strategy ③ has somewhere to put
 * `expense_allocation` and `allocation_product_id` when it lands.
 *
 * THERE IS NO `collection_point_id` AND NO `business_date`, for the same reason
 * `intakes` has neither: both come from `shift_id`. §8.1 — «документ належить
 * ДНЮ ЯГОДИ, а не дню заїзду машини»: a batch from 4 August weighed on the
 * morning of the 5th is still the 4th's, and the FK is what says so.
 *
 * NOT VOIDABLE. Voiding is per line (§8.7). A header whose every line is voided
 * is a day with no net weight, which §8.6 already names: the cell is empty,
 * «Це не нуль».
 */
@Entity('reweighs')
@Unique('UQ_reweighs_shift', ['shift_id'])
export class Reweigh {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  shift_id: string;

  @ManyToOne(() => Shift, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'shift_id' })
  shift?: Shift;

  @OneToMany(() => ReweighItem, (item) => item.reweigh, { eager: false })
  items?: ReweighItem[];

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
```

Create `backend/src/reweighs/reweigh-item.entity.ts`:

```ts
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { ProductGrade } from '../products/product-grade.entity';
import { User } from '../users/user.entity';
import { Reweigh } from './reweigh.entity';
import { ReweighItemTareType } from './reweigh-item-tare-type.entity';

/**
 * ONE WEIGHING ON THE SCALE — §8.1's `701,50 − 18,00 − 138,00 = 545,50`.
 *
 * THE DOCUMENT IS THIS ROW, not its header. It carries the author, the void
 * trio and its own timestamps, because §8.7 voids a «партія» and because a line
 * is written days after the header it hangs from.
 *
 * IMMUTABLE. There is no `PATCH` and no update path in the service. With no
 * posting moment (spec §3.3) this row's `created_at` is the only freeze point
 * §8 has; if it were editable, yesterday's собівартість could be rewritten with
 * no journal trace, which is precisely what the `void_*` convention exists to
 * prevent. A correction is a void plus a new line (§9.3).
 *
 * NO `price` AND NO `amount`, deliberately (spec §3.6). Недостача is valued from
 * the INTAKE side at the weighted average actually accrued, because it is not
 * new money — it is the slice of already-accrued money with no berries behind
 * it. A price column here would be a second, different answer to a question
 * that already has one.
 *
 * `tare_weight_kg` IS A SNAPSHOT (§2.5, §2.7). `tare_types.weight_kg` is
 * editable by the owner; without the snapshot, changing «Чешка» from 1,20 to
 * 1,25 would silently rewrite last week's net weight and the недостача with it.
 *
 * SEVERAL LINES MAY NAME THE SAME GRADE — there is no unique index on
 * `(reweigh_id, product_grade_id)`, because several pallets of one berry across
 * several deliveries is the normal case. `item_order` is APPEND-ONLY: a voided
 * line keeps its number and the next line takes the next.
 */
@Entity('reweigh_items')
@Unique('UQ_reweigh_items_order', ['reweigh_id', 'item_order'])
@Check('CHK_reweigh_items_gross_kg', `"gross_kg" > 0`)
@Check('CHK_reweigh_items_pallet_kg', `"pallet_kg" >= 0`)
@Check('CHK_reweigh_items_tare_weight_kg', `"tare_weight_kg" >= 0`)
@Check('CHK_reweigh_items_net_kg', `"net_kg" > 0`)
@Check('CHK_reweigh_items_order', `"item_order" > 0`)
@Check(
  'CHK_reweigh_items_void_trio',
  `num_nulls("voided_at", "voided_by_user_id", "void_reason") IN (0, 3)`,
)
@Index('IDX_reweigh_items_reweigh', ['reweigh_id'])
@Index('IDX_reweigh_items_grade', ['product_grade_id'])
export class ReweighItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  reweigh_id: string;

  @ManyToOne(() => Reweigh, (r) => r.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reweigh_id' })
  reweigh?: Reweigh;

  /** Append-only within the header. Voided lines keep their number. */
  @Column({ type: 'int' })
  item_order: number;

  @Column({ type: 'uuid' })
  product_grade_id: string;

  @ManyToOne(() => ProductGrade, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_grade_id' })
  product_grade?: ProductGrade;

  /** Every weight below is `numeric` — a STRING, never a number. */
  @Column({ type: 'numeric', precision: 10, scale: 2 })
  gross_kg: string;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 0 })
  pallet_kg: string;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  tare_weight_kg: string;

  /** §8.1 — `(gross − pallet) − tare`, PALLET FIRST, same order as §2.4. Never
   *  entered by a human. */
  @Column({ type: 'numeric', precision: 10, scale: 2 })
  net_kg: string;

  @Column({ type: 'uuid' })
  weighed_by_user_id: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'weighed_by_user_id' })
  weighed_by?: User;

  @Column({ type: 'timestamptz', nullable: true })
  voided_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  voided_by_user_id: string | null;

  /** MANDATORY when voided — §8.7's button is inactive until it is typed. */
  @Column({ type: 'text', nullable: true })
  void_reason: string | null;

  @OneToMany(() => ReweighItemTareType, (t) => t.item, { cascade: ['insert'], eager: false })
  tare?: ReweighItemTareType[];

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
```

Create `backend/src/reweighs/reweigh-item-tare-type.entity.ts`:

```ts
import { Check, Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { TareType } from '../tare-types/tare-type.entity';
import { ReweighItem } from './reweigh-item.entity';

/**
 * §8.1's «115 Чешок × 1,20 кг» — the breakdown behind the line's snapshotted
 * `tare_weight_kg`.
 *
 * WHY THE BREAKDOWN IS KEPT AND NOT JUST THE TOTAL: §8.2's reconciliation is a
 * dispute screen. When the point says 800 and the base says 790, «115 ящиків по
 * 1,20» is the line of the argument that gets checked, and a bare `138,00` is
 * not checkable.
 *
 * NOT RESTRICTED TO THE `is_crate` TYPE. Pallets and Чешки are both in play
 * here; `is_crate` is about deposits (§6.1), not about weight.
 *
 * §2.6 STILL HOLDS: these counts and `crate_returns` never add up into one
 * number. Nothing here joins to the crate tables.
 */
@Entity('reweigh_item_tare_types')
@Check('CHK_reweigh_item_tare_types_units', `"units" > 0`)
export class ReweighItemTareType {
  @PrimaryColumn({ type: 'uuid' })
  item_id: string;

  @ManyToOne(() => ReweighItem, (item) => item.tare, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'item_id' })
  item?: ReweighItem;

  @PrimaryColumn({ type: 'uuid' })
  tare_type_id: string;

  @ManyToOne(() => TareType, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tare_type_id' })
  tare_type?: TareType;

  @Column({ type: 'int' })
  units: number;
}
```

- [ ] **Step 5: Register the entities and the migration**

In `backend/src/data-source.ts`, add the three entity classes to the `entities` array and `YagodaReweigh1788600000013` to `migrations`, following exactly how `CrateIssuance` / `YagodaCrates1788600000012` are listed.

- [ ] **Step 6: Update the DBML**

In `28-db-schema.dbml`, after the crates block, add the three tables in the file's existing style, each with a `Note` that repeats the four "do not fix" points from the migration header verbatim in Ukrainian. Update the file's header comment: the count becomes **twenty-two tables**, and the sentence about `intake_top_ups` being «the only table the DBML gained after its original seventeen» gains «…до слайсу переважування 17.09.2026».

- [ ] **Step 7: Run the schema spec and the whole DB suite**

Run: `cd backend && npm run test:db`
Expected: PASS — the new spec and every pre-existing one (the migration must not disturb them).

- [ ] **Step 8: Commit**

```bash
git add 28-db-schema.dbml backend/src/migrations backend/src/reweighs backend/src/data-source.ts
git commit -m "feat(reweigh): add reweighs, reweigh_items and reweigh_item_tare_types

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Writing a line — `POST /shifts/:shiftId/reweigh-items`

**Files:**
- Create: `backend/src/reweighs/dto/create-reweigh-item.dto.ts`
- Create: `backend/src/reweighs/reweigh-item.mapper.ts`
- Create: `backend/src/reweighs/reweighs.service.ts`
- Create: `backend/src/reweighs/reweighs.controller.ts`
- Create: `backend/src/reweighs/reweighs.module.ts`
- Modify: `backend/src/app.module.ts`, `backend/eslint.config.mjs`, `backend/src/audit/audit-log.entity.ts`
- Test: `backend/src/reweighs/reweighs.service.spec.ts`, `backend/src/reweighs/reweighs.db-spec.ts`

**Interfaces:**
- Consumes: `div`, `sub`, `mul`, `sum` from `common/money`; `ShiftsService.findOneRaw`; `TareTypesService.findOne`; `AuditService.record`; `Auth`, `CurrentUser`, `AuthenticatedUser`.
- Produces: `ReweighsService.addItem(actor, shiftId, dto): Promise<ReweighItemResponse>` and the `ReweighItemResponse` shape used by Tasks 4 and 5.

- [ ] **Step 1: Write the DTO**

Create `backend/src/reweighs/dto/create-reweigh-item.dto.ts`:

```ts
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsPositive,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';

/** A decimal string with at most two places — the only shape `money.ts` accepts. */
const DECIMAL = /^\d+(\.\d{1,2})?$/;

export class ReweighTareLineDto {
  @IsUUID()
  tare_type_id: string;

  @IsInt()
  @IsPositive()
  units: number;
}

export class CreateReweighItemDto {
  @IsUUID()
  product_grade_id: string;

  @Matches(DECIMAL, { message: 'gross_kg must be a decimal with at most 2 places' })
  gross_kg: string;

  @IsOptional()
  @Matches(DECIMAL, { message: 'pallet_kg must be a decimal with at most 2 places' })
  pallet_kg?: string;

  /**
   * The BREAKDOWN, not a total. `tare_weight_kg` is never accepted from the
   * client — it is computed from the catalogue and snapshotted (§2.5, §2.7).
   */
  @IsArray()
  @ArrayMinSize(0)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ReweighTareLineDto)
  tare: ReweighTareLineDto[];
}
```

- [ ] **Step 2: Write the failing service spec**

Create `backend/src/reweighs/reweighs.service.spec.ts`:

```ts
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ReweighsService } from './reweighs.service';
import { UserRole } from '../users/user-role.enum';

const owner = { id: 'u-owner', role: UserRole.NetworkOwner, collection_point_id: null } as never;

describe('ReweighsService.addItem', () => {
  const build = (overrides: Record<string, unknown> = {}) => {
    const manager = {
      query: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(async (_e: unknown, row: unknown) => row),
      getRepository: jest.fn(),
    };
    const dataSource = { transaction: jest.fn(async (cb: never) => (cb as never as (m: unknown) => unknown)(manager)) };
    const shifts = { findOneRaw: jest.fn(async () => ({ id: 's-1', closed_at: null })) };
    const tareTypes = { findManyRaw: jest.fn(async () => [{ id: 't-1', weight_kg: '1.20' }]) };
    const audit = { record: jest.fn() };
    const service = new ReweighsService(
      dataSource as never,
      shifts as never,
      tareTypes as never,
      audit as never,
    );
    Object.assign(manager, overrides);
    return { service, manager, shifts, tareTypes, audit };
  };

  it('subtracts the pallet first and the tare second — §8.1', async () => {
    const { service, manager } = build();
    // acceptedGrades() → the grade is accepted; order lookup → no lines yet
    manager.query
      .mockResolvedValueOnce([{ id: 'rw-1' }]) // header upsert + read
      .mockResolvedValueOnce([{ product_grade_id: 'g-1' }]) // accepted grades
      .mockResolvedValueOnce([{ next: 1 }]); // next item_order

    const saved = await service.addItem(owner, 's-1', {
      product_grade_id: 'g-1',
      gross_kg: '701.50',
      pallet_kg: '18.00',
      tare: [{ tare_type_id: 't-1', units: 115 }],
    });

    expect(saved.tare_weight_kg).toBe('138.00');
    expect(saved.net_kg).toBe('545.50');
  });

  it('refuses a grade the shift did not accept — §8.1 «Чужий товар додати не можна»', async () => {
    const { service, manager } = build();
    manager.query
      .mockResolvedValueOnce([{ id: 'rw-1' }])
      .mockResolvedValueOnce([{ product_grade_id: 'g-OTHER' }]);

    await expect(
      service.addItem(owner, 's-1', {
        product_grade_id: 'g-1',
        gross_kg: '10.00',
        tare: [],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses any line on a shift that accepted nothing — §8.1', async () => {
    const { service, manager } = build();
    manager.query.mockResolvedValueOnce([{ id: 'rw-1' }]).mockResolvedValueOnce([]);

    await expect(
      service.addItem(owner, 's-1', { product_grade_id: 'g-1', gross_kg: '10.00', tare: [] }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a line whose tare exceeds its gross', async () => {
    const { service, manager } = build();
    manager.query
      .mockResolvedValueOnce([{ id: 'rw-1' }])
      .mockResolvedValueOnce([{ product_grade_id: 'g-1' }])
      .mockResolvedValueOnce([{ next: 1 }]);

    await expect(
      service.addItem(owner, 's-1', {
        product_grade_id: 'g-1',
        gross_kg: '100.00',
        pallet_kg: '18.00',
        tare: [{ tare_type_id: 't-1', units: 115 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404s an unknown shift', async () => {
    const { service, shifts } = build();
    shifts.findOneRaw.mockResolvedValueOnce(null);
    await expect(
      service.addItem(owner, 's-nope', { product_grade_id: 'g-1', gross_kg: '1.00', tare: [] }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('writes a line against an OPEN shift — spec §3.9, no status gate', async () => {
    const { service, manager, shifts } = build();
    shifts.findOneRaw.mockResolvedValueOnce({ id: 's-1', closed_at: null });
    manager.query
      .mockResolvedValueOnce([{ id: 'rw-1' }])
      .mockResolvedValueOnce([{ product_grade_id: 'g-1' }])
      .mockResolvedValueOnce([{ next: 3 }]);

    const saved = await service.addItem(owner, 's-1', {
      product_grade_id: 'g-1',
      gross_kg: '10.00',
      tare: [],
    });
    expect(saved.item_order).toBe(3);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cd backend && npm test -- src/reweighs/reweighs.service.spec.ts`
Expected: FAIL — `Cannot find module './reweighs.service'`.

- [ ] **Step 4: Write the mapper**

Create `backend/src/reweighs/reweigh-item.mapper.ts`:

```ts
import { ReweighItem } from './reweigh-item.entity';

export interface ReweighItemTareResponse {
  tare_type_id: string;
  tare_type_name?: string;
  units: number;
}

export interface ReweighItemResponse {
  id: string;
  reweigh_id: string;
  item_order: number;
  product_grade_id: string;
  product_grade_name?: string;
  product_id?: string;
  product_name?: string;
  gross_kg: string;
  pallet_kg: string;
  tare_weight_kg: string;
  net_kg: string;
  tare: ReweighItemTareResponse[];
  weighed_by_user_id: string;
  voided_at: string | null;
  voided_by_user_id: string | null;
  void_reason: string | null;
  created_at: string;
}

export function toReweighItemResponse(item: ReweighItem): ReweighItemResponse {
  return {
    id: item.id,
    reweigh_id: item.reweigh_id,
    item_order: item.item_order,
    product_grade_id: item.product_grade_id,
    product_grade_name: item.product_grade?.name,
    product_id: item.product_grade?.product_id,
    product_name: item.product_grade?.product?.name,
    gross_kg: item.gross_kg,
    pallet_kg: item.pallet_kg,
    tare_weight_kg: item.tare_weight_kg,
    net_kg: item.net_kg,
    tare: (item.tare ?? []).map((t) => ({
      tare_type_id: t.tare_type_id,
      tare_type_name: t.tare_type?.name,
      units: t.units,
    })),
    weighed_by_user_id: item.weighed_by_user_id,
    voided_at: item.voided_at ? item.voided_at.toISOString() : null,
    voided_by_user_id: item.voided_by_user_id,
    void_reason: item.void_reason,
    created_at: item.created_at.toISOString(),
  };
}
```

- [ ] **Step 5: Write the service**

Create `backend/src/reweighs/reweighs.service.ts`:

```ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Reweigh } from './reweigh.entity';
import { ReweighItem } from './reweigh-item.entity';
import { ReweighItemTareType } from './reweigh-item-tare-type.entity';
import { CreateReweighItemDto } from './dto/create-reweigh-item.dto';
import { ReweighItemResponse, toReweighItemResponse } from './reweigh-item.mapper';
import { ShiftsService } from '../shifts/shifts.service';
import { TareTypesService } from '../tare-types/tare-types.service';
import { AuditService } from '../audit/audit.service';
import { mul, sub, sum, lte } from '../common/money';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

@Injectable()
export class ReweighsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly shifts: ShiftsService,
    private readonly tareTypes: TareTypesService,
    private readonly audit: AuditService,
  ) {}

  /**
   * §8.1 — one weighing on the scale.
   *
   * NO SHIFT-STATUS GATE (spec §3.9). §8.3's «Один рейс на три пункти» is a
   * mid-day trip by construction: the first point's berries are at the base
   * while that point is still buying. Refusing an open shift here would make
   * that ordinary day unrecordable, and the workaround would be to close the
   * shift early — corrupting it to satisfy the schema. The open-shift caveat
   * lives in the READ instead, where недостача reports `null`.
   *
   * THE HEADER IS CREATED LAZILY, and the upsert is not laziness about
   * concurrency: two first lines arriving together must not both insert, so it
   * is `ON CONFLICT DO NOTHING` followed by a read, inside the transaction.
   */
  async addItem(
    actor: AuthenticatedUser,
    shiftId: string,
    dto: CreateReweighItemDto,
  ): Promise<ReweighItemResponse> {
    const shift = await this.shifts.findOneRaw(shiftId);
    if (!shift) throw new NotFoundException('Shift not found');

    const tareWeight = await this.resolveTareWeight(dto);

    return this.dataSource.transaction(async (m) => {
      const reweigh = await this.ensureHeader(m, shiftId);

      const accepted = await this.acceptedGrades(m, shiftId);
      if (accepted.length === 0) {
        throw new ConflictException({
          message: 'Nothing was accepted at this point that day',
          code: 'NOTHING_ACCEPTED',
        });
      }
      if (!accepted.includes(dto.product_grade_id)) {
        throw new BadRequestException({
          message: 'That grade was not accepted by this shift',
          code: 'GRADE_NOT_ACCEPTED',
        });
      }

      const pallet = dto.pallet_kg ?? '0.00';
      // §8.1 — pallet FIRST, tare second. Never a human's number.
      const net = sub(sub(dto.gross_kg, pallet), tareWeight);
      if (lte(net, '0.00')) {
        throw new BadRequestException({
          message: 'Pallet and tare leave no net weight',
          code: 'NET_NOT_POSITIVE',
        });
      }

      const [{ next }] = (await m.query(
        `SELECT COALESCE(MAX(item_order), 0) + 1 AS next
           FROM reweigh_items WHERE reweigh_id = $1`,
        [reweigh.id],
      )) as [{ next: number }];

      const item = m.create(ReweighItem, {
        reweigh_id: reweigh.id,
        // A ROW COUNT, NOT MONEY. Spelled `Number.parseInt` rather than
        // `Number(...)` because this file is inside the eslint money guard and
        // that selector matches the bare global only — the same sanctioned
        // spelling `crate-balance.service.ts` uses, for the same reason.
        item_order: Number.parseInt(String(next), 10),
        product_grade_id: dto.product_grade_id,
        gross_kg: dto.gross_kg,
        pallet_kg: pallet,
        tare_weight_kg: tareWeight,
        net_kg: net,
        weighed_by_user_id: actor.id,
        voided_at: null,
        voided_by_user_id: null,
        void_reason: null,
        tare: dto.tare.map((t) =>
          m.create(ReweighItemTareType, { tare_type_id: t.tare_type_id, units: t.units }),
        ),
      });

      const saved = await m.save(ReweighItem, item);

      await this.audit.record(
        {
          action: 'reweigh-item.created',
          actor_id: actor.id,
          target_type: 'reweigh_item',
          target_id: saved.id,
          after: { shift_id: shiftId, net_kg: saved.net_kg, grade: saved.product_grade_id },
        },
        m,
      );

      return toReweighItemResponse(saved);
    });
  }

  /**
   * `Σ units × tare_types.weight_kg`, SNAPSHOTTED onto the line.
   *
   * The catalogue weight is editable (see `tare_types`' Note); reading it at
   * report time instead would let a change to «Чешка» rewrite last week's net
   * weight, and the недостача with it.
   */
  private async resolveTareWeight(dto: CreateReweighItemDto): Promise<string> {
    if (dto.tare.length === 0) return '0.00';

    // `findManyRaw`, not a lookup per line: the tare breakdown is up to ten
    // rows and a loop of awaits here is an N+1 on the hottest write in §8.
    const ids = dto.tare.map((t) => t.tare_type_id);
    const types = await this.tareTypes.findManyRaw(ids);
    const byId = new Map(types.map((t) => [t.id, t]));

    const parts = dto.tare.map((line) => {
      const type = byId.get(line.tare_type_id);
      if (!type) throw new NotFoundException('Tare type not found');
      // `units` is a COUNT, so it is widened to a scale-2 string rather than
      // multiplied as a number — foundation §5.1 binds weights too.
      return mul(type.weight_kg, `${line.units}.00`);
    });
    return sum(parts);
  }

  private async ensureHeader(m: EntityManager, shiftId: string): Promise<Reweigh> {
    await m.query(
      `INSERT INTO reweighs (shift_id) VALUES ($1) ON CONFLICT (shift_id) DO NOTHING`,
      [shiftId],
    );
    const rows = (await m.query(`SELECT id FROM reweighs WHERE shift_id = $1`, [shiftId])) as {
      id: string;
    }[];
    return { id: rows[0].id, shift_id: shiftId } as Reweigh;
  }

  /** The grades this shift actually accepted — §8.1's picker, enforced. */
  private async acceptedGrades(m: EntityManager, shiftId: string): Promise<string[]> {
    const rows = (await m.query(
      `SELECT DISTINCT ii.product_grade_id
         FROM intake_items ii
         JOIN intakes i ON i.id = ii.intake_id
        WHERE i.shift_id = $1 AND i.voided_at IS NULL`,
      [shiftId],
    )) as { product_grade_id: string }[];
    return rows.map((r) => r.product_grade_id);
  }
}
```

`item_order` is the only number in this file that is a JavaScript number rather than a decimal string, and the spelling is load-bearing — see the comment on it.

- [ ] **Step 6: Write the controller and module**

Create `backend/src/reweighs/reweighs.controller.ts`:

```ts
import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../users/user-role.enum';
import { ReweighsService } from './reweighs.service';
import { CreateReweighItemDto } from './dto/create-reweigh-item.dto';
import { ReweighItemResponse } from './reweigh-item.mapper';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * §8 IS THE OWNER'S WORLD, READS INCLUDED (spec §3.10): §8.7 «переважує і
 * сторнує тільки керівник». Whether the operator ever sees the недостача
 * claimed against his own point is an open question, not an oversight.
 */
@Controller()
@Auth(UserRole.NetworkOwner)
export class ReweighsController {
  constructor(private readonly reweighs: ReweighsService) {}

  @Post('shifts/:shiftId/reweigh-items')
  addItem(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('shiftId', ParseUUIDPipe) shiftId: string,
    @Body() dto: CreateReweighItemDto,
  ): Promise<ReweighItemResponse> {
    return this.reweighs.addItem(actor, shiftId, dto);
  }
}
```

Create `backend/src/reweighs/reweighs.module.ts` importing `TypeOrmModule.forFeature([Reweigh, ReweighItem, ReweighItemTareType])`, `ShiftsModule`, `TareTypesModule`, `AuditModule`; providing and exporting `ReweighsService`; declaring `ReweighsController`. Register `ReweighsModule` in `backend/src/app.module.ts` next to `CratesModule`.

- [ ] **Step 7: Add the audit actions and the eslint scope**

In `backend/src/audit/audit-log.entity.ts`, append to `AUDIT_ACTIONS`:

```ts
  'reweigh-item.created',
  'reweigh-item.voided',
```

In `backend/eslint.config.mjs`, add `'src/reweighs/**/*.ts'` to the money-rule `files` array, and extend the comment above it with one paragraph: `reweighs` joins because §8.1's net weight is computed in TypeScript — `(gross − pallet) − tare` — and it is the first module in the guard whose arithmetic is on **weights** rather than on money, which is the same rule (foundation §5.1) and the easier one to forget.

- [ ] **Step 8: Run the unit spec and lint**

Run: `cd backend && npm test -- src/reweighs && npm run lint`
Expected: PASS on both.

- [ ] **Step 9: Write the DB spec for the concurrency and picker rules**

Create `backend/src/reweighs/reweighs.db-spec.ts`, modelled on `crates.db-spec.ts`. It must seed a point, a shift, a product/grade, a tare type and one intake, then assert:

```ts
it('creates exactly ONE header for two concurrent first lines', async () => {
  await Promise.all([addLine('100.00'), addLine('200.00')]);
  const rows = await ds.query(`SELECT count(*)::int AS n FROM reweighs WHERE shift_id = $1`, [
    shiftId,
  ]);
  expect(rows[0].n).toBe(1);
});

it('numbers lines 1, 2, 3 and keeps a voided number taken', async () => {
  const a = await addLine('100.00');
  await voidLine(a.id, 'переважили не ту партію');
  const b = await addLine('200.00');
  expect(b.item_order).toBe(2);
});

it('accepts two lines of the same grade', async () => {
  await addLine('100.00');
  await expect(addLine('120.00')).resolves.toBeDefined();
});
```

- [ ] **Step 10: Run it, then commit**

Run: `cd backend && npm run test:db -- src/reweighs/reweighs.db-spec.ts`
Expected: PASS.

```bash
git add backend/src/reweighs backend/src/app.module.ts backend/src/audit backend/eslint.config.mjs
git commit -m "feat(reweigh): write a weighing line against a shift

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Voiding a line — `POST /reweigh-items/:id/void`

**Files:**
- Modify: `backend/src/reweighs/reweighs.service.ts`, `backend/src/reweighs/reweighs.controller.ts`
- Test: `backend/src/reweighs/reweighs.service.spec.ts`

**Interfaces:**
- Consumes: `VoidDocumentDto` from `../intakes/dto/void-document.dto` (already enforces a non-empty trimmed reason).
- Produces: `ReweighsService.voidItem(actor, id, dto): Promise<ReweighItemResponse>`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/src/reweighs/reweighs.service.spec.ts`:

```ts
describe('ReweighsService.voidItem', () => {
  it('stamps the trio and keeps the row — §8.7', async () => {
    const { service, manager, audit } = build();
    manager.findOne = jest.fn(async () => ({
      id: 'i-1',
      reweigh_id: 'rw-1',
      item_order: 1,
      voided_at: null,
      created_at: new Date(),
      net_kg: '545.50',
      gross_kg: '701.50',
      pallet_kg: '18.00',
      tare_weight_kg: '138.00',
      product_grade_id: 'g-1',
      weighed_by_user_id: 'u-owner',
      voided_by_user_id: null,
      void_reason: null,
    }));

    const out = await service.voidItem(owner, 'i-1', { reason: 'переважили не ту партію' });

    expect(out.voided_at).not.toBeNull();
    expect(out.void_reason).toBe('переважили не ту партію');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'reweigh-item.voided' }),
      expect.anything(),
    );
  });

  it('refuses to void twice', async () => {
    const { service, manager } = build();
    manager.findOne = jest.fn(async () => ({ id: 'i-1', voided_at: new Date() }));
    await expect(service.voidItem(owner, 'i-1', { reason: 'ще раз' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('404s an unknown line', async () => {
    const { service, manager } = build();
    manager.findOne = jest.fn(async () => null);
    await expect(service.voidItem(owner, 'nope', { reason: 'x' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
```

- [ ] **Step 2: Run and watch fail**

Run: `cd backend && npm test -- src/reweighs/reweighs.service.spec.ts`
Expected: FAIL — `service.voidItem is not a function`.

- [ ] **Step 3: Implement**

Add to `ReweighsService`:

```ts
  /**
   * §8.7 — the storno of a weighing.
   *
   * NO AUTHOR CHECK AND NO SHIFT-STATUS CHECK, and neither is an omission.
   * §9.4's «свій документ, своя відкрита зміна» governs the OPERATOR's
   * documents; §8.7 gives both weighing and voiding to the owner outright, and
   * the controller's class-level `@Auth(UserRole.NetworkOwner)` is the whole
   * rule. There is nobody left for a row-level check to exclude.
   *
   * THE ROW STAYS. «документ НЕ зникає: лишається з позначкою "сторновано",
   * часом, автором і причиною» — which is the trio, not a DELETE and not a
   * status.
   */
  async voidItem(
    actor: AuthenticatedUser,
    id: string,
    dto: VoidDocumentDto,
  ): Promise<ReweighItemResponse> {
    return this.dataSource.transaction(async (m) => {
      const item = await m.findOne(ReweighItem, {
        where: { id },
        relations: { product_grade: { product: true }, tare: { tare_type: true } },
      });
      if (!item) throw new NotFoundException('Reweigh line not found');
      if (item.voided_at) {
        throw new ConflictException({
          message: 'That line is already voided',
          code: 'ALREADY_VOIDED',
        });
      }

      item.voided_at = new Date();
      item.voided_by_user_id = actor.id;
      item.void_reason = dto.reason;
      const saved = await m.save(ReweighItem, item);

      await this.audit.record(
        {
          action: 'reweigh-item.voided',
          actor_id: actor.id,
          target_type: 'reweigh_item',
          target_id: saved.id,
          note: dto.reason,
        },
        m,
      );

      return toReweighItemResponse(saved);
    });
  }
```

Add the route to `ReweighsController`:

```ts
  @Post('reweigh-items/:id/void')
  voidItem(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidDocumentDto,
  ): Promise<ReweighItemResponse> {
    return this.reweighs.voidItem(actor, id, dto);
  }
```

- [ ] **Step 4: Run tests**

Run: `cd backend && npm test -- src/reweighs && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/reweighs
git commit -m "feat(reweigh): void a weighing line with a mandatory reason (§8.7)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Reconciliation — `GET /shifts/:shiftId/reweigh`

**Files:**
- Create: `backend/src/reweighs/reweigh-reconciliation.service.ts`
- Modify: `backend/src/reweighs/reweighs.controller.ts`, `backend/src/reweighs/reweighs.module.ts`
- Test: `backend/src/reweighs/reweigh-reconciliation.service.spec.ts`, `backend/src/reweighs/reweigh-reconciliation.db-spec.ts`

**Interfaces:**
- Consumes: `div`, `mul`, `sub`, `sum`, `gt` from `common/money`; `ShiftsService.findOneRaw`.
- Produces: `ReweighReconciliationService.forShift(actor, shiftId): Promise<ReconciliationResponse>` with the shape in spec §5.3. Task 9 reuses its private `gradeTotals(m, shiftId)` — export it as a module-level function so cost-of-day imports it rather than reimplementing it.

- [ ] **Step 1: Write the failing spec**

Create `backend/src/reweighs/reweigh-reconciliation.service.spec.ts`:

```ts
import { ReweighReconciliationService } from './reweigh-reconciliation.service';
import { UserRole } from '../users/user-role.enum';

const owner = { id: 'u-owner', role: UserRole.NetworkOwner, collection_point_id: null } as never;

describe('ReweighReconciliationService.forShift', () => {
  const build = (shift: Record<string, unknown>, rows: Record<string, unknown>[]) => {
    const dataSource = { query: jest.fn(async () => rows) };
    const shifts = { findOneRaw: jest.fn(async () => shift) };
    return new ReweighReconciliationService(dataSource as never, shifts as never);
  };

  const raspberry = {
    product_id: 'p-rasp',
    product_name: 'Малина',
    product_grade_id: 'g-rasp-1',
    intake_net_kg: '800.00',
    intake_amount: '128000.00',
    reweigh_net_kg: '790.00',
  };

  it('computes §8.2 exactly: −10 кг → −1 600,00 ₴', async () => {
    const svc = build({ id: 's-1', closed_at: new Date() }, [raspberry]);
    const out = await svc.forShift(owner, 's-1');
    const p = out.products[0];
    expect(p.state).toBe('weighed');
    expect(p.missing_kg).toBe('10.00');
    expect(p.missing_amount).toBe('1600.00');
  });

  it('prices недостача at what was ACTUALLY paid, bonuses included — spec §3.6', async () => {
    // 800 кг accrued 132 000 because of a +5 ₴/кг bonus → 165,00 ₴/кг, not 160,00
    const svc = build({ id: 's-1', closed_at: new Date() }, [
      { ...raspberry, intake_amount: '132000.00' },
    ]);
    const out = await svc.forShift(owner, 's-1');
    expect(out.products[0].missing_amount).toBe('1650.00');
  });

  it('reports «—» while the shift is still open — spec §3.9', async () => {
    const svc = build({ id: 's-1', closed_at: null }, [raspberry]);
    const out = await svc.forShift(owner, 's-1');
    expect(out.products[0].missing_kg).toBeNull();
    expect(out.products[0].missing_amount).toBeNull();
  });

  it('marks a product with NO reweigh line as not_reweighed, never as zero — §8.2, §8.6', async () => {
    const svc = build({ id: 's-1', closed_at: new Date() }, [
      { ...raspberry, reweigh_net_kg: null },
    ]);
    const p = (await svc.forShift(owner, 's-1')).products[0];
    expect(p.state).toBe('not_reweighed');
    expect(p.missing_kg).toBeNull();
  });

  it('marks a PARTIALLY weighed product as not_reweighed — spec §3.15', async () => {
    const svc = build({ id: 's-1', closed_at: new Date() }, [
      raspberry,
      { ...raspberry, product_grade_id: 'g-rasp-2', intake_net_kg: '50.00', intake_amount: '7500.00', reweigh_net_kg: null },
    ]);
    const p = (await svc.forShift(owner, 's-1')).products[0];
    expect(p.state).toBe('not_reweighed');
  });

  it('surfaces a surplus as a signed number rather than hiding it — §8.2 надлишок', async () => {
    const svc = build({ id: 's-1', closed_at: new Date() }, [
      { ...raspberry, reweigh_net_kg: '805.00' },
    ]);
    const p = (await svc.forShift(owner, 's-1')).products[0];
    expect(p.missing_kg).toBe('-5.00');
  });

  it('says so when the point accepted nothing that day — §8.1', async () => {
    const svc = build({ id: 's-1', closed_at: new Date() }, []);
    const out = await svc.forShift(owner, 's-1');
    expect(out.accepted_anything).toBe(false);
    expect(out.products).toEqual([]);
  });
});
```

- [ ] **Step 2: Run and watch fail**

Run: `cd backend && npm test -- src/reweighs/reweigh-reconciliation.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

Create `backend/src/reweighs/reweigh-reconciliation.service.ts`. The single SQL below is the whole data access — one grouped query per shift, per grade, with the reweigh side as a pre-aggregated subquery so a grade with no lines survives the LEFT JOIN as `NULL` rather than as `0`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ShiftsService } from '../shifts/shifts.service';
import { div, mul, sub, sum, isZero } from '../common/money';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

export interface GradeTotalsRow {
  product_id: string;
  product_name: string;
  product_grade_id: string;
  intake_net_kg: string;
  intake_amount: string;
  /** NULL — not '0.00' — when nothing was weighed for this grade. §8.6: «Це не нуль». */
  reweigh_net_kg: string | null;
}

/**
 * ONE ROW PER GRADE THAT THE SHIFT ACCEPTED. Never the catalogue (spec §3.15).
 *
 * `intake_amount` here is the INTAKE SIDE ONLY. Top-ups are added on top of it
 * by the cost-of-day service in PR-B; the reconciliation screen is about
 * weights, and adding a доплата to it would change the недостача shown on a
 * dispute screen for a reason the operator cannot see.
 */
export async function gradeTotals(
  runner: DataSource | EntityManager,
  shiftId: string,
): Promise<GradeTotalsRow[]> {
  return runner.query(
    `SELECT p.id           AS product_id,
            p.name         AS product_name,
            pg.id          AS product_grade_id,
            SUM(ii.net_kg)::text  AS intake_net_kg,
            SUM(ii.amount)::text  AS intake_amount,
            rw.net_kg::text       AS reweigh_net_kg
       FROM intake_items ii
       JOIN intakes i        ON i.id = ii.intake_id AND i.voided_at IS NULL
       JOIN product_grades pg ON pg.id = ii.product_grade_id
       JOIN products p        ON p.id = pg.product_id
       LEFT JOIN (
            SELECT ri.product_grade_id, SUM(ri.net_kg) AS net_kg
              FROM reweigh_items ri
              JOIN reweighs r ON r.id = ri.reweigh_id
             WHERE r.shift_id = $1 AND ri.voided_at IS NULL
             GROUP BY ri.product_grade_id
       ) rw ON rw.product_grade_id = pg.id
      WHERE i.shift_id = $1
      GROUP BY p.id, p.name, pg.id, rw.net_kg
      ORDER BY p.name, pg.id`,
    [shiftId],
  ) as Promise<GradeTotalsRow[]>;
}

export interface ReconciliationProduct {
  product_id: string;
  product_name: string;
  intake_net_kg: string;
  reweigh_net_kg: string;
  state: 'weighed' | 'not_reweighed';
  missing_kg: string | null;
  missing_amount: string | null;
}

export interface ReconciliationResponse {
  shift_id: string;
  closed_at: string | null;
  accepted_anything: boolean;
  products: ReconciliationProduct[];
}

@Injectable()
export class ReweighReconciliationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly shifts: ShiftsService,
  ) {}

  async forShift(
    _actor: AuthenticatedUser,
    shiftId: string,
  ): Promise<ReconciliationResponse> {
    const shift = await this.shifts.findOneRaw(shiftId);
    if (!shift) throw new NotFoundException('Shift not found');

    const rows = await gradeTotals(this.dataSource, shiftId);
    const open = shift.closed_at === null;

    const byProduct = new Map<string, GradeTotalsRow[]>();
    for (const row of rows) {
      const list = byProduct.get(row.product_id) ?? [];
      list.push(row);
      byProduct.set(row.product_id, list);
    }

    const products: ReconciliationProduct[] = [];
    for (const [productId, grades] of byProduct) {
      const intakeNet = sum(grades.map((g) => g.intake_net_kg));
      const reweighNet = sum(grades.map((g) => g.reweigh_net_kg ?? '0.00'));

      // §3.15 — one unweighed grade makes the whole product «не перезважено»,
      // because the shortfall on that grade would otherwise read as real.
      const complete = grades.every((g) => g.reweigh_net_kg !== null);

      if (!complete || open) {
        products.push({
          product_id: productId,
          product_name: grades[0].product_name,
          intake_net_kg: intakeNet,
          reweigh_net_kg: reweighNet,
          state: complete ? 'weighed' : 'not_reweighed',
          missing_kg: null,
          missing_amount: null,
        });
        continue;
      }

      // §3.6 — per GRADE, at the weighted average actually accrued, then summed.
      const amounts = grades.map((g) => {
        const missing = sub(g.intake_net_kg, g.reweigh_net_kg as string);
        if (isZero(g.intake_net_kg)) return '0.00';
        return mul(missing, div(g.intake_amount, g.intake_net_kg));
      });

      products.push({
        product_id: productId,
        product_name: grades[0].product_name,
        intake_net_kg: intakeNet,
        reweigh_net_kg: reweighNet,
        state: 'weighed',
        missing_kg: sub(intakeNet, reweighNet),
        missing_amount: sum(amounts),
      });
    }

    return {
      shift_id: shiftId,
      closed_at: shift.closed_at ? shift.closed_at.toISOString() : null,
      accepted_anything: rows.length > 0,
      products,
    };
  }
}
```

- [ ] **Step 4: Wire the route**

Add to `ReweighsController`:

```ts
  @Get('shifts/:shiftId/reweigh')
  reconciliation(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('shiftId', ParseUUIDPipe) shiftId: string,
  ): Promise<ReconciliationResponse> {
    return this.reconciliation_.forShift(actor, shiftId);
  }
```

injecting `ReweighReconciliationService` as `reconciliation_`, and register it as a provider in `ReweighsModule`.

- [ ] **Step 5: Run the unit spec**

Run: `cd backend && npm test -- src/reweighs`
Expected: PASS, all seven reconciliation cases.

- [ ] **Step 6: Prove the SQL against a real Postgres**

Create `backend/src/reweighs/reweigh-reconciliation.db-spec.ts`, seeding two grades of one product where only one is weighed, and assert `state === 'not_reweighed'` and `missing_kg === null`. This is the case a mocked spec cannot reach: it is the `LEFT JOIN` returning `NULL` rather than `0` that makes it work.

Run: `cd backend && npm run test:db -- src/reweighs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/reweighs
git commit -m "feat(reweigh): §8.2 reconciliation with недостача per grade

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Open PR-A

- [ ] **Step 1: Run everything**

Run: `cd backend && npm run lint && npm test && npm run test:db`
Expected: all green. Do not proceed on a red suite; a failure here is the plan being wrong, not the suite.

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin feat/yagoda-reweigh-slice
gh pr create --title "feat: §8.1–8.2 reweigh slice — the base's second weighing" --body "$(cat <<'BODY'
Implements §8.1 (Друга вага) and §8.2 (Недостача) from `26-rules-by-example.md`.
Spec: `docs/superpowers/specs/2026-09-17-yagoda-reweigh-slice.md`.

Four decisions worth a reviewer's attention, all argued in the spec:
- The reweigh belongs to a shift by FK and is NOT part of closing it (§3.1).
- No posting moment; собівартість is live (§3.3).
- Void is on the line, not the header; lines are immutable (§3.4).
- Недостача is computed at the weighted average actually accrued, never stored (§3.6).

PR-B (§8.3 витрати, §8.4 собівартість, §8.6 середня по мережі) stacks on this.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

---

# PR-B — expenses, cost of day, network average (§8.3, §8.4, §8.6)

Branch: `git checkout -b feat/yagoda-cost-of-day` from PR-A's head. Open as **draft** until PR-A merges.

### Task 7: `day_expenses` — schema and CRUD

**Files:**
- Modify: `28-db-schema.dbml`, `backend/src/data-source.ts`, `backend/src/audit/audit-log.entity.ts`, `backend/eslint.config.mjs`
- Create: `backend/src/migrations/1788600000014-YagodaDayExpenses.ts`
- Create: `backend/src/day-costs/day-expense.entity.ts`
- Create: `backend/src/day-costs/dto/create-day-expense.dto.ts`, `.../update-day-expense.dto.ts`
- Create: `backend/src/day-costs/day-expenses.service.ts`, `.../day-expenses.controller.ts`, `.../day-costs.module.ts`
- Test: `backend/src/day-costs/day-expenses.service.spec.ts`, `backend/src/migrations/day-expenses-schema.db-spec.ts`

**Interfaces:**
- Produces: `DayExpensesService.create/update/remove/listForShift`, and `DayExpense { id, shift_id, label, amount, created_by_user_id, created_at, updated_at }`.

- [ ] **Step 1: Write the failing service spec**

```ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DayExpensesService } from './day-expenses.service';
import { UserRole } from '../users/user-role.enum';

const owner = { id: 'u-owner', role: UserRole.NetworkOwner, collection_point_id: null } as never;

describe('DayExpensesService', () => {
  const build = () => {
    const repo = {
      save: jest.fn(async (row: unknown) => ({ id: 'e-1', created_at: new Date(), updated_at: new Date(), ...(row as object) })),
      findOne: jest.fn(async () => ({ id: 'e-1', shift_id: 's-1', label: 'пальне', amount: '1000.00' })),
      delete: jest.fn(async () => ({ affected: 1 })),
      find: jest.fn(async () => []),
    };
    const shifts = { findOneRaw: jest.fn(async () => ({ id: 's-1' })) };
    const audit = { record: jest.fn() };
    return {
      service: new DayExpensesService(repo as never, shifts as never, audit as never),
      repo,
      audit,
    };
  };

  it('records a free-text line against the shift — §8.3', async () => {
    const { service, audit } = build();
    const out = await service.create(owner, 's-1', { label: 'пальне', amount: '1000.00' });
    expect(out.label).toBe('пальне');
    expect(out.amount).toBe('1000.00');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'day-expense.created' }),
      undefined,
    );
  });

  it('trims the label and refuses an empty one', async () => {
    const { service } = build();
    await expect(
      service.create(owner, 's-1', { label: '   ', amount: '10.00' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('EDITS a row in place — spec §3.8, the one table in this slice that is mutable', async () => {
    const { service, audit } = build();
    const out = await service.update(owner, 'e-1', { amount: '1200.00' });
    expect(out.amount).toBe('1200.00');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'day-expense.updated' }),
      undefined,
    );
  });

  it('deletes a row outright — no void trio here', async () => {
    const { service, audit } = build();
    await service.remove(owner, 'e-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'day-expense.deleted' }),
      undefined,
    );
  });

  it('404s an unknown expense', async () => {
    const { service, repo } = build();
    repo.findOne = jest.fn(async () => null);
    await expect(service.update(owner, 'nope', { amount: '1.00' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
```

- [ ] **Step 2: Run and watch fail**

Run: `cd backend && npm test -- src/day-costs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the migration**

Create `backend/src/migrations/1788600000014-YagodaDayExpenses.ts`:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * §8.3 «Витрати дня» — spec §3.8.
 *
 * THIS TABLE IS MUTABLE, AND THAT IS THE ONLY EXCEPTION IN THE SCHEMA. There is
 * no `void_*` trio here, deliberately. §2.7's freeze protects «те, що
 * надруковано на папері» — a document in a supplier's hand that must not drift
 * from the database. Nothing is printed for «пальне 1 000,00», nobody is owed
 * it, and §8.3's «+ ще рядок» is explicitly a scratchpad gesture whose total
 * «перераховується сам після кожного рядка». Forcing a void-with-reason to fix
 * a typo in «вантажник» would be ceremony with no reader.
 *
 * THE COST IS NAMED: a past day's собівартість can change with no journal
 * trace. The audit log is what answers «чому вчорашні 6,39 стали 6,51» —
 * `day-expense.updated` carries before/after. Whoever decides that is not
 * enough should add the void trio, not an audit table: there is already one.
 *
 * `shift_id`, NOT `collection_point_id` + `business_date`. §8.3 — «Витрата
 * належить ОДНОМУ пункту; витрат рівня "вся мережа" не існує», and the shift is
 * how every other document in this schema learns its point and its date. A
 * trip serving three points is split by the owner himself: «ви ділите пальне в
 * себе і записуєте, куди треба».
 *
 * NO CLOSED LIST OF CATEGORIES. §8.3 — «закритого списку статей немає, підпис
 * рядка пише керівник». `label` is free text on purpose; an enum here would be
 * the restriction the client explicitly does not have.
 */
export class YagodaDayExpenses1788600000014 implements MigrationInterface {
  name = 'YagodaDayExpenses1788600000014';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "day_expenses" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "shift_id" uuid NOT NULL,
        "label" character varying NOT NULL,
        "amount" numeric(12,2) NOT NULL,
        "created_by_user_id" uuid NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_day_expenses" PRIMARY KEY ("id"),
        CONSTRAINT "FK_day_expenses_shift" FOREIGN KEY ("shift_id")
          REFERENCES "shifts"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_day_expenses_created_by" FOREIGN KEY ("created_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        -- A zero expense is a row with no reader; a negative one is income, and
        -- §8.3 has no such thing.
        CONSTRAINT "CHK_day_expenses_amount" CHECK ("amount" > 0),
        CONSTRAINT "CHK_day_expenses_label" CHECK (btrim("label") <> '')
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_day_expenses_shift" ON "day_expenses" ("shift_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "day_expenses"`);
  }
}
```

- [ ] **Step 4: Write the entity, DTOs, service, controller and module**

`DayExpense` mirrors the migration exactly (`amount` and every numeric as `string`). DTOs:

```ts
// create-day-expense.dto.ts
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateDayExpenseDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'label must not be empty' })
  @MaxLength(120)
  label: string;

  @Matches(/^\d+(\.\d{1,2})?$/, { message: 'amount must be a decimal with at most 2 places' })
  amount: string;
}
```

`UpdateDayExpenseDto` is `PartialType(CreateDayExpenseDto)` from `@nestjs/mapped-types`.

The service takes `@InjectRepository(DayExpense)`, `ShiftsService` and `AuditService`; `create` checks the shift exists (404) and rejects a blank trimmed label (400 `LABEL_EMPTY`); `update` and `remove` load by id (404) and audit `before`/`after` via `common/diff-fields.ts`. Routes on a `@Controller() @Auth(UserRole.NetworkOwner)` class:

```
POST   shifts/:shiftId/expenses
GET    shifts/:shiftId/expenses
PATCH  expenses/:id
DELETE expenses/:id
```

- [ ] **Step 5: Register everything**

Entity + migration into `data-source.ts`; `DayCostsModule` into `app.module.ts`; the three actions
`'day-expense.created' | 'day-expense.updated' | 'day-expense.deleted'` into `AUDIT_ACTIONS`;
`'src/day-costs/**/*.ts'` into the eslint money `files` array.

- [ ] **Step 6: Write the schema db-spec**

`backend/src/migrations/day-expenses-schema.db-spec.ts`: assert `CHK_day_expenses_amount` rejects `0` and `-1`, that `label` rejects `'   '`, and that **no** `voided_at` column exists (spec §3.8 — its absence is the decision).

- [ ] **Step 7: Run and commit**

Run: `cd backend && npm test -- src/day-costs && npm run test:db && npm run lint`

```bash
git add backend/src/day-costs backend/src/migrations backend/src/data-source.ts backend/src/audit backend/eslint.config.mjs 28-db-schema.dbml
git commit -m "feat(day-costs): §8.3 day expenses, owner-only and mutable

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Top-up allocation across a receipt's grades

**Files:**
- Create: `backend/src/day-costs/top-up-allocation.ts`
- Test: `backend/src/day-costs/top-up-allocation.spec.ts`

**Interfaces:**
- Consumes: `allocate`, `sum` from `common/money`.
- Produces: `allocateTopUps(receipts: ReceiptForAllocation[]): Map<string, string>` — grade id → total top-up hryvnia attributed to that grade. Task 9 consumes it.

```ts
export interface ReceiptLineForAllocation {
  product_grade_id: string;
  amount: string;
}
export interface ReceiptForAllocation {
  intake_id: string;
  lines: ReceiptLineForAllocation[];
  top_up_total: string;
}
```

- [ ] **Step 1: Write the failing spec**

```ts
import { allocateTopUps } from './top-up-allocation';
import { sum } from '../common/money';

describe('allocateTopUps', () => {
  it('gives a single-line receipt the whole top-up', () => {
    const out = allocateTopUps([
      { intake_id: 'i-1', top_up_total: '2000.00', lines: [{ product_grade_id: 'g-1', amount: '128000.00' }] },
    ]);
    expect(out.get('g-1')).toBe('2000.00');
  });

  it('splits pro-rata by line amount, not by weight — spec §3.13', () => {
    const out = allocateTopUps([
      {
        intake_id: 'i-1',
        top_up_total: '2000.00',
        lines: [
          { product_grade_id: 'g-1', amount: '128000.00' },
          { product_grade_id: 'g-2', amount: '32000.00' },
        ],
      },
    ]);
    expect(out.get('g-1')).toBe('1600.00');
    expect(out.get('g-2')).toBe('400.00');
  });

  it('loses no kopiyka on an indivisible split — §8.4 звірка', () => {
    const out = allocateTopUps([
      {
        intake_id: 'i-1',
        top_up_total: '100.00',
        lines: [
          { product_grade_id: 'g-1', amount: '1.00' },
          { product_grade_id: 'g-2', amount: '1.00' },
          { product_grade_id: 'g-3', amount: '1.00' },
        ],
      },
    ]);
    expect(sum([...out.values()])).toBe('100.00');
  });

  it('accumulates across receipts that share a grade', () => {
    const out = allocateTopUps([
      { intake_id: 'i-1', top_up_total: '10.00', lines: [{ product_grade_id: 'g-1', amount: '5.00' }] },
      { intake_id: 'i-2', top_up_total: '15.00', lines: [{ product_grade_id: 'g-1', amount: '5.00' }] },
    ]);
    expect(out.get('g-1')).toBe('25.00');
  });

  it('adds two lines of the SAME grade on one receipt into one bucket', () => {
    const out = allocateTopUps([
      {
        intake_id: 'i-1',
        top_up_total: '100.00',
        lines: [
          { product_grade_id: 'g-1', amount: '50.00' },
          { product_grade_id: 'g-1', amount: '50.00' },
        ],
      },
    ]);
    expect(out.get('g-1')).toBe('100.00');
  });

  it('ignores a receipt with no top-up', () => {
    const out = allocateTopUps([
      { intake_id: 'i-1', top_up_total: '0.00', lines: [{ product_grade_id: 'g-1', amount: '5.00' }] },
    ]);
    expect(out.get('g-1') ?? '0.00').toBe('0.00');
  });
});
```

- [ ] **Step 2: Run and watch fail**

Run: `cd backend && npm test -- src/day-costs/top-up-allocation.spec.ts`

- [ ] **Step 3: Implement**

```ts
import { allocate, add, isZero } from '../common/money';

export interface ReceiptLineForAllocation {
  product_grade_id: string;
  amount: string;
}

export interface ReceiptForAllocation {
  intake_id: string;
  /** Non-voided lines of one non-voided receipt, in any order. */
  lines: ReceiptLineForAllocation[];
  /** Σ of that receipt's non-voided доплати. '0.00' when there are none. */
  top_up_total: string;
}

/**
 * Spread each receipt's доплати across that receipt's own lines, PRO-RATA BY
 * LINE AMOUNT (spec §3.13).
 *
 * By amount rather than by `net_kg` because the trigger is «ціну перерахували
 * ПІСЛЯ того, як людина здала» — a price revision scales with money. Splitting
 * by weight would charge a cheap heavy berry the same доплата per kilogram as
 * an expensive light one. On a single-line receipt — the common case — every
 * split agrees, which is why this is cheap to get wrong and cheap to fix.
 *
 * `allocate` rather than a ratio multiplied per line: §8.4's звірка is «жодна
 * гривня не загубилася», and a per-line rounding drifts by a kopiyka each.
 *
 * VOIDED RECEIPTS AND VOIDED TOP-UPS NEVER REACH HERE — the caller's SQL
 * filters both, matching the debt formula's `ti.voided_at IS NULL` on the
 * parent: «ягоди не брали, значить і доплати за ті ягоди немає».
 */
export function allocateTopUps(receipts: ReceiptForAllocation[]): Map<string, string> {
  const byGrade = new Map<string, string>();
  for (const receipt of receipts) {
    if (isZero(receipt.top_up_total) || receipt.lines.length === 0) continue;
    const parts = allocate(
      receipt.top_up_total,
      receipt.lines.map((l) => l.amount),
    );
    receipt.lines.forEach((line, i) => {
      byGrade.set(line.product_grade_id, add(byGrade.get(line.product_grade_id) ?? '0.00', parts[i]));
    });
  }
  return byGrade;
}
```

- [ ] **Step 4: Run, then commit**

Run: `cd backend && npm test -- src/day-costs`

```bash
git add backend/src/day-costs
git commit -m "feat(day-costs): split a top-up across its receipt's grades

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Cost of day — `GET /shifts/:shiftId/cost-of-day`

**Files:**
- Create: `backend/src/day-costs/cost-of-day.service.ts`
- Modify: `backend/src/day-costs/day-expenses.controller.ts` (or a new `cost-of-day.controller.ts`), `day-costs.module.ts`
- Test: `backend/src/day-costs/cost-of-day.service.spec.ts`, `backend/src/day-costs/cost-of-day.db-spec.ts`

**Interfaces:**
- Consumes: `gradeTotals` from `../reweighs/reweigh-reconciliation.service`, `allocateTopUps`, and `div`/`mul`/`add`/`sub`/`sum`/`gt` from `common/money`.
- Produces: `CostOfDayService.forShift(actor, shiftId): Promise<CostOfDayResponse>`.

- [ ] **Step 1: Write the failing spec against the client's own numbers**

The fixtures are §8.4's own day. Define them once at the top of the spec so
every case below is concrete:

```ts
import { CostOfDayService } from './cost-of-day.service';
import { add, sub, gte } from '../common/money';
import { UserRole } from '../users/user-role.enum';

const owner = { id: 'u-owner', role: UserRole.NetworkOwner, collection_point_id: null } as never;

/** §8.4: нараховано 131 900,00 over 854 переважених кг, 10 кг short on raspberry. */
const DAY = [
  {
    product_id: 'p-rasp', product_name: 'Малина', product_grade_id: 'g-rasp',
    intake_net_kg: '800.00', intake_amount: '128000.00', reweigh_net_kg: '790.00',
  },
  {
    product_id: 'p-black', product_name: 'Ожина', product_grade_id: 'g-black',
    intake_net_kg: '64.80', intake_amount: '3900.00', reweigh_net_kg: '64.00',
  },
];

/**
 * `grades` are `gradeTotals` rows, `expenses` the day's `day_expenses` total,
 * `receipts` the `ReceiptForAllocation[]` the top-up query returns. Every case
 * builds its own; nothing is shared mutable state.
 */
const build = (
  grades = DAY,
  expenses = '3800.00',
  receipts: unknown[] = [],
  latestTopUpAt: Date | null = null,
) => {
  const dataSource = {
    query: jest
      .fn()
      .mockResolvedValueOnce(grades)
      .mockResolvedValueOnce([{ total: expenses }])
      .mockResolvedValueOnce(receipts)
      .mockResolvedValueOnce([{ latest: latestTopUpAt }]),
  };
  const shifts = { findOneRaw: jest.fn(async () => ({ id: 's-1', closed_at: new Date() })) };
  return new CostOfDayService(dataSource as never, shifts as never);
};

const svc = build();
const svcWithNoReweigh = build(DAY.map((g) => ({ ...g, reweigh_net_kg: null })));
const svcWithTopUp = build(DAY, '3800.00', [
  { intake_id: 'i-1', top_up_total: '2000.00', lines: [{ product_grade_id: 'g-rasp', amount: '128000.00' }] },
], new Date('2026-09-10T09:00:00Z'));
const svcWithSurplus = build([{ ...DAY[0], reweigh_net_kg: '805.00' }, DAY[1]]);
```

The ожина fixture is chosen so the two products reproduce §8.4's published
totals: `128 000 + 3 900 = 131 900` accrued, `790 + 64 = 854` weighed, and
`1 600 + 60 = 1 660` of недостача (raspberry `10 кг × 160,00`, ожина
`0,80 кг × 60,19`). If your arithmetic lands a kopiyka off, adjust the ожина
`intake_net_kg` until `shortfall_amount` is exactly `1660.00` — that is the
number §8.4 prints, and matching it is the point of this spec.

```ts
describe('CostOfDayService.forShift', () => {
  // §8.4's worked day, reduced to the two products it implies:
  //   нараховано 131 900,00 · переважено 854 кг · недостача 1 660,00 · витрати 3 800,00
  //   КОШИК 5 460,00 → 6,39 ₴/кг · малина 160,00 → 166,39
  it('reproduces §8.4 line for line', async () => {
    const out = await svc.forShift(owner, 's-1');
    expect(out.accrued).toBe('131900.00');
    expect(out.reweighed_kg).toBe('854.00');
    expect(out.shortfall_amount).toBe('1660.00');
    expect(out.expenses_amount).toBe('3800.00');
    expect(out.basket).toBe('5460.00');
    expect(out.per_kg).toBe('6.39');
    const raspberry = out.products.find((p) => p.product_name === 'Малина')!;
    expect(raspberry.price_was).toBe('160.00');
    expect(raspberry.price_cost).toBe('166.39');
  });

  it('keeps the звірка honest: нараховано + витрати = разом', async () => {
    const out = await svc.forShift(owner, 's-1');
    expect(add(out.accrued, out.expenses_amount)).toBe(out.total_check);
  });

  it('prices the third column as нараховане ÷ НАША вага — §8.4', async () => {
    const raspberry = (await svc.forShift(owner, 's-1')).products.find(
      (p) => p.product_name === 'Малина',
    )!;
    expect(raspberry.price_by_our_weight).toBe('162.03'); // 128 000 ÷ 790
  });

  it('spreads the basket EQUALLY per kilogram across every product — §8.5 ①', async () => {
    const out = await svc.forShift(owner, 's-1');
    for (const p of out.products) {
      expect(sub(p.price_cost, p.price_was)).toBe(out.per_kg);
    }
  });

  it('returns null per_kg — never 0,00 — when nothing was weighed (§8.6 «Це не нуль»)', async () => {
    const out = await svcWithNoReweigh.forShift(owner, 's-1');
    expect(out.per_kg).toBeNull();
    expect(out.products.every((p) => p.price_cost === null)).toBe(true);
  });

  it('includes top-ups in нараховано and in the value of недостача — spec §3.12/§3.13', async () => {
    const out = await svcWithTopUp.forShift(owner, 's-1'); // +2 000,00 on the raspberry receipt
    expect(out.accrued).toBe('133900.00');
    expect(out.top_ups_included).toBe(true);
    expect(out.top_ups_latest_at).not.toBeNull();
  });

  it('clamps a SURPLUS out of the basket so it can never lower the day cost — §8.2', async () => {
    const out = await svcWithSurplus.forShift(owner, 's-1');
    expect(gte(out.shortfall_amount, '0.00')).toBe(true);
  });
});
```

- [ ] **Step 2: Run and watch fail**

- [ ] **Step 3: Implement, following spec §5.5 exactly**

The service:
1. loads `gradeTotals(this.dataSource, shiftId)` (PR-A's query — do **not** reimplement it);
2. loads each non-voided receipt's lines and its non-voided top-up total for that shift, and runs `allocateTopUps`;
3. per grade: `accrued = intake_amount + topUp(grade)`, `price = div(accrued, intake_net_kg)`, `missing = sub(intake_net, reweigh_net)`, `shortfall = gt(missing,'0') ? mul(missing, price) : '0.00'` — **the clamp is here, and it is the only place a surplus is discarded**;
4. `basket = add(sum(shortfalls), expenses)`; `per_kg = isZero(reweighed) ? null : div(basket, reweighed)`;
5. per product: `price_was = div(accruedProduct, intakeNetProduct)`, `price_cost = per_kg === null ? null : add(price_was, per_kg)`, `price_by_our_weight = isZero(reweighNetProduct) ? null : div(accruedProduct, reweighNetProduct)`;
6. `total_check = add(accrued, expenses)`.

Every step through `money.ts`. The response also carries `top_ups_included: true` and `top_ups_latest_at` (max `created_at` among the counted top-ups) for §3.12's on-screen marker.

- [ ] **Step 4: Run the unit spec, then prove it end-to-end**

Create `backend/src/day-costs/cost-of-day.db-spec.ts` that seeds §8.4's day for real — two products, one point, a 10 kg shortfall on raspberry, 3 800,00 of expenses — and asserts the same six numbers. This is the acceptance test for the whole slice.

Run: `cd backend && npm test -- src/day-costs && npm run test:db -- src/day-costs`

- [ ] **Step 5: Commit**

```bash
git add backend/src/day-costs
git commit -m "feat(day-costs): §8.4 cost of day, by-weight allocation, top-ups included

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Network average — `GET /reports/network-average?date=`

**Files:**
- Create: `backend/src/day-costs/network-average.service.ts`, `.../network-average.controller.ts`, `.../dto/network-average.query.ts`
- Test: `backend/src/day-costs/network-average.service.spec.ts`

**Interfaces:**
- Consumes: `CostOfDayService` per shift, `div`, `sum`.
- Produces: `NetworkAverageService.forDate(actor, date)`.

- [ ] **Step 1: Write the failing spec — the client's own table is the test**

```ts
it('sums then divides; NEVER averages the averages — §8.6', async () => {
  // Шипинки 790 кг / 126 400,00 · Гайове 210 кг / 32 550,00
  const out = await svc.forDate(owner, '2026-08-04');
  const raspberry = out.products.find((p) => p.product_name === 'Малина')!;
  expect(raspberry.total_kg).toBe('1000.00');
  expect(raspberry.total_amount).toBe('158950.00');
  expect(raspberry.average_price).toBe('158.95');
  expect(raspberry.average_price).not.toBe('157.50'); // (160 + 155) ÷ 2 — the wrong answer
});

it('excludes a point that accepted the product but has NOT weighed it — §8.6', async () => {
  const out = await svcWithUnweighedPoint.forDate(owner, '2026-08-04');
  const raspberry = out.products.find((p) => p.product_name === 'Малина')!;
  expect(raspberry.total_kg).toBe('1000.00'); // unchanged — the cell is empty, not zero
  expect(raspberry.points.find((p) => p.point_name === 'Не зважений')!.weight_kg).toBeNull();
});

it('excludes a point that did not accept the product at all', async () => {
  // Шипинки and Гайове sell raspberry; Лісове sold only ожина that day. Лісове
  // must not appear in raspberry's `points` at all — not as a null row, and
  // certainly not as a zero that would drag the average down.
  const out = await svcThreePoints.forDate(owner, '2026-08-04');
  const raspberry = out.products.find((p) => p.product_name === 'Малина')!;
  expect(raspberry.points.map((p) => p.point_name)).not.toContain('Лісове');
  expect(raspberry.total_kg).toBe('1000.00');
});
```

- [ ] **Step 2: Run, watch fail, implement**

Per spec §5.6: `сума(point, product) = нараховано(product) − недостача(product)` — the value of the berries that actually arrived, which is why the client's 126 400 is `128 000 − 1 600` — and `вага = Σ reweigh net_kg`. A point contributes only when it has **both** intake and reweigh for that product; otherwise its cell is `null` and it enters neither sum.

- [ ] **Step 3: Run, commit**

```bash
git add backend/src/day-costs
git commit -m "feat(day-costs): §8.6 network average — sum ÷ weight, never mean of means

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Documentation the next reader needs

**Files:**
- Modify: `28-db-schema.dbml` (the `intake_top_ups` Note), `CLAUDE.md`, `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md`

- [ ] **Step 1: Amend the `intake_top_ups` Note — the two clocks**

Append, in the file's own voice:

> **ДВА ГОДИННИКИ (слайс переважування, 17.09.2026, інструкція замовника).** Правило «ДЕНЬ
> ДОПЛАТИ — ДЕНЬ ЇЇ СТВОРЕННЯ» вище лишається чинним і стосується **приросту боргу за точку**.
> Собівартість дня (§8.4) рахує ІНШЕ питання — скільки коштували ЦІ кілограми, — і датує доплату
> **днем квитанції**, через `intake_id → shifts.business_date`. Це той самий принцип, що §8.1
> уже проголошує для самого переважування: партія за 4 серпня, переважена 5-го, рахується за
> 4-те. Наслідок названий і прийнятий: доплата, внесена сьогодні, змінює собівартість уже
> закритого дня, і журнального запису про це немає — екран несе позначку «включно з доплатами»,
> а не знімок. Хто «полагодить» одну половину під іншу, зламає другу.

- [ ] **Step 2: Update `CLAUDE.md`**

In the **Domain** bullet: the table count becomes twenty-two, with `reweighs`, `reweigh_items`, `reweigh_item_tare_types` and `day_expenses` named as the reweigh slice of 2026-09-17, citing the spec and this plan. In the **Money** bullet: the eslint rule now covers eleven modules, and `money.ts` has `div` and `allocate`. Add one line to **Documents**: a reweigh line is immutable and voided individually, its header is not voidable, and `day_expenses` is the schema's single mutable money table, with the reason.

- [ ] **Step 3: File the follow-ups**

Append to `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md`, each with its reason:
1. §8.5 ② «по сумі закупки» and ③ «усе на один товар». ③ needs `expense_allocation` + `allocation_product_id` on the `reweighs` header — a parameter alone cannot say *which* berry. Blocked on «→ Правка: узнать як вони це роблять».
2. Per-grade attribution of a доплата (`intake_top_ups.product_grade_id`) — the correct answer when only one grade's price was revised.
3. Operator read access to the недостача claimed against his own point (§3.10).
4. A visible history for a собівартість that moved because a late top-up or late line landed (§3.12).

- [ ] **Step 4: Commit and open PR-B**

```bash
git add 28-db-schema.dbml CLAUDE.md docs/
git commit -m "docs: record the two clocks, the §8 tables and four follow-ups

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push -u origin feat/yagoda-cost-of-day
gh pr create --draft --base feat/yagoda-reweigh-slice --title "feat: §8.3–8.6 day expenses, cost of day, network average" --body "$(cat <<'BODY'
Stacks on #PR-A. Spec: `docs/superpowers/specs/2026-09-17-yagoda-reweigh-slice.md`.

Three decisions worth a reviewer's attention:
- `day_expenses` is MUTABLE — the only such money table in the schema (§3.8).
- Top-ups are included in собівартість and dated to the RECEIPT's day, diverging
  deliberately from the `intake_top_ups` Note. Two clocks, both documented (§3.12).
- `by_weight` is hardcoded; no stored strategy and no parameter (§3.7).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

---

### Task 12: The three screens — working tree only, NOT committed

**Files (uncommitted, per this project's convention):**
- `frontend/src/pages/reweigh/` — §8.2 переважування: the line form (grade picker restricted to the day's products, tare breakdown, live `net`), the lines list with void, and the reconciliation table with «не перезважено» and «—».
- `frontend/src/pages/cost-of-day/` — §8.4: read-only ЯГОДА half on the left, the expenses editor on the right (the only input on the screen), the three prices per berry, and the звірка line.
- `frontend/src/pages/network-average/` — §8.6: the per-point table with genuinely empty cells.

- [ ] **Step 1** Build them against the live API, following `feature-sliced-design` for placement and `shadcn` for the components.
- [ ] **Step 2** Verify by hand against §8.4's worked numbers using `npm run db:seed` data.
- [ ] **Step 3** **Do not `git add` this directory.** Slice frontends live in the working tree in this project; never `git checkout --` them either.

---

## Verification before either PR leaves draft

```bash
cd backend && npm run lint && npm test && npm run test:db
cd .. && npm run build
```

Evidence before assertions: paste the actual run output into the PR. A claim that §8.4 reproduces is only true when `cost-of-day.db-spec.ts` prints `6.39` and `166.39` on a real Postgres.

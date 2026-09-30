# Stored Payout Allocations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store which payout paid for which receipt or top-up as frozen rows in `payout_allocations`, written by one allocator in the transaction of every debt event, and serve `GET /suppliers/:id/settlement` from those rows with an unchanged contract.

**Architecture:**
- `AllocationsService` lives in `supplier-balance` and has three methods: `lockSupplier`, `release` and `allocate`.
- `allocate` feeds the existing pure `settle()` the residuals (open per line, free per payout) and appends one row per cover.
- Every write path takes the supplier row lock first, then locks documents, then calls `release` on a void, and ends with one `allocate`.
- The read path swaps `settle()` for a pure `fromAllocations()` over live rows.
- A migration creates the table and backfills it with a frozen, BigInt-kopeck copy of `settle()`.

**Tech Stack:** NestJS, TypeORM (raw SQL via `EntityManager.query`), Postgres, Jest (unit: `npm test -w backend`; Postgres: `npm run test:db -w backend`).

**Spec:** `docs/superpowers/specs/2026-09-26-yagoda-payout-allocations-slice.md`

**Branch:** `feat/payout-allocations` (already checked out, forked from `feat/intake-void-payout-decision` @ `fdb78dc`). Work in place; no worktree.

## Global Constraints

- **Allocation rows are append-only.** The only UPDATE ever run on `payout_allocations` sets `voided_at` on live rows (`release`). Nothing else updates or deletes them.
- **Lock order is fixed on every write path:** `lockSupplier` → advisory code locks (`nextDocumentCode`) → document row locks → inserts. No path takes a document row lock before the supplier lock.
- **`allocate` runs exactly once per transaction, at the end, by the outer operation.** `writePayout` and `voidWithin` never call it.
- **Debt stays `debtSql`.** Do not touch `debtSql`, `debtFor`, or the payout ceilings.
- **No response shape changes.** `SupplierSettlementResponse`, `Settlement` and the mapper stay as they are. No frontend change.
- **Money.** Arithmetic goes through `backend/src/common/money.ts` in application code. `supplier-balance/**` is already in the eslint money `files` list. The migration file is not, and it uses `BigInt` kopecks and imports nothing from the app.
- **The migration's `up()` SQL contains the token `numeric` only inside its `CREATE TABLE`.** `schema-conformance` counts `numeric` tokens in `up()` and fails on any it did not parse. Read amounts with `::text`, write them as plain parameters, and use no `::numeric` casts in the migration.
- **Leaner code** (user direction, 2026-09-25):
  - Methods this slice touches get short why-comments (one or two lines).
  - Essay comments on touched methods are compressed, not extended.
  - The repeated «stub read → supplier lock» opening becomes one small private helper per service.
  - Untouched methods stay as they are.
- **Adjacent modules stay out** (`rejects-adjacent-fixes`). Crates keep their inline supplier lock.
- **Ratchets turn one way.** No baseline, ignore, floor, ceiling or timeout is loosened to get green.
- **Proof tier.** This slice has a migration and money code, so the final gate is `npm run verify:full` (repo root), with its verdict line quoted.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **An operator voiding another point's intake or payout** must still get 404 `Intake not found` / `Payout not found`, with no other status and no timing-visible refusal. The new unlocked stub read comes before the lock, and the point check stays after it. Pinned by the Task 3 and Task 4 unit tests «other point is still 404».
2. **A payout issued at reception that is larger than its receipt** covers its receipt first and then older debt FIFO. Pinned by the Task 4 write-path test «reception payout larger than the receipt».
3. **A top-up written against an already-voided receipt** (legal: it counts for nothing) must never receive an allocation. Pinned by the Task 2 test «top-up on a voided receipt gets nothing».
4. **The dev seed run twice** must insert zero allocations the second time, and the invariants must hold after the seed. Pinned by the Task 5 seed test.
5. **A double-tapped void of a payout** must end with one `payout.voided` and no double-release effect on the invariants. Pinned by the Task 4 concurrency test «two voids of one payout».

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/src/migrations/1788600000018-PayoutAllocations.ts` (create) | Table, indexes, constraints, backfill with a frozen settle copy; exports `backfillPayoutAllocations` |
| `backend/src/supplier-balance/payout-allocation.entity.ts` (create) | TypeORM entity (schema-conformance requires an entity per DBML table) |
| `backend/src/supplier-balance/allocations.service.ts` (create) | `lockSupplier`, `release`, `allocate` |
| `backend/src/supplier-balance/settlement.ts` (modify) | shared `cover` helper; new `fromAllocations`; header rewritten |
| `backend/src/supplier-balance/supplier-balance.service.ts` (modify) | `settlementFor` reads live allocations and calls `fromAllocations` |
| `backend/src/supplier-balance/supplier-balance.module.ts` (modify) | provides and exports `AllocationsService`, `forFeature([PayoutAllocation])` |
| `backend/src/testing/allocation-invariants.ts` (create) | `allocationViolations(m, supplierId)`: the spec §4.5 invariants as SQL |
| `backend/src/payouts/payouts.service.ts` (modify) | lock-first void, `release` in `voidWithin`, `allocate` in `create`/`void` |
| `backend/src/intakes/intakes.service.ts` (modify) | lock-first create/void, `release`, `allocate` |
| `backend/src/intake-top-ups/intake-top-ups.service.ts` + `.module.ts` (modify) | lock-first create/void, `release`, `allocate` |
| `backend/src/intakes/intakes.module.ts` (modify) | import `SupplierBalanceModule` |
| `backend/src/seed/dev-seed.ts` (modify) | allocate every supplier after documents; `summary.allocations` |
| Tests (create): `migrations/payout-allocations-schema.db-spec.ts`, `supplier-balance/allocations.service.spec.ts`, `supplier-balance/allocations.db-spec.ts`, `supplier-balance/allocation-write-paths.db-spec.ts` | |
| Docs: `28-db-schema.dbml`, `26-rules-by-example.md`, `CLAUDE.md`, `backend/CLAUDE.md`, `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md` | |

**Task order is load-bearing.** Writes go live (Tasks 3–4) before the read switches (Task 5). Until Task 5, nothing reads the table, so a half-wired state cannot show a wrong card. After Task 5, `fromAllocations` throws on a live row pointing at a voided document, so every void path must already release.

---

### Task 1: Table, entity, migration with backfill, DBML table block

**Files:**
- Create: `backend/src/migrations/1788600000018-PayoutAllocations.ts`
- Create: `backend/src/supplier-balance/payout-allocation.entity.ts`
- Create: `backend/src/migrations/payout-allocations-schema.db-spec.ts`
- Modify: `28-db-schema.dbml` (add the `Table payout_allocations` block right after `Table intake_top_ups`'s block ends; a short Note now, the full doc rewrite is Task 6)

**Interfaces:**
- Produces: table `payout_allocations(id, payout_id, intake_id, intake_top_up_id, amount, created_at, voided_at)`.
- Produces: `export async function backfillPayoutAllocations(qr: QueryRunner, supplierIds?: string[]): Promise<number>`, which returns the number of rows inserted.
- Produces: entity `PayoutAllocation`.

- [ ] **Step 1: Write the failing schema + backfill db-spec**

`backend/src/migrations/payout-allocations-schema.db-spec.ts`:

```ts
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { backfillPayoutAllocations } from './1788600000018-PayoutAllocations';

/**
 * The table's constraints, and the backfill over the slice-1 fixture (spec
 * 2026-09-25 settlement §5): P1 1300 bound to voided R2 → whole payout FIFO →
 * R1 1000, T1 200, R3 100. Uuid-scoped: the test database is never truncated.
 */
describe('PayoutAllocations migration', () => {
  let ds: DataSource;
  let run: string;
  let userId: string;
  let pointId: string;
  let seq = 0;

  const shift = async (date: string): Promise<string> => {
    const [row] = await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date,
                           closed_at, closed_by_user_id, status)
       VALUES ($1, $2, $3, now(), $2, 'closed') RETURNING id`,
      [pointId, userId, date],
    );
    return row.id as string;
  };
  const supplier = async (): Promise<string> => {
    const [row] = await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name, is_active)
       VALUES ($1, 'Ніна', $2, true) RETURNING id`,
      [pointId, `Алок-${run}-${++seq}`],
    );
    return row.id as string;
  };
  const intake = async (s: string, shiftId: string, amount: string, at: string, voided = false) => {
    const [row] = await ds.query(
      `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id, created_at,
                            voided_at, voided_by_user_id, void_reason)
       VALUES ($1, $2, $3, $4, $5, $6,
               CASE WHEN $7 THEN now() END, CASE WHEN $7 THEN $5::uuid END,
               CASE WHEN $7 THEN 'test' END) RETURNING id`,
      [`IN-${run}-${++seq}`, shiftId, s, amount, userId, at, voided],
    );
    return row.id as string;
  };
  const topUp = async (intakeId: string, amount: string, at: string) => {
    const [row] = await ds.query(
      `INSERT INTO intake_top_ups (intake_id, amount, reason, created_by_user_id, created_at)
       VALUES ($1, $2, 'доплата', $3, $4) RETURNING id`,
      [intakeId, amount, userId, at],
    );
    return row.id as string;
  };
  const payout = async (s: string, shiftId: string, amount: string, intakeId: string | null, at: string) => {
    const [row] = await ds.query(
      `INSERT INTO payouts (code, shift_id, supplier_id, amount, paid_by_user_id, intake_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [`PO-${run}-${++seq}`, shiftId, s, amount, userId, intakeId, at],
    );
    return row.id as string;
  };
  const rowsOf = (s: string) =>
    ds.query(
      `SELECT a.payout_id, a.intake_id, a.intake_top_up_id, a.amount::text AS amount
         FROM payout_allocations a JOIN payouts p ON p.id = a.payout_id
        WHERE p.supplier_id = $1 AND a.voided_at IS NULL
        ORDER BY a.created_at, a.id`,
      [s],
    );

  beforeAll(async () => {
    ds = await openTestDataSource();
    run = randomUUID();
    const [point] = await ds.query(
      `INSERT INTO collection_points (name, kind, code) VALUES ($1, 'reception', $2) RETURNING id`,
      [`Алокації-${run}`, `A${run.slice(0, 4).toUpperCase()}`],
    );
    pointId = point.id;
    const [user] = await ds.query(
      `INSERT INTO users (first_name, last_name, role) VALUES ('Ніна', 'Керівник', 'network_owner') RETURNING id`,
    );
    userId = user.id;
  });

  afterAll(async () => {
    await ds.destroy();
  });

  it('refuses a row with no target, with two targets, or with a non-positive amount', async () => {
    const s = await supplier();
    const sh = await shift('2026-07-01');
    const r = await intake(s, sh, '100.00', '2026-07-01T08:00:00Z');
    const t = await topUp(r, '10.00', '2026-07-01T09:00:00Z');
    const p = await payout(s, sh, '50.00', null, '2026-07-01T10:00:00Z');
    const insert = (i: string | null, tu: string | null, amount: string) =>
      ds.query(
        `INSERT INTO payout_allocations (payout_id, intake_id, intake_top_up_id, amount)
         VALUES ($1, $2, $3, $4)`,
        [p, i, tu, amount],
      );
    await expect(insert(null, null, '1.00')).rejects.toThrow(/CHK_payout_allocations_one_target/);
    await expect(insert(r, t, '1.00')).rejects.toThrow(/CHK_payout_allocations_one_target/);
    await expect(insert(r, null, '0.00')).rejects.toThrow(/CHK_payout_allocations_amount/);
  });

  it('backfills bound first, then FIFO, skipping voided documents', async () => {
    const s = await supplier();
    const s0712 = await shift('2026-07-12');
    const s0715 = await shift('2026-07-15');
    const s0804 = await shift('2026-08-04');
    const r1 = await intake(s, s0712, '1000.00', '2026-07-12T08:00:00Z');
    const t1 = await topUp(r1, '200.00', '2026-08-20T12:00:00Z');
    const r2 = await intake(s, s0715, '300.00', '2026-07-15T08:00:00Z', true);
    const r3 = await intake(s, s0715, '500.00', '2026-07-15T09:00:00Z');
    const p1 = await payout(s, s0804, '1300.00', r2, '2026-08-04T10:00:00Z');

    const qr = ds.createQueryRunner();
    try {
      await expect(backfillPayoutAllocations(qr, [s])).resolves.toBe(3);
    } finally {
      await qr.release();
    }
    const rows = await rowsOf(s);
    // Order-free: the backfill inserts in cover order, but created_at is one statement time.
    expect(rows).toEqual(
      expect.arrayContaining([
        { payout_id: p1, intake_id: r1, intake_top_up_id: null, amount: '1000.00' },
        { payout_id: p1, intake_id: null, intake_top_up_id: t1, amount: '200.00' },
        { payout_id: p1, intake_id: r3, intake_top_up_id: null, amount: '100.00' },
      ]),
    );
    expect(rows).toHaveLength(3);
  });

  it('a bound payout covers its own receipt before older debt', async () => {
    const s = await supplier();
    const sh1 = await shift('2026-07-20');
    const sh2 = await shift('2026-07-21');
    const old = await intake(s, sh1, '1000.00', '2026-07-20T08:00:00Z');
    const r = await intake(s, sh2, '500.00', '2026-07-21T08:00:00Z');
    const p = await payout(s, sh2, '700.00', r, '2026-07-21T08:01:00Z');

    const qr = ds.createQueryRunner();
    try {
      await backfillPayoutAllocations(qr, [s]);
    } finally {
      await qr.release();
    }
    expect(await rowsOf(s)).toEqual(
      expect.arrayContaining([
        { payout_id: p, intake_id: r, intake_top_up_id: null, amount: '500.00' },
        { payout_id: p, intake_id: old, intake_top_up_id: null, amount: '200.00' },
      ]),
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npm run test:db -- payout-allocations-schema`
Expected: FAIL. The module `./1788600000018-PayoutAllocations` cannot be found.

- [ ] **Step 3: Write the migration**

`backend/src/migrations/1788600000018-PayoutAllocations.ts`:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stored allocations — spec 2026-09-26. Reverses the 04.09.2026 removal, which was
 * a failed schema simplification, not the owner's decision.
 *
 * A row is a frozen fact: «payout P paid `amount` of this receipt/top-up».
 * Only `voided_at` ever changes (`AllocationsService.release`).
 *
 * The backfill runs a FROZEN copy of `settle()` in integer kopecks: a migration must
 * not import application code that may change after it ships.
 */
export class PayoutAllocations1788600000018 implements MigrationInterface {
  name = 'PayoutAllocations1788600000018';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "payout_allocations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "payout_id" uuid NOT NULL,
        "intake_id" uuid,
        "intake_top_up_id" uuid,
        "amount" numeric(12,2) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "voided_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_payout_allocations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_payout_allocations_payout" FOREIGN KEY ("payout_id")
          REFERENCES "payouts"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_payout_allocations_intake" FOREIGN KEY ("intake_id")
          REFERENCES "intakes"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_payout_allocations_top_up" FOREIGN KEY ("intake_top_up_id")
          REFERENCES "intake_top_ups"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_payout_allocations_one_target"
          CHECK (num_nonnulls("intake_id", "intake_top_up_id") = 1),
        CONSTRAINT "CHK_payout_allocations_amount" CHECK ("amount" > 0)
      )
    `);
    // Partial: every read and every release filters live rows.
    for (const [name, col] of [
      ['IDX_payout_allocations_payout', 'payout_id'],
      ['IDX_payout_allocations_intake', 'intake_id'],
      ['IDX_payout_allocations_top_up', 'intake_top_up_id'],
    ]) {
      await queryRunner.query(
        `CREATE INDEX "${name}" ON "payout_allocations" ("${col}") WHERE "voided_at" IS NULL`,
      );
    }
    await backfillPayoutAllocations(queryRunner);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "payout_allocations"`);
  }
}

type Line = { id: string; kind: 'intake' | 'top_up'; intake_id: string; open: bigint };
type Pay = { id: string; intake_id: string | null; free: bigint };

const kop = (s: string): bigint => {
  const [whole, frac = ''] = s.split('.');
  return BigInt(whole) * 100n + BigInt((frac + '00').slice(0, 2));
};
const uah = (k: bigint): string => `${k / 100n}.${(k % 100n).toString().padStart(2, '0')}`;
const least = (a: bigint, b: bigint): bigint => (a < b ? a : b);

/** Frozen copy of `settle()` as of 2026-09-26: bound pass, then FIFO. Do not edit. */
function frozenSettle(lines: Line[], pays: Pay[]): { payout_id: string; line: Line; amount: bigint }[] {
  const out: { payout_id: string; line: Line; amount: bigint }[] = [];
  const take = (p: Pay, l: Line, amount: bigint): void => {
    p.free -= amount;
    l.open -= amount;
    out.push({ payout_id: p.id, line: l, amount });
  };
  const byIntake = new Map(lines.filter((l) => l.kind === 'intake').map((l) => [l.intake_id, l]));
  for (const p of pays) {
    const l = p.intake_id === null ? undefined : byIntake.get(p.intake_id);
    if (l && l.open > 0n && p.free > 0n) take(p, l, least(p.free, l.open));
  }
  let cursor = 0;
  for (const p of pays) {
    while (p.free > 0n && cursor < lines.length) {
      const l = lines[cursor];
      if (l.open === 0n) {
        cursor += 1;
        continue;
      }
      take(p, l, least(p.free, l.open));
    }
  }
  return out;
}

/**
 * Allocates every live payout of each supplier from scratch. Assumes the suppliers have
 * no live allocation rows yet (true inside `up()`; the db-spec passes fresh suppliers).
 */
export async function backfillPayoutAllocations(
  qr: QueryRunner,
  supplierIds?: string[],
): Promise<number> {
  const suppliers = (await qr.query(
    `SELECT DISTINCT supplier_id FROM payouts
      WHERE voided_at IS NULL AND ($1::uuid[] IS NULL OR supplier_id = ANY($1::uuid[]))`,
    [supplierIds ?? null],
  )) as { supplier_id: string }[];

  let inserted = 0;
  for (const { supplier_id } of suppliers) {
    const lineRows = (await qr.query(
      `SELECT r.id, r.kind, r.intake_id, r.amount FROM (
         SELECT i.id, 'intake' AS kind, i.id AS intake_id, s.business_date, i.created_at,
                i.amount::text AS amount
           FROM intakes i JOIN shifts s ON s.id = i.shift_id
          WHERE i.supplier_id = $1 AND i.voided_at IS NULL
         UNION ALL
         SELECT t.id, 'top_up', t.intake_id, s.business_date, t.created_at, t.amount::text
           FROM intake_top_ups t
           JOIN intakes ti ON ti.id = t.intake_id
           JOIN shifts s ON s.id = ti.shift_id
          WHERE ti.supplier_id = $1 AND ti.voided_at IS NULL AND t.voided_at IS NULL
       ) r ORDER BY r.business_date, r.created_at, r.id`,
      [supplier_id],
    )) as { id: string; kind: 'intake' | 'top_up'; intake_id: string; amount: string }[];
    const payRows = (await qr.query(
      `SELECT p.id, p.intake_id, p.amount::text AS amount
         FROM payouts p JOIN shifts s ON s.id = p.shift_id
        WHERE p.supplier_id = $1 AND p.voided_at IS NULL
        ORDER BY s.business_date, p.created_at, p.id`,
      [supplier_id],
    )) as { id: string; intake_id: string | null; amount: string }[];

    const covers = frozenSettle(
      lineRows.map((r) => ({ id: r.id, kind: r.kind, intake_id: r.intake_id, open: kop(r.amount) })),
      payRows.map((r) => ({ id: r.id, intake_id: r.intake_id, free: kop(r.amount) })),
    );
    for (const c of covers) {
      await qr.query(
        `INSERT INTO payout_allocations (payout_id, intake_id, intake_top_up_id, amount)
         VALUES ($1, $2, $3, $4)`,
        [
          c.payout_id,
          c.line.kind === 'intake' ? c.line.id : null,
          c.line.kind === 'top_up' ? c.line.id : null,
          uah(c.amount),
        ],
      );
    }
    inserted += covers.length;
  }
  return inserted;
}
```

- [ ] **Step 4: Write the entity**

`backend/src/supplier-balance/payout-allocation.entity.ts`:

```ts
import { Check, Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Payout } from '../payouts/payout.entity';
import { Intake } from '../intakes/intake.entity';
import { IntakeTopUp } from '../intake-top-ups/intake-top-up.entity';

/**
 * «Payout P paid `amount` of this receipt or top-up» — a frozen fact (spec 2026-09-26).
 * Written only by `AllocationsService`; only `voided_at` ever changes.
 */
@Entity('payout_allocations')
@Check('CHK_payout_allocations_one_target', `num_nonnulls("intake_id", "intake_top_up_id") = 1`)
@Check('CHK_payout_allocations_amount', `"amount" > 0`)
export class PayoutAllocation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  payout_id: string;

  @ManyToOne(() => Payout, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'payout_id' })
  payout?: Payout;

  @Column({ type: 'uuid', nullable: true })
  intake_id: string | null;

  @ManyToOne(() => Intake, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'intake_id' })
  intake?: Intake;

  @Column({ type: 'uuid', nullable: true })
  intake_top_up_id: string | null;

  @ManyToOne(() => IntakeTopUp, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'intake_top_up_id' })
  intake_top_up?: IntakeTopUp;

  /** `numeric` — a STRING, never a number (foundation §5.1). */
  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  voided_at: Date | null;
}
```

- [ ] **Step 5: Add the DBML table block**

In `28-db-schema.dbml`, insert this block right after the closing `}` of `Table intake_top_ups` (its Note included):

```dbml
Table payout_allocations {
  id uuid [pk]

  payout_id uuid [not null, ref: > payouts.id]
  intake_id uuid [ref: > intakes.id]
  intake_top_up_id uuid [ref: > intake_top_ups.id]

  amount numeric(12,2) [not null]

  created_at timestamp [not null]
  voided_at timestamp

  indexes {
    (payout_id)
    (intake_id)
    (intake_top_up_id)
  }

  Note: '''
Розподіл виплат (правка 26.09.2026, спека 2026-09-26-yagoda-payout-allocations-slice). Рядок —
заморожений факт «виплата P закрила `amount` цієї квитанції або доплати»; рівно одна ціль
(CHK_payout_allocations_one_target), amount > 0. Змінюється лише voided_at: сторно документа гасить
його рядки, а звільнені гроші йдуть НОВИМИ рядками. Пише тільки AllocationsService, під блокуванням
рядка постачальника, взятим першим. Правило: спершу квитанція з payouts.intake_id, решта — FIFO
(business_date, created_at, id).
'''
}
```

- [ ] **Step 6: Run the db-spec and the schema checks**

Run: `cd backend && npm run test:db -- payout-allocations-schema`
Expected: PASS (3 tests). The test database migrates on open, so the new migration runs first.

Run (repo root): `npm run verify`
Expected: all rows PASSED. `schema-conformance` sees `payout_allocations.amount` as `numeric(12,2)` in the DBML, the entity and the migration. If it reports an unparsed `numeric` token, the backfill SQL contains a cast; remove it.

- [ ] **Step 7: Commit**

```bash
git add backend/src/migrations/1788600000018-PayoutAllocations.ts backend/src/migrations/payout-allocations-schema.db-spec.ts backend/src/supplier-balance/payout-allocation.entity.ts 28-db-schema.dbml
git commit -m "feat(allocations): payout_allocations table with frozen-settle backfill

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `AllocationsService` and the invariant checker

**Files:**
- Create: `backend/src/supplier-balance/allocations.service.ts`
- Create: `backend/src/supplier-balance/allocations.service.spec.ts`
- Create: `backend/src/testing/allocation-invariants.ts`
- Create: `backend/src/supplier-balance/allocations.db-spec.ts`
- Modify: `backend/src/supplier-balance/supplier-balance.module.ts`
- Modify: `backend/src/migrations/payout-allocations-schema.db-spec.ts` (add the backfill ≡ allocate cross-check)

**Interfaces:**
- Consumes: `settle(lines: DebtLine[], payouts: PayoutLine[]): Settlement` from `./settlement` (unchanged).
- Consumes: `backfillPayoutAllocations` from Task 1.
- Produces:
  ```ts
  export type ReleaseTarget = { payoutId: string } | { intakeId: string } | { topUpId: string };
  class AllocationsService {
    lockSupplier(m: EntityManager, supplierId: string): Promise<void>;
    release(m: EntityManager, target: ReleaseTarget): Promise<void>;
    allocate(m: EntityManager, supplierId: string): Promise<number>; // rows inserted
  }
  ```
  `AllocationsService` has **no constructor dependencies**: `new AllocationsService()` works in the seed and in specs.
- Produces: `allocationViolations(m: EntityManager, supplierId: string): Promise<string[]>` in `backend/src/testing/allocation-invariants.ts`. It returns `[]` when all four spec §4.5 invariants hold.

- [ ] **Step 1: Write the failing unit spec**

`backend/src/supplier-balance/allocations.service.spec.ts`:

```ts
import { AllocationsService } from './allocations.service';

describe('AllocationsService', () => {
  const service = new AllocationsService();
  const manager = (reads: unknown[][]) => {
    const query = jest.fn();
    for (const r of reads) query.mockResolvedValueOnce(r);
    query.mockResolvedValue([]);
    return { query } as unknown as import('typeorm').EntityManager & { query: jest.Mock };
  };

  it('lockSupplier takes FOR UPDATE on the supplier row', async () => {
    const m = manager([]);
    await service.lockSupplier(m, 's1');
    expect(m.query).toHaveBeenCalledWith('SELECT id FROM suppliers WHERE id = $1 FOR UPDATE', ['s1']);
  });

  it('release by intake also releases the rows of its top-ups', async () => {
    const m = manager([]);
    await service.release(m, { intakeId: 'i1' });
    const [sql, params] = m.query.mock.calls[0];
    expect(sql).toMatch(/SET voided_at = now\(\)/);
    expect(sql).toMatch(/intake_top_up_id IN \(SELECT id FROM intake_top_ups WHERE intake_id = \$1\)/);
    expect(params).toEqual(['i1']);
  });

  it.each([
    [{ payoutId: 'p1' }, /payout_id = \$1/, 'p1'],
    [{ topUpId: 't1' }, /intake_top_up_id = \$1/, 't1'],
  ])('release %o touches only live rows of that document', async (target, where, id) => {
    const m = manager([]);
    await service.release(m, target);
    const [sql, params] = m.query.mock.calls[0];
    expect(sql).toMatch(/voided_at IS NULL/);
    expect(sql).toMatch(where);
    expect(params).toEqual([id]);
  });

  it('allocate inserts nothing when there is nothing to cover', async () => {
    const m = manager([[], []]);
    await expect(service.allocate(m, 's1')).resolves.toBe(0);
    expect(m.query).toHaveBeenCalledTimes(2);
  });

  it('allocate writes one row per cover, bound first', async () => {
    // Already in queue order — `settle` does not sort, the SQL does.
    const line = (id: string, kind: 'intake' | 'top_up', intake_id: string, amount: string) => ({
      id, kind, code: 'IN-1', intake_id, business_date: '2026-07-01', created_at: '2026-07-01 08:00', amount,
    });
    const m = manager([
      [line('r1', 'intake', 'r1', '100.00'), line('t1', 'top_up', 'r1', '20.00'), line('r22', 'intake', 'r22', '50.00')],
      [{ id: 'p1', code: 'PO-1', business_date: '2026-07-02', created_at: '2026-07-02 00', amount: '80.00', intake_id: 'r22' }],
    ]);
    await expect(service.allocate(m, 's1')).resolves.toBe(2);
    const [sql, params] = m.query.mock.calls[2];
    expect(sql).toMatch(/INSERT INTO payout_allocations/);
    expect(params).toEqual([
      ['p1', 'p1'],
      ['r22', 'r1'],
      [null, null],
      ['50.00', '30.00'],
    ]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npm test -- allocations.service`
Expected: FAIL. `Cannot find module './allocations.service'`.

- [ ] **Step 3: Implement the service**

`backend/src/supplier-balance/allocations.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { settle, DebtLine, PayoutLine } from './settlement';

export type ReleaseTarget = { payoutId: string } | { intakeId: string } | { topUpId: string };

/** What is still open on each live line, queue-ordered. A top-up queues under its parent's date. */
const RESIDUAL_LINES_SQL = `
  SELECT r.id, r.kind, r.code, r.intake_id, r.business_date::text AS business_date,
         r.created_at::text AS created_at, r.open::text AS amount
    FROM (
      SELECT i.id, 'intake' AS kind, i.code, i.id AS intake_id, s.business_date, i.created_at,
             i.amount - COALESCE((SELECT SUM(a.amount) FROM payout_allocations a
                                   WHERE a.intake_id = i.id AND a.voided_at IS NULL), 0) AS open
        FROM intakes i JOIN shifts s ON s.id = i.shift_id
       WHERE i.supplier_id = $1 AND i.voided_at IS NULL
      UNION ALL
      SELECT t.id, 'top_up', ti.code, t.intake_id, s.business_date, t.created_at,
             t.amount - COALESCE((SELECT SUM(a.amount) FROM payout_allocations a
                                   WHERE a.intake_top_up_id = t.id AND a.voided_at IS NULL), 0)
        FROM intake_top_ups t
        JOIN intakes ti ON ti.id = t.intake_id
        JOIN shifts s ON s.id = ti.shift_id
       WHERE ti.supplier_id = $1 AND ti.voided_at IS NULL AND t.voided_at IS NULL
    ) r
   WHERE r.open > 0
   ORDER BY r.business_date, r.created_at, r.id`;

/** What is still free on each live payout, queue-ordered. */
const RESIDUAL_PAYOUTS_SQL = `
  SELECT r.id, r.code, r.intake_id, r.business_date::text AS business_date,
         r.created_at::text AS created_at, r.free::text AS amount
    FROM (
      SELECT p.id, p.code, p.intake_id, s.business_date, p.created_at,
             p.amount - COALESCE((SELECT SUM(a.amount) FROM payout_allocations a
                                   WHERE a.payout_id = p.id AND a.voided_at IS NULL), 0) AS free
        FROM payouts p JOIN shifts s ON s.id = p.shift_id
       WHERE p.supplier_id = $1 AND p.voided_at IS NULL
    ) r
   WHERE r.free > 0
   ORDER BY r.business_date, r.created_at, r.id`;

/**
 * The only writer of `payout_allocations` (spec 2026-09-26 §4.2). Rows are frozen:
 * `release` stamps `voided_at`, `allocate` appends. Callers hold `lockSupplier` first.
 */
@Injectable()
export class AllocationsService {
  /** Per-supplier mutex, taken before any document lock so every path locks in one order. */
  async lockSupplier(m: EntityManager, supplierId: string): Promise<void> {
    await m.query('SELECT id FROM suppliers WHERE id = $1 FOR UPDATE', [supplierId]);
  }

  /** Voids a document's live rows. An intake takes its top-ups' rows with it, as `debtSql` does. */
  async release(m: EntityManager, target: ReleaseTarget): Promise<void> {
    const [where, id] =
      'payoutId' in target
        ? ['payout_id = $1', target.payoutId]
        : 'topUpId' in target
          ? ['intake_top_up_id = $1', target.topUpId]
          : [
              '(intake_id = $1 OR intake_top_up_id IN (SELECT id FROM intake_top_ups WHERE intake_id = $1))',
              target.intakeId,
            ];
    await m.query(
      `UPDATE payout_allocations SET voided_at = now() WHERE voided_at IS NULL AND ${where}`,
      [id],
    );
  }

  /** Settles residuals and appends one row per cover. Idempotent: nothing left, nothing written. */
  async allocate(m: EntityManager, supplierId: string): Promise<number> {
    const lines = (await m.query(RESIDUAL_LINES_SQL, [supplierId])) as DebtLine[];
    const payouts = (await m.query(RESIDUAL_PAYOUTS_SQL, [supplierId])) as PayoutLine[];
    const covers = settle(lines, payouts).payouts.flatMap((p) =>
      p.covers.map((c) => ({ payout_id: p.id, ...c })),
    );
    if (covers.length === 0) return 0;

    await m.query(
      `INSERT INTO payout_allocations (payout_id, intake_id, intake_top_up_id, amount)
       SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::numeric[])`,
      [
        covers.map((c) => c.payout_id),
        covers.map((c) => (c.kind === 'intake' ? c.line_id : null)),
        covers.map((c) => (c.kind === 'top_up' ? c.line_id : null)),
        covers.map((c) => c.amount),
      ],
    );
    return covers.length;
  }
}
```

Check the expected params in the unit test against `settle()`:
- Pass 1: p1 is bound to r22 and covers 50.00 of it.
- Pass 2: the remaining 30.00 goes to r1, the queue head.

So the params are `payout_id ['p1','p1']`, `intake_id ['r22','r1']`, `top_up [null,null]`, `amount ['50.00','30.00']`. The test encodes this; if it disagrees, fix the test's reasoning, not `settle()`.

- [ ] **Step 4: Wire it into the module**

`backend/src/supplier-balance/supplier-balance.module.ts`:
- Import `TypeOrmModule` and `PayoutAllocation`, and add `TypeOrmModule.forFeature([PayoutAllocation])` to `imports`.
- Add `AllocationsService` to `providers` and `exports`.
- Replace the header's first paragraph («OWNS NO TABLE AND WRITES NOTHING …») with: «Owns `payout_allocations` and nothing else. The debt formula still reads `intakes`, `intake_top_ups` and `payouts` directly (reads are open); allocation rows are written only through `AllocationsService`.»
- Update the line «`PayoutsModule` imports it for the §3.6 ceiling; nothing else does.» to «Imported by `PayoutsModule` (ceiling + allocations), `IntakesModule` and `IntakeTopUpsModule` (allocations).»

- [ ] **Step 5: Run the unit spec**

Run: `cd backend && npm test -- allocations.service`
Expected: PASS (6 tests).

- [ ] **Step 6: Write the invariant checker**

`backend/src/testing/allocation-invariants.ts`:

```ts
import { EntityManager } from 'typeorm';
import { SupplierBalanceService } from '../supplier-balance/supplier-balance.service';
import { sub } from '../common/money';

/** Spec 2026-09-26 §4.5 as SQL. `[]` means all four hold for this supplier. */
export async function allocationViolations(m: EntityManager, supplierId: string): Promise<string[]> {
  const [r] = (await m.query(
    `WITH lines AS (
       SELECT i.amount, COALESCE((SELECT SUM(a.amount) FROM payout_allocations a
                                   WHERE a.intake_id = i.id AND a.voided_at IS NULL), 0) AS alloc
         FROM intakes i WHERE i.supplier_id = $1 AND i.voided_at IS NULL
       UNION ALL
       SELECT t.amount, COALESCE((SELECT SUM(a.amount) FROM payout_allocations a
                                   WHERE a.intake_top_up_id = t.id AND a.voided_at IS NULL), 0)
         FROM intake_top_ups t JOIN intakes ti ON ti.id = t.intake_id
        WHERE ti.supplier_id = $1 AND ti.voided_at IS NULL AND t.voided_at IS NULL
     ), pays AS (
       SELECT p.amount, COALESCE((SELECT SUM(a.amount) FROM payout_allocations a
                                   WHERE a.payout_id = p.id AND a.voided_at IS NULL), 0) AS alloc
         FROM payouts p WHERE p.supplier_id = $1 AND p.voided_at IS NULL
     )
     SELECT (SELECT COALESCE(SUM(amount - alloc), 0.00) FROM lines)::text AS open,
            (SELECT COALESCE(SUM(amount - alloc), 0.00) FROM pays)::text AS unallocated,
            (SELECT count(*) FROM lines WHERE amount > alloc)::int AS open_lines,
            (SELECT count(*) FROM pays WHERE amount > alloc)::int AS free_payouts,
            ((SELECT count(*) FROM lines WHERE alloc > amount)
              + (SELECT count(*) FROM pays WHERE alloc > amount))::int AS over,
            (SELECT count(*) FROM payout_allocations a
               JOIN payouts p ON p.id = a.payout_id
               LEFT JOIN intakes i ON i.id = a.intake_id
               LEFT JOIN intake_top_ups t ON t.id = a.intake_top_up_id
               LEFT JOIN intakes ti ON ti.id = t.intake_id
              WHERE p.supplier_id = $1 AND a.voided_at IS NULL
                AND (p.voided_at IS NOT NULL OR i.voided_at IS NOT NULL
                     OR t.voided_at IS NOT NULL OR ti.voided_at IS NOT NULL))::int AS dangling`,
    [supplierId],
  )) as {
    open: string;
    unallocated: string;
    open_lines: number;
    free_payouts: number;
    over: number;
    dangling: number;
  }[];

  const debt = await new SupplierBalanceService(m.connection).debtFor(supplierId, m);
  const out: string[] = [];
  if (sub(r.open, r.unallocated) !== debt) out.push(`open ${r.open} − unallocated ${r.unallocated} ≠ debt ${debt}`);
  if (r.open_lines > 0 && r.free_payouts > 0) out.push(`${r.open_lines} open lines beside ${r.free_payouts} free payouts`);
  if (r.dangling > 0) out.push(`${r.dangling} live rows on voided documents`);
  if (r.over > 0) out.push(`${r.over} documents over-allocated`);
  return out;
}
```

`sub` returns a canonical scale-2 string and `debtFor` returns `::text` of a scale-2 numeric (fallback `0.00`), so string equality is exact.

Also create `backend/src/testing/seeded-random.ts`. It lives outside the eslint money list, which bans `*` in `supplier-balance/**`:

```ts
/** Deterministic PRNG for db-spec event sequences (mulberry32). Never for app money. */
export function seededRandom(seed: number) {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const index = (n: number): number => Math.floor(next() * n);
  return {
    index,
    pick: <T>(xs: T[]): T => xs[index(xs.length)],
    /** A positive amount 1.00–400.99 as a scale-2 string. */
    cash: (): string => `${1 + index(400)}.${String(index(100)).padStart(2, '0')}`,
  };
}
```

- [ ] **Step 7: Write the failing Postgres spec for the allocator**

`backend/src/supplier-balance/allocations.db-spec.ts`. Build the fixture helpers the same way as `migrations/payout-allocations-schema.db-spec.ts` (`shift`, `supplier`, `intake`, `topUp`, `payout`, with raw inserts and per-run uuids). Use one open-or-closed shift per date. `created_at` defaults to `now()`, and each event runs in its own transaction, so later events queue later. Add these event wrappers, each one transaction mirroring what the services will do:

```ts
const alloc = new AllocationsService();
const event = (supplierId: string, write: (m: EntityManager) => Promise<void>) =>
  ds.transaction(async (m) => {
    await alloc.lockSupplier(m, supplierId);
    await write(m);
    await alloc.allocate(m, supplierId);
  });
const voidDoc = (table: 'intakes' | 'payouts' | 'intake_top_ups', id: string) => (m: EntityManager) =>
  m.query(
    `UPDATE ${table} SET voided_at = now(), voided_by_user_id = $2, void_reason = 'test' WHERE id = $1`,
    [id, userId],
  );
const live = (s: string) =>
  ds.query(
    `SELECT a.id, a.payout_id, a.intake_id, a.intake_top_up_id, a.amount::text AS amount
       FROM payout_allocations a JOIN payouts p ON p.id = a.payout_id
      WHERE p.supplier_id = $1 AND a.voided_at IS NULL ORDER BY a.created_at, a.id`,
    [s],
  );
```

The inserts of `intake`, `topUp` and `payout` take an `EntityManager` param so they run inside `event`. **They set `created_at = clock_timestamp()`, not the column default `now()`.** `now()` is the transaction start, so two inserts in one `event` would tie and queue by random uuid. Tests:

```ts
it('frozen: a void re-routes freed money by NEW rows and leaves others untouched', async () => {
  const s = await supplier();
  const sh = await shift('2026-06-01');
  let r1 = '', r2 = '', p1 = '', p2 = '';
  await event(s, async (m) => { r1 = await intake(m, s, sh, '100.00'); });
  await event(s, async (m) => { p1 = await payout(m, s, sh, '60.00', null); });
  await event(s, async (m) => { r2 = await intake(m, s, sh, '100.00'); });
  await event(s, async (m) => { p2 = await payout(m, s, sh, '100.00', null); });
  // p1→r1 60, p2→r1 40, p2→r2 60
  const before = await live(s);
  const p2r2 = before.find((a: { payout_id: string; intake_id: string }) => a.payout_id === p2 && a.intake_id === r2);
  expect(p2r2.amount).toBe('60.00');

  await event(s, async (m) => { await voidDoc('intakes', r1)(m); await alloc.release(m, { intakeId: r1 }); });
  const after = await live(s);
  // The p2→r2 60 row is the SAME row, still live; p1's freed 60 covers r2's last 40 by a new row.
  expect(after.find((a: { id: string }) => a.id === p2r2.id)).toEqual(p2r2);
  expect(after).toEqual(expect.arrayContaining([
    expect.objectContaining({ payout_id: p1, intake_id: r2, amount: '40.00' }),
  ]));
  expect(after).toHaveLength(2);
  expect(await ds.transaction((m) => allocationViolations(m, s))).toEqual([]);
});

it('keep: a bound payout whose receipt is voided frees its money, and the next receipt takes it', async () => {
  const s = await supplier();
  const sh = await shift('2026-06-02');
  let old = '', r = '', r3 = '';
  await event(s, async (m) => { old = await intake(m, s, sh, '1000.00'); });
  await event(s, async (m) => {
    r = await intake(m, s, sh, '500.00');
    await payout(m, s, sh, '1500.00', r);
  });
  await event(s, async (m) => { await voidDoc('intakes', r)(m); await alloc.release(m, { intakeId: r }); });
  const settled = await ds.transaction((m) => allocationViolations(m, s));
  expect(settled).toEqual([]);
  await event(s, async (m) => { r3 = await intake(m, s, sh, '300.00'); });
  expect(await live(s)).toEqual(expect.arrayContaining([
    expect.objectContaining({ intake_id: old, amount: '1000.00' }),
    expect.objectContaining({ intake_id: r3, amount: '300.00' }),
  ]));
  expect(await ds.transaction((m) => allocationViolations(m, s))).toEqual([]);
});

it('voiding a top-up releases only its rows', async () => {
  const s = await supplier();
  const sh = await shift('2026-06-03');
  let r = '', t = '';
  await event(s, async (m) => { r = await intake(m, s, sh, '100.00'); t = await topUp(m, r, '50.00'); });
  await event(s, async (m) => { await payout(m, s, sh, '150.00', null); });
  await event(s, async (m) => { await voidDoc('intake_top_ups', t)(m); await alloc.release(m, { topUpId: t }); });
  const rows = await live(s);
  expect(rows).toEqual([expect.objectContaining({ intake_id: r, amount: '100.00' })]);
  expect(await ds.transaction((m) => allocationViolations(m, s))).toEqual([]);
});

it('top-up on a voided receipt gets nothing', async () => {
  const s = await supplier();
  const sh = await shift('2026-06-04');
  let r = '';
  await event(s, async (m) => { r = await intake(m, s, sh, '100.00'); });
  await event(s, async (m) => { await voidDoc('intakes', r)(m); await alloc.release(m, { intakeId: r }); });
  await event(s, async (m) => { await payout(m, s, sh, '40.00', null); });
  await event(s, async (m) => { await topUp(m, r, '70.00'); });
  const rows = await live(s);
  expect(rows).toEqual([]);
  expect(await ds.transaction((m) => allocationViolations(m, s))).toEqual([]);
});

it('allocate twice in a row writes nothing the second time', async () => {
  const s = await supplier();
  const sh = await shift('2026-06-05');
  await event(s, async (m) => { await intake(m, s, sh, '100.00'); await payout(m, s, sh, '30.00', null); });
  await expect(ds.transaction(async (m) => { await alloc.lockSupplier(m, s); return alloc.allocate(m, s); })).resolves.toBe(0);
});

it('a seeded random sequence of 40 events keeps all four invariants after every event', async () => {
  const s = await supplier();
  const sh = await shift('2026-06-06');
  const { pick, cash, index } = seededRandom(20260926);
  const intakes: string[] = [];
  const topUps: string[] = [];
  const payouts: string[] = [];
  for (let i = 0; i < 40; i++) {
    const kind = pick(['intake', 'intake', 'payout', 'payout', 'bound', 'topUp', 'voidIntake', 'voidPayout', 'voidTopUp']);
    await event(s, async (m) => {
      if (kind === 'intake' || intakes.length === 0) intakes.push(await intake(m, s, sh, cash()));
      else if (kind === 'payout') payouts.push(await payout(m, s, sh, cash(), null));
      else if (kind === 'bound') payouts.push(await payout(m, s, sh, cash(), pick(intakes)));
      else if (kind === 'topUp') topUps.push(await topUp(m, pick(intakes), cash()));
      else if (kind === 'voidIntake') {
        const id = intakes.splice(index(intakes.length), 1)[0];
        await voidDoc('intakes', id)(m);
        await alloc.release(m, { intakeId: id });
      } else if (kind === 'voidPayout' && payouts.length > 0) {
        const id = payouts.splice(index(payouts.length), 1)[0];
        await voidDoc('payouts', id)(m);
        await alloc.release(m, { payoutId: id });
      } else if (kind === 'voidTopUp' && topUps.length > 0) {
        const id = topUps.splice(index(topUps.length), 1)[0];
        await voidDoc('intake_top_ups', id)(m);
        await alloc.release(m, { topUpId: id });
      }
    });
    expect({ step: i, kind, violations: await ds.transaction((m) => allocationViolations(m, s)) })
      .toEqual({ step: i, kind, violations: [] });
  }
});
```

Import `seededRandom` from `../testing/seeded-random` and `allocationViolations` from `../testing/allocation-invariants`. Check `npm run lint` in Step 9: nothing in this file may use `*`, `Number()` or `toFixed`.

- [ ] **Step 8: Add the backfill ≡ allocate cross-check**

Append to `backend/src/migrations/payout-allocations-schema.db-spec.ts`:

```ts
it('the frozen backfill and the live allocator write the same rows over the same documents', async () => {
  const build = async () => {
    const s = await supplier();
    const d1 = await shift('2026-08-01');
    const d2 = await shift('2026-08-02');
    const a = await intake(s, d1, '400.00', '2026-08-01T08:00:00Z');
    const b = await intake(s, d1, '300.00', '2026-08-01T09:00:00Z', true);
    const t = await topUp(a, '50.00', '2026-08-05T08:00:00Z');
    const c = await intake(s, d2, '200.00', '2026-08-02T08:00:00Z');
    const p1 = await payout(s, d2, '380.00', c, '2026-08-02T08:01:00Z');
    const p2 = await payout(s, d2, '100.00', b, '2026-08-02T09:00:00Z');
    return { s, names: new Map([[a, 'a'], [t, 't'], [c, 'c'], [p1, 'p1'], [p2, 'p2']]) };
  };
  const shape = async (s: string, names: Map<string, string>) =>
    (await rowsOf(s))
      .map((r: { payout_id: string; intake_id: string | null; intake_top_up_id: string | null; amount: string }) =>
        `${names.get(r.payout_id)}→${names.get((r.intake_id ?? r.intake_top_up_id) as string)}:${r.amount}`)
      .sort();

  const frozen = await build();
  const qr = ds.createQueryRunner();
  try {
    await backfillPayoutAllocations(qr, [frozen.s]);
  } finally {
    await qr.release();
  }
  const live = await build();
  await ds.transaction(async (m) => {
    const alloc = new AllocationsService();
    await alloc.lockSupplier(m, live.s);
    await alloc.allocate(m, live.s);
  });
  expect(await shape(frozen.s, frozen.names)).toEqual(await shape(live.s, live.names));
});
```

Add `import { AllocationsService } from '../supplier-balance/allocations.service';` at the top.

- [ ] **Step 9: Run everything for this task**

Run: `cd backend && npm test -- allocations.service && npm run test:db -- allocations payout-allocations-schema && npm run lint`
Expected: all PASS, and lint is clean.

- [ ] **Step 10: Commit**

```bash
git add backend/src/supplier-balance/allocations.service.ts backend/src/supplier-balance/allocations.service.spec.ts backend/src/supplier-balance/allocations.db-spec.ts backend/src/supplier-balance/supplier-balance.module.ts backend/src/testing/allocation-invariants.ts backend/src/testing/seeded-random.ts backend/src/migrations/payout-allocations-schema.db-spec.ts
git commit -m "feat(allocations): AllocationsService — lock, release, residual allocate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Payout write paths

**Files:**
- Modify: `backend/src/payouts/payouts.service.ts`
- Modify: `backend/src/payouts/payouts.service.spec.ts` (constructor gains `allocations`; new cases)
- Create: `backend/src/supplier-balance/allocation-write-paths.db-spec.ts`

**Interfaces:**
- Consumes: `AllocationsService.lockSupplier`, `release`, `allocate` from Task 2, injected as `private readonly allocations: AllocationsService`. It is the last constructor param, after `pointCash`.
- Produces:
  - `voidWithin(m, actor, payout, reason)` now also calls `this.allocations.release(m, { payoutId: payout.id })`. Its signature is unchanged.
  - `writePayout` no longer inlines the lock. It calls `this.allocations.lockSupplier(m, supplierId)`.
  - Neither method calls `allocate`.

- [ ] **Step 1: Write the failing unit cases**

In `payouts.service.spec.ts`:
- Add an `allocations` mock `{ lockSupplier: jest.fn(), release: jest.fn(), allocate: jest.fn().mockResolvedValue(0) }` as the new last constructor argument (line ~113).
- The existing test that asserts the inline `SELECT id FROM suppliers … FOR UPDATE` query now asserts `allocations.lockSupplier` was called with `(m, supplierId)` before `shifts.findOpenAtPoint`. Use `mock.invocationCallOrder`.
- Add these cases. They reuse the spec's existing manager/transaction mocks: read how the file builds its `m` and `dataSource.transaction` and extend them, so that `m.findOne(Payout, { where: { id } })` without `lock` returns the stub.

```ts
it('create allocates once, after the payout is written', async () => {
  // arrange as the existing «writes a payout» case
  await service.create(owner, dto);
  expect(allocations.allocate).toHaveBeenCalledTimes(1);
  expect(allocations.allocate).toHaveBeenCalledWith(expect.anything(), dto.supplier_id);
});

it('void locks the supplier before the payout row, releases, then allocates once', async () => {
  await service.void(owner, payoutId, { reason: 'помилка' });
  const lock = allocations.lockSupplier.mock.invocationCallOrder[0];
  const rowLock = (m.findOne as jest.Mock).mock.calls.findIndex(([, o]) => o?.lock);
  expect(lock).toBeLessThan((m.findOne as jest.Mock).mock.invocationCallOrder[rowLock]);
  expect(allocations.release).toHaveBeenCalledWith(expect.anything(), { payoutId });
  expect(allocations.allocate).toHaveBeenCalledTimes(1);
});

it('void of a missing payout is 404 before any lock', async () => {
  (m.findOne as jest.Mock).mockResolvedValueOnce(null);
  await expect(service.void(owner, 'nope', { reason: 'x' })).rejects.toThrow('Payout not found');
  expect(allocations.lockSupplier).not.toHaveBeenCalled();
});

it('other point is still 404 for an operator', async () => {
  // arrange the stub + locked load returning a payout whose shift is at another point
  await expect(service.void(operatorElsewhere, payoutId, { reason: 'x' })).rejects.toThrow('Payout not found');
  expect(allocations.release).not.toHaveBeenCalled();
});

it('voidWithin releases the payout and does not allocate', async () => {
  await service.voidWithin(m, owner, payout, 'r');
  expect(allocations.release).toHaveBeenCalledWith(m, { payoutId: payout.id });
  expect(allocations.allocate).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npm test -- payouts.service`
Expected: FAIL on the new cases (`allocate` not called, `lockSupplier` not called).

- [ ] **Step 3: Implement**

In `payouts.service.ts`:

1. Import `AllocationsService` from `'../supplier-balance/allocations.service'` and add `private readonly allocations: AllocationsService` as the last constructor param. `SupplierBalanceModule` already exports it, and `PayoutsModule` already imports that module.
2. In `writePayout`:
   - Replace `await m.query('SELECT id FROM suppliers WHERE id = $1 FOR UPDATE', [supplierId]);` with `await this.allocations.lockSupplier(m, supplierId);`.
   - Compress the JSDoc and the «THE LOCK COMES FIRST» block to: `/** THE payout writer, inside the caller's transaction (standalone create and §2.1 ⑥ reception). Lock order: supplier (already held on the reception path) → open shift → debt → PO code lock → cash → insert. The supplier row is the per-supplier mutex behind both ceilings; SERIALIZABLE was rejected (no retry infrastructure). Callers have checked point, supplier activity and supplier-at-point. Callers run \`allocate\`. */`
   - Keep the in-body comment about reading cash after `nextDocumentCode`, compressed to two lines: `// Cash is shift-wide: read it under the PO code lock (the shift mutex), not only the supplier lock — PR #137.`
3. In `create`, inside the transaction, after `writePayout` returns and before building the response: `await this.allocations.allocate(m, supplier.id);`.
4. `void`:
   ```ts
   /** §9.4 as in `IntakesService.void`. Voiding does not return the cash (§9.3). */
   async void(actor: AuthenticatedUser, id: string, dto: VoidDocumentDto): Promise<PayoutResponse> {
     return this.dataSource.transaction(async (m) => {
       const supplierId = await this.lockSupplierOf(m, id);
       const { payout, shift } = await this.loadForWrite(actor, id, { requireAuthor: true }, m);
       if (payout.voided_at) {
         throw new ConflictException({ message: 'That payout is already voided', code: 'ALREADY_VOIDED' });
       }
       const voided = await this.voidWithin(m, actor, payout, dto.reason);
       await this.allocations.allocate(m, supplierId);
       return toPayoutResponse(voided, shift);
     });
   }

   /** Unlocked stub read (a missing id 404s before any lock), then the supplier lock — always first. */
   private async lockSupplierOf(m: EntityManager, id: string): Promise<string> {
     const stub = await m.findOne(Payout, { where: { id } });
     if (!stub) throw new NotFoundException('Payout not found');
     await this.allocations.lockSupplier(m, stub.supplier_id);
     return stub.supplier_id;
   }
   ```
5. `voidWithin`: after `m.save(Payout, payout)` and before the audit record, add `await this.allocations.release(m, { payoutId: saved.id });`. Update its JSDoc to: `/** Voids a payout the caller loaded, locked and authorised, and releases its allocations. The caller allocates. */`.
6. `settleReturn` is unchanged.

- [ ] **Step 4: Run the unit spec**

Run: `cd backend && npm test -- payouts.service`
Expected: PASS.

- [ ] **Step 5: Write the HTTP write-path db-spec (payout cases)**

Create `backend/src/supplier-balance/allocation-write-paths.db-spec.ts`:
- Copy the app bootstrap and user fixture from `backend/src/intakes/intake-paid-at-reception.db-spec.ts` lines 1–118: imports, `pointCode`, top-level `beforeAll` (owner, **one** point, one operator on it) and `afterAll`. Prefix every `providerUserId` with `awp-`.
- Then copy the catalog `beforeAll` and `line()` helper from lines 124–177 of the same file, with names prefixed `awp-`. Keep only one point in the prices loop.
- Add:

```ts
import { DataSource } from 'typeorm';
import { allocationViolations } from '../testing/allocation-invariants';

let ds: DataSource; // set in beforeAll: ds = app.get(DataSource);

const http = () => request(app.getHttpServer());
const as = (token: string) => ({
  post: (url: string, body: object) => http().post(url).set('Authorization', `Bearer ${token}`).send(body),
});
const violations = (supplierId: string) => ds.transaction((m) => allocationViolations(m, supplierId));
const liveRows = (supplierId: string) =>
  ds.query(
    `SELECT a.payout_id, a.intake_id, a.intake_top_up_id, a.amount::text AS amount
       FROM payout_allocations a JOIN payouts p ON p.id = a.payout_id
      WHERE p.supplier_id = $1 AND a.voided_at IS NULL ORDER BY a.created_at, a.id`,
    [supplierId],
  );
// One crate (1.20 kg) at 100.00/kg: gross '11.20' → 1000.00, '6.20' → 500.00, '4.20' → 300.00, '3.20' → 200.00.
const receipt = (supplierId: string, gross: string, paid?: string) =>
  as(operatorToken).post('/intakes', {
    supplier_id: supplierId,
    items: [{ product_grade_id: gradeId, gross_kg: gross, tare: [{ tare_type_id: crateId, units: 1 }] }],
    ...(paid ? { paid_amount: paid } : {}),
  });
```

Gross weights are literal strings on purpose: `supplier-balance/**` bans `toFixed` and float arithmetic.

Each `describe` or test creates its own supplier (`POST /suppliers` as the operator). The shift opens **once**, in the top-level `beforeAll`, with `POST /shifts { counted_amount: '100000.00' }` as the operator, so the cash ceiling never bites. A point has one open shift, and Task 4 adds more `describe`s to this file.

Payout cases:

```ts
describe('payouts', () => {
  let s: string;
  beforeAll(async () => {
    s = (await as(operatorToken).post('/suppliers', { first_name: 'Ніна', last_name: `awp-${randomUUID()}` }).expect(201)).body.id;
  });

  it('a standalone payout allocates FIFO and keeps the invariants', async () => {
    await receipt(s, '11.20').expect(201); // 1000
    await receipt(s, '6.20').expect(201);  // 500
    await as(operatorToken).post('/payouts', { supplier_id: s, amount: '1200.00' }).expect(201);
    expect((await liveRows(s)).map((r: { amount: string }) => r.amount)).toEqual(['1000.00', '200.00']);
    expect(await violations(s)).toEqual([]);
  });

  it('voiding a payout releases its rows; the next payout re-covers the oldest open line', async () => {
    const p = (await as(operatorToken).post('/payouts', { supplier_id: s, amount: '100.00' }).expect(201)).body.id;
    await as(operatorToken).post(`/payouts/${p}/void`, { reason: 'помилка' }).expect(201);
    expect(await violations(s)).toEqual([]);
    const released = await ds.query(`SELECT count(*)::int AS n FROM payout_allocations WHERE payout_id = $1 AND voided_at IS NOT NULL`, [p]);
    expect(released[0].n).toBe(1);
  });
});
```

If `POST /payouts/:id/void` answers 200 rather than 201, match the existing `intake-paid-at-reception.db-spec.ts` void call (line ~303) and use its status.

- [ ] **Step 6: Run it**

Run: `cd backend && npm run test:db -- allocation-write-paths payout`
Expected: PASS, and the existing `payout-*.db-spec.ts` files stay green.

- [ ] **Step 7: Commit**

```bash
git add backend/src/payouts/payouts.service.ts backend/src/payouts/payouts.service.spec.ts backend/src/supplier-balance/allocation-write-paths.db-spec.ts
git commit -m "feat(allocations): payouts lock the supplier first, release on void, allocate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Intake and top-up write paths, concurrency

**Files:**
- Modify: `backend/src/intakes/intakes.service.ts`, `backend/src/intakes/intakes.module.ts`, `backend/src/intakes/intakes.service.spec.ts`
- Modify: `backend/src/intake-top-ups/intake-top-ups.service.ts`, `backend/src/intake-top-ups/intake-top-ups.module.ts`, `backend/src/intake-top-ups/intake-top-ups.service.spec.ts`, `backend/src/intake-top-ups/intake-top-ups-list.db-spec.ts` (constructor call only)
- Modify: `backend/src/supplier-balance/allocation-write-paths.db-spec.ts`

**Interfaces:**
- Consumes: the `AllocationsService` methods from Task 2, and `PayoutsService.voidWithin` (which now releases) and `writePayout` (which locks through `AllocationsService`) from Task 3.
- `IntakesService` gains the last constructor param `private readonly allocations: AllocationsService`. `IntakeTopUpsService` gains it as the last param too: `(repo, dataSource, audit, allocations)`.

- [ ] **Step 1: Write the failing unit cases**

`intakes.service.spec.ts`: add the `allocations` mock as the last constructor argument at line ~203, then add:

```ts
it('create locks the supplier before numbering and allocates once at the end', async () => {
  await service.create(operator, dto);
  expect(allocations.lockSupplier.mock.invocationCallOrder[0])
    .toBeLessThan(/* the nextDocumentCode advisory query's order: the m.query call whose SQL matches /pg_advisory_xact_lock/ */ advisoryOrder());
  expect(allocations.allocate).toHaveBeenCalledTimes(1);
});

it('void locks the supplier before the intake row, releases the intake, allocates once', async () => {
  await service.void(owner, intakeId, { reason: 'x' });
  expect(allocations.release).toHaveBeenCalledWith(expect.anything(), { intakeId });
  expect(allocations.allocate).toHaveBeenCalledTimes(1);
});

it('void with payout decision void allocates once, after both voids', async () => {
  // arrange a live bound payout as the existing «void» decision case does
  await service.void(owner, intakeId, { reason: 'x', payout: 'void' });
  expect(allocations.allocate).toHaveBeenCalledTimes(1);
  expect(allocations.allocate.mock.invocationCallOrder[0])
    .toBeGreaterThan(payouts.voidWithin.mock.invocationCallOrder[0]);
});

it('void of a missing intake is 404 before any lock', async () => {
  // stub read returns null
  await expect(service.void(owner, 'nope', { reason: 'x' })).rejects.toThrow('Intake not found');
  expect(allocations.lockSupplier).not.toHaveBeenCalled();
});

it('other point is still 404 for an operator', async () => {
  // as the existing other-point case
  await expect(service.void(operatorElsewhere, intakeId, { reason: 'x' })).rejects.toThrow('Intake not found');
  expect(allocations.release).not.toHaveBeenCalled();
});
```

`advisoryOrder()` is a small local helper in the spec: find the index of the `m.query` call whose SQL matches `/pg_advisory_xact_lock/` and return `m.query.mock.invocationCallOrder[thatIndex]`. If the spec mocks `nextDocumentCode` rather than `m.query`, compare against that mock's `invocationCallOrder[0]` instead.

The existing refusal-order tests (404 → other-point 404 → `NOT_YOUR_DOCUMENT` → `SHIFT_CLOSED` → `ALREADY_VOIDED`) must still pass unchanged. Their mocks now also need the unlocked stub read to return the intake.

`intake-top-ups.service.spec.ts`: pass the `allocations` mock as the 4th constructor argument (lines 53 and 206), then add:

```ts
it('create locks the supplier before the insert and allocates once', async () => {
  await service.create(owner, dto);
  expect(allocations.lockSupplier).toHaveBeenCalledWith(expect.anything(), supplier.id);
  expect(allocations.lockSupplier.mock.invocationCallOrder[0])
    .toBeLessThan((m.save as jest.Mock).mock.invocationCallOrder[0]);
  expect(allocations.allocate).toHaveBeenCalledTimes(1);
});

it('void releases the top-up and allocates once', async () => {
  await service.void(owner, topUpId, { reason: 'x' });
  expect(allocations.release).toHaveBeenCalledWith(expect.anything(), { topUpId });
  expect(allocations.allocate).toHaveBeenCalledTimes(1);
});
```

`intake-top-ups-list.db-spec.ts` line 118: pass `new AllocationsService()` as the 4th argument.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd backend && npm test -- intakes.service intake-top-ups.service`
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement `IntakesService`**

- Add `SupplierBalanceModule` to `IntakesModule.imports`.
- Inject `private readonly allocations: AllocationsService` as the last constructor param.
- `create`: first line inside `this.dataSource.transaction(async (m) => {`, before `this.compute(...)`: `await this.allocations.lockSupplier(m, supplier.id); // first: no KEY SHARE → FOR UPDATE upgrade, one lock order`. After the optional `writePayout` block and before `return toIntakeDetailResponse(...)`: `await this.allocations.allocate(m, supplier.id);`.
- `void`:
  ```ts
  /** §9.4 row by row, plus #125's payout decision. Lock order: supplier → intake → payout. */
  async void(actor: AuthenticatedUser, id: string, dto: VoidIntakeDto): Promise<IntakeResponse> {
    return this.dataSource.transaction(async (m) => {
      const supplierId = await this.lockSupplierOf(m, id);
      const { intake, shift } = await this.loadForVoid(actor, id, m);
      // §3.5: a bound payout shares the receipt's author and shift; `void_returned` alone is owner-only.
      const payout = await this.payouts.findLiveBoundForUpdate(m, intake.id);
      assertPayoutDecision(actor, payout !== null, dto.payout);

      // No balance floor: voiding a receipt is the one allowed way into negative debt.
      intake.voided_at = new Date();
      intake.voided_by_user_id = actor.sub;
      intake.void_reason = dto.reason;
      const saved = await m.save(Intake, intake);
      await this.allocations.release(m, { intakeId: saved.id });
      await this.audit.record(/* unchanged */, m);

      if (payout && dto.payout !== 'keep') {
        const voided = await this.payouts.voidWithin(m, actor, payout, dto.reason);
        if (dto.payout === 'void_returned') {
          await this.payouts.settleReturnWithin(m, actor, voided, dto.reason);
        }
      }
      await this.allocations.allocate(m, supplierId);

      return toIntakeResponse(saved, shift, await this.extrasFor(saved.id, m));
    });
  }

  /** Unlocked stub read (a missing id 404s before any lock), then the supplier lock — always first. */
  private async lockSupplierOf(m: EntityManager, id: string): Promise<string> {
    const stub = await m.findOne(Intake, { where: { id } });
    if (!stub) throw new NotFoundException('Intake not found');
    await this.allocations.lockSupplier(m, stub.supplier_id);
    return stub.supplier_id;
  }
  ```
  `loadForVoid` is unchanged. Its locked `findOne` stays, and its refusal order is unchanged.

- [ ] **Step 4: Implement `IntakeTopUpsService`**

- Add `SupplierBalanceModule` to `IntakeTopUpsModule.imports`.
- Inject `private readonly allocations: AllocationsService` as the 4th constructor param.
- `create`: after the `SUPPLIER_INACTIVE` check and before `m.save(IntakeTopUp, …)`, add `await this.allocations.lockSupplier(m, supplier.id);`. After the audit record, add `await this.allocations.allocate(m, supplier.id);`.
- Compress the two long comments in `create` (the deactivated-supplier one and «NO CHECK ON `intake.voided_at`») to one line each:
  - `// Inactive supplier refused: the counter could not settle this debt (PayoutsService refuses them).`
  - `// A voided parent is legal: the row simply never counts (debtSql, allocate).`
- `void`:
  ```ts
  return this.dataSource.transaction(async (m) => {
    const stub = await m.findOne(IntakeTopUp, { where: { id } });
    if (!stub) throw new NotFoundException('Intake top-up not found');
    const intake = await m.findOne(Intake, { where: { id: stub.intake_id } });
    if (!intake) throw new NotFoundException('Intake top-up not found');
    await this.allocations.lockSupplier(m, intake.supplier_id); // supplier first, then the row

    const topUp = await m.findOne(IntakeTopUp, { where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!topUp) throw new NotFoundException('Intake top-up not found');
    if (topUp.voided_at) {
      throw new ConflictException({ message: 'That top-up is already voided', code: 'ALREADY_VOIDED' });
    }
    topUp.voided_at = new Date();
    topUp.voided_by_user_id = actor.sub;
    topUp.void_reason = dto.reason.trim();
    const saved = await m.save(IntakeTopUp, topUp);
    await this.allocations.release(m, { topUpId: saved.id });
    await this.audit.record(/* unchanged */, m);
    await this.allocations.allocate(m, intake.supplier_id);
    return toIntakeTopUpResponse(saved, intake);
  });
  ```
  Drop the old comment on the second `NotFoundException`. Keep the owner check before the transaction.

- [ ] **Step 5: Run the unit specs**

Run: `cd backend && npm test -- intakes.service intake-top-ups.service payout-decision`
Expected: PASS.

- [ ] **Step 6: Extend the write-path db-spec**

Append to `allocation-write-paths.db-spec.ts`. The owner token is needed for top-ups.

```ts
describe('intakes and top-ups', () => {
  let s: string;
  beforeEach(async () => {
    s = (await as(operatorToken).post('/suppliers', { first_name: 'Ніна', last_name: `awp-${randomUUID()}` }).expect(201)).body.id;
  });

  it('reception payout larger than the receipt covers the receipt first, then older debt', async () => {
    const old = (await receipt(s, '11.20').expect(201)).body.id;           // 1000
    const r = (await receipt(s, '6.20', '1200.00').expect(201)).body.id;   // 500, paid 1200
    const rows = await liveRows(s);
    expect(rows).toEqual([
      expect.objectContaining({ intake_id: r, amount: '500.00' }),
      expect.objectContaining({ intake_id: old, amount: '700.00' }),
    ]);
    expect(await violations(s)).toEqual([]);
  });

  it('a receipt with no payout picks up free money FIFO', async () => {
    await receipt(s, '4.20').expect(201);                                    // 300
    await as(operatorToken).post('/payouts', { supplier_id: s, amount: '300.00' }).expect(201);
    const r = (await receipt(s, '3.20').expect(201)).body.id;               // 200, nothing free
    expect((await liveRows(s)).some((x: { intake_id: string }) => x.intake_id === r)).toBe(false);
    expect(await violations(s)).toEqual([]);
  });

  it('void with keep frees the bound payout; void releases both; invariants hold after each', async () => {
    const r1 = (await receipt(s, '6.20', '500.00').expect(201)).body.id;
    await as(operatorToken).post(`/intakes/${r1}/void`, { reason: 'x', payout: 'keep' }).expect(201);
    expect(await violations(s)).toEqual([]);
    const r2 = (await receipt(s, '6.20', '500.00').expect(201)).body.id;
    expect(await violations(s)).toEqual([]);
    await as(operatorToken).post(`/intakes/${r2}/void`, { reason: 'x', payout: 'void' }).expect(201);
    expect(await violations(s)).toEqual([]);
  });

  it('top-up create and void keep the invariants', async () => {
    const r = (await receipt(s, '6.20').expect(201)).body.id;
    await as(operatorToken).post('/payouts', { supplier_id: s, amount: '500.00' }).expect(201);
    const t = (await as(ownerToken).post('/intake-top-ups', { intake_id: r, amount: '50.00', reason: 'ціна' }).expect(201)).body.id;
    expect(await violations(s)).toEqual([]);
    await as(ownerToken).post(`/intake-top-ups/${t}/void`, { reason: 'x' }).expect(201);
    expect(await violations(s)).toEqual([]);
  });
});

describe('concurrency', () => {
  let s: string;
  beforeEach(async () => {
    s = (await as(operatorToken).post('/suppliers', { first_name: 'Ніна', last_name: `awp-${randomUUID()}` }).expect(201)).body.id;
    await receipt(s, '11.20').expect(201); // 1000 of debt to pay against
  });

  it('two payouts at once: both land, no double allocation', async () => {
    const [a, b] = await Promise.all([
      as(operatorToken).post('/payouts', { supplier_id: s, amount: '400.00' }),
      as(operatorToken).post('/payouts', { supplier_id: s, amount: '400.00' }),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(await violations(s)).toEqual([]);
  });

  it('two receipts at once: both land, invariants hold', async () => {
    await as(operatorToken).post('/payouts', { supplier_id: s, amount: '1000.00' }).expect(201);
    const [a, b] = await Promise.all([receipt(s, '4.20'), receipt(s, '3.20')]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(await violations(s)).toEqual([]);
  });

  it('a receipt void against a new payout: no deadlock, invariants hold', async () => {
    const r = (await receipt(s, '6.20', '500.00').expect(201)).body.id;
    const [v, p] = await Promise.all([
      as(operatorToken).post(`/intakes/${r}/void`, { reason: 'x', payout: 'keep' }),
      as(operatorToken).post('/payouts', { supplier_id: s, amount: '100.00' }),
    ]);
    expect(v.status).toBe(201);
    expect([201, 400]).toContain(p.status); // 400 only as PAYOUT_EXCEEDS_DEBT if the void landed first
    expect(await violations(s)).toEqual([]);
  });

  it('a payout void against a new receipt: no deadlock, invariants hold', async () => {
    const p = (await as(operatorToken).post('/payouts', { supplier_id: s, amount: '600.00' }).expect(201)).body.id;
    const [v, r] = await Promise.all([
      as(operatorToken).post(`/payouts/${p}/void`, { reason: 'x' }),
      receipt(s, '4.20'),
    ]);
    expect([v.status, r.status]).toEqual([201, 201]);
    expect(await violations(s)).toEqual([]);
  });

  it('two voids of one payout: one wins, one payout.voided, invariants hold', async () => {
    const p = (await as(operatorToken).post('/payouts', { supplier_id: s, amount: '100.00' }).expect(201)).body.id;
    const res = await Promise.all([
      as(operatorToken).post(`/payouts/${p}/void`, { reason: 'x' }),
      as(operatorToken).post(`/payouts/${p}/void`, { reason: 'x' }),
    ]);
    expect(res.map((x) => x.status).sort()).toEqual([201, 409]);
    const [{ n }] = await ds.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE action = 'payout.voided' AND target_id = $1`, [p]);
    expect(n).toBe(1);
    expect(await violations(s)).toEqual([]);
  });
});
```

Match the void and top-up routes' status codes and the top-up body to `intake-void-payout-decision.db-spec.ts` and `intake-top-ups-list.db-spec.ts`. Read those files before running. If the audit table or column names differ from `audit_log(action, target_id)`, copy the query from `intake-void-payout-decision.db-spec.ts`'s concurrent-void test.

- [ ] **Step 7: Run the Postgres suites this task touches**

Run: `cd backend && npm run test:db -- allocation-write-paths intake payout top-up`
Expected: PASS, including slice 2's `intake-void-payout-decision.db-spec.ts` with unchanged expectations.

- [ ] **Step 8: Commit**

```bash
git add backend/src/intakes backend/src/intake-top-ups backend/src/supplier-balance/allocation-write-paths.db-spec.ts
git commit -m "feat(allocations): intakes and top-ups lock the supplier first, release, allocate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Read path from stored rows, seed, fixtures

**Files:**
- Modify: `backend/src/supplier-balance/settlement.ts`, `backend/src/supplier-balance/settlement.spec.ts`
- Modify: `backend/src/supplier-balance/supplier-balance.service.ts`, `backend/src/supplier-balance/supplier-balance.service.spec.ts` (if it stubs the three reads, add the fourth)
- Modify: `backend/src/supplier-balance/settlement.db-spec.ts` (fixture calls allocate)
- Modify: `backend/src/seed/dev-seed.ts`, `backend/src/seed/dev-seed.db-spec.ts`
- Modify: any other db-spec found by Step 7's grep

**Interfaces:**
- Produces, in `settlement.ts`:
  ```ts
  export interface AllocationRow { payout_id: string; intake_id: string | null; intake_top_up_id: string | null; amount: string }
  export function fromAllocations(lines: DebtLine[], payouts: PayoutLine[], allocations: AllocationRow[]): Settlement
  ```
- `settle()` is unchanged in behaviour and still exported (`AllocationsService` uses it).
- `DevSeedSummary` gains `allocations: number`.

- [ ] **Step 1: Write the failing unit cases**

Append to `settlement.spec.ts`:

```ts
import { fromAllocations } from './settlement';

describe('fromAllocations', () => {
  const line = (id: string, amount: string, kind: 'intake' | 'top_up' = 'intake', intake_id = id) => ({
    id, kind, code: 'IN-1', intake_id, business_date: '2026-07-01', created_at: '2026-07-01 08:00', amount,
  });
  const pay = (id: string, amount: string) => ({
    id, code: 'PO-1', business_date: '2026-07-02', created_at: '2026-07-02 08:00', amount, intake_id: null,
  });

  it('no rows: every line fully open, every payout fully unallocated', () => {
    const s = fromAllocations([line('r1', '100.00')], [pay('p1', '30.00')], []);
    expect(s.lines[0]).toMatchObject({ paid: '0.00', open: '100.00', covered_by: [] });
    expect(s.payouts[0]).toMatchObject({ covers: [], unallocated: '30.00' });
    expect(s.unallocated).toBe('30.00');
  });

  it('a partial cover and a top-up row', () => {
    const s = fromAllocations(
      [line('r1', '100.00'), line('t1', '20.00', 'top_up', 'r1')],
      [pay('p1', '110.00')],
      [
        { payout_id: 'p1', intake_id: 'r1', intake_top_up_id: null, amount: '100.00' },
        { payout_id: 'p1', intake_id: null, intake_top_up_id: 't1', amount: '10.00' },
      ],
    );
    expect(s.lines.map((l) => l.open)).toEqual(['0.00', '10.00']);
    expect(s.payouts[0].covers).toEqual([
      { line_id: 'r1', kind: 'intake', amount: '100.00' },
      { line_id: 't1', kind: 'top_up', amount: '10.00' },
    ]);
    expect(s.unallocated).toBe('0.00');
  });

  it('two rows on one pair stay two entries and sum', () => {
    const s = fromAllocations([line('r1', '100.00')], [pay('p1', '100.00')], [
      { payout_id: 'p1', intake_id: 'r1', intake_top_up_id: null, amount: '60.00' },
      { payout_id: 'p1', intake_id: 'r1', intake_top_up_id: null, amount: '40.00' },
    ]);
    expect(s.lines[0].covered_by).toEqual([
      { payout_id: 'p1', amount: '60.00' },
      { payout_id: 'p1', amount: '40.00' },
    ]);
    expect(s.lines[0].open).toBe('0.00');
  });

  it('a row pointing outside the live documents throws, loudly', () => {
    expect(() =>
      fromAllocations([line('r1', '100.00')], [pay('p1', '10.00')], [
        { payout_id: 'p1', intake_id: 'gone', intake_top_up_id: null, amount: '10.00' },
      ]),
    ).toThrow(/outside the live documents/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npm test -- settlement.spec`
Expected: FAIL. `fromAllocations` is not exported.

- [ ] **Step 3: Implement `fromAllocations` and share `cover`**

In `settlement.ts`:

1. Replace the header comment (the whole «ЗА ЩО САМЕ ВИННІ …» block) with:
   ```ts
   /**
    * «За що саме винні» — spec 2026-09-26 (stored allocations).
    *
    * `settle` is the allocation RULE: bound pass (a payout covers its own receipt), then
    * FIFO over `(business_date, created_at, id)`. `AllocationsService.allocate` runs it on
    * residuals and stores each cover as a frozen `payout_allocations` row.
    * `fromAllocations` rebuilds the read model from those live rows.
    *
    * Pure, no Nest/DB/Date; every amount a scale-2 string through `money.ts`.
    */
   ```
2. Hoist the private helpers to module level so both functions share them:
   ```ts
   const open = (lines: DebtLine[]): SettledLine[] =>
     lines.map((l) => ({ ...l, paid: '0.00', open: l.amount, covered_by: [] }));
   const unpaid = (payouts: PayoutLine[]): SettledPayout[] =>
     payouts.map((p) => ({ ...p, covers: [], unallocated: p.amount }));
   const cover = (payout: SettledPayout, line: SettledLine, amount: string): void => {
     line.paid = add(line.paid, amount);
     line.open = sub(line.open, amount);
     line.covered_by.push({ payout_id: payout.id, amount });
     payout.unallocated = sub(payout.unallocated, amount);
     payout.covers.push({ line_id: line.id, kind: line.kind, amount });
   };
   const result = (lines: SettledLine[], payouts: SettledPayout[]): Settlement => ({
     unallocated: sum(payouts.map((p) => p.unallocated)),
     lines,
     payouts,
   });
   ```
   Then rewrite `settle` to use `open`, `unpaid`, `cover` and `result`. The two passes stay as they are, with their one-line comments.
3. Add:
   ```ts
   export interface AllocationRow {
     payout_id: string;
     intake_id: string | null;
     intake_top_up_id: string | null;
     amount: string;
   }

   /** The read model from live allocation rows. A row outside `lines`/`payouts` is a broken invariant: throw. */
   export function fromAllocations(
     lines: DebtLine[],
     payouts: PayoutLine[],
     allocations: AllocationRow[],
   ): Settlement {
     const settledLines = open(lines);
     const settledPayouts = unpaid(payouts);
     const lineById = new Map(settledLines.map((l) => [l.id, l]));
     const payoutById = new Map(settledPayouts.map((p) => [p.id, p]));
     for (const a of allocations) {
       const line = lineById.get(a.intake_id ?? a.intake_top_up_id ?? '');
       const payout = payoutById.get(a.payout_id);
       if (!line || !payout) {
         throw new Error(`Allocation of payout ${a.payout_id} points outside the live documents`);
       }
       cover(payout, line, a.amount);
     }
     return result(settledLines, settledPayouts);
   }
   ```

- [ ] **Step 4: Run the pure specs**

Run: `cd backend && npm test -- settlement`
Expected: PASS (`settlement.spec.ts`, `settlement.properties.spec.ts` unchanged and green).

- [ ] **Step 5: Switch `settlementFor`**

In `supplier-balance.service.ts` `settlementFor`:
- Add a fourth read after the payouts read:
  ```ts
  const allocations = (await manager.query(
    `SELECT a.payout_id, a.intake_id, a.intake_top_up_id, a.amount::text AS amount
       FROM payout_allocations a
       JOIN payouts p ON p.id = a.payout_id
      WHERE p.supplier_id = $1 AND a.voided_at IS NULL
      ORDER BY a.created_at, a.id`,
    [supplierId],
  )) as AllocationRow[];
  ```
- Replace `settle(lines, payoutLines)` with `fromAllocations(lines, payoutLines, allocations)`, and update the imports (`fromAllocations`, `AllocationRow`; drop `settle` if unused).
- Compress the method's JSDoc to: `/** «За що саме винні» for one supplier. Live documents (the four \`voided_at\` filters of \`debtSql\`) plus live allocation rows, in one REPEATABLE READ snapshot so \`debt\` and \`Σ open − unallocated\` agree. */`.
- If `supplier-balance.service.spec.ts` stubs `manager.query` per read, add a fourth stubbed result (`[]`) where it asserts `settlementFor`.

- [ ] **Step 6: Make the settlement db-spec allocate its raw fixture**

In `settlement.db-spec.ts` `beforeAll`, after the last fixture insert (`const r4 = …`), add:

```ts
await ds.transaction(async (m) => {
  const alloc = new AllocationsService();
  await alloc.lockSupplier(m, supplierId);
  await alloc.allocate(m, supplierId);
});
```

Import `AllocationsService`. Allocating once over the final raw state equals `settle()` over it, so every expectation stays as it is. Add one test:

```ts
it('holds the four allocation invariants', async () => {
  expect(await ds.transaction((m) => allocationViolations(m, supplierId))).toEqual([]);
});
```

- [ ] **Step 7: Find other raw fixtures that read the settlement**

Run: `cd backend && grep -rln "settlement\|/settlement" src --include=*db-spec.ts`

(zsh: if `--include` errors, use `grep -rl settlement src | grep db-spec`.)

For each hit other than `settlement.db-spec.ts` and `allocation-write-paths.db-spec.ts`: if it inserts documents with raw SQL and then reads `settlementFor` or `GET /suppliers/:id/settlement` **without** a service write in between, add the same allocate-after-fixture block. `intake-void-payout-decision.db-spec.ts` reads the settlement only after a void through HTTP, and that void now allocates, so it needs the block only if a test reads before voiding. Check each test there.

- [ ] **Step 8: Seed allocates**

In `dev-seed.ts`:
- Add `allocations: 0` to the `summary` initialiser and `allocations: number` to `DevSeedSummary`.
- In `seedDev`, right after `await seedDocuments(...)` and before `commitTransaction`:
  ```ts
  // Documents above are raw inserts; allocate them as the services would. Idempotent.
  const alloc = new AllocationsService();
  const suppliers = (await qr.query(`SELECT id FROM suppliers ORDER BY id`)) as { id: string }[];
  for (const { id } of suppliers) {
    await alloc.lockSupplier(qr.manager, id);
    summary.allocations += await alloc.allocate(qr.manager, id);
  }
  ```

In `dev-seed.db-spec.ts`:
- Add `allocations: 0` to the idempotency expectation.
- Add:
  ```ts
  it('allocates every seeded supplier: the invariants hold', async () => {
    const suppliers = (await ds.query(`SELECT id FROM suppliers`)) as { id: string }[];
    for (const { id } of suppliers) {
      expect({ id, v: await ds.transaction((m) => allocationViolations(m, id)) }).toEqual({ id, v: [] });
    }
  });
  ```
- If `dev-seed.spec.ts` (unit) asserts the summary shape, add `allocations` there too.

This test runs over every supplier in the shared test database, including other specs' raw fixtures that were never allocated. If it fails on a supplier that the seed did not create, scope the query to seeded suppliers: `WHERE collection_point_id IN (SELECT id FROM collection_points WHERE name = ANY($1))` with the seed's point names, taken from `SEED_POINTS` in `dev-seed.data.ts`.

- [ ] **Step 9: Run the full Postgres suite and the unit suite**

Run: `cd backend && npm test && npm run test:db`
Expected: all PASS.

- [ ] **Step 10: Commit**

```bash
git add backend/src/supplier-balance backend/src/seed backend/src
git commit -m "feat(allocations): settlement reads stored rows; seed and raw fixtures allocate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Stage only the files you changed. `git status` first.)

---

### Task 6: Documents and the full gate

**Files:**
- Modify: `26-rules-by-example.md`, `28-db-schema.dbml`, `CLAUDE.md`, `backend/CLAUDE.md`, `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md`

- [ ] **Step 1: `26-rules-by-example.md`**

1. After the existing «Правка (2026-09-25, слайс розрахунків)» block at §3.3 (line ~472), add:
   ```markdown
   → **Правка (схема, 26.09.2026):** розподіл **знову зберігається** — таблиця `payout_allocations`,
   як і описано в оригінальному правилі вище («розподіл (від найстарішого)»). Прибрання розподілу
   04.09.2026 **не було рішенням власника**: це артефакт невдалої спроби спростити схему. Рядок
   розподілу — заморожений факт; сторно документа гасить його рядки, а звільнені гроші йдуть новими
   рядками за тим самим правилом (спершу своя квитанція, далі найстаріший відкритий залишок).
   Примітки 04.09 і 25.09 про «розподілу немає / не зберігається» — СКАСОВАНО, лишаються для історії.
   Спека `docs/superpowers/specs/2026-09-26-yagoda-payout-allocations-slice.md`.
   ```
2. Prefix the cancelled notes with `**СКАСОВАНО 26.09.2026 — див. правку §3.3.**`: the 04.09 note at line ~982 («цей FIFO — єдиний, що лишився»), the 04.09 edit at line ~1117 («розподілу, який їх розрізняв, не існує»), the 25.09 edit at line ~472, and the 25.09 note at line ~1629.
3. At §3.10 and at §9 (next to line ~1588 «сторно розкручує розподіл НАЗАД»), add a one-line pointer: `→ **Правка (26.09.2026):** розподіл зберігається — див. правку §3.3.`.

Use `grep -n "04.09.2026\|2026-09-25\|25.09" 26-rules-by-example.md` to find the exact spots. Touch only notes about the money breakdown (розподіл/allocations); the villages, starting-balance and other 04.09 notes stay.

- [ ] **Step 2: `28-db-schema.dbml`**

1. Header line ~23–25: in the comment that attributes the allocations removal to «рішення власника 04.09.2026» and points to «Розподіл є, але не зберігається», change only the allocations part to: `payout_allocations прибрано 04.09.2026 невдалою спробою спростити схему (НЕ рішення власника) і повернуто 26.09.2026 — див. Table payout_allocations`. Leave the villages attribution alone.
2. `suppliers` Note, «Борг = різниця двох історій» (line ~234): replace «Розподілу … не існує — його прибрано 04.09.2026 разом із таблицею `payout_allocations`. ПРАВКА 2026-09-25: … ОБЧИСЛЮЄТЬСЯ …» with: «Борг рахується формулою двох історій, а не сумою розподілу. Розподіл («яка виплата що закрила») зберігається окремо в `payout_allocations` (правка 26.09.2026); інваріант `Σ open − unallocated = борг` тримають тести.»
3. Rename the section «### Розподіл є, але не зберігається (2026-09-25)» to «### Розподіл зберігається (2026-09-26)» and replace its body with:
   ```text
   «За що саме винні» читається з живих рядків `payout_allocations` (voided_at IS NULL), які
   пише один `AllocationsService.allocate` у транзакції кожної події: виплата, квитанція,
   доплата і сторно кожної з них. Правило: спершу виплата закриває квитанцію зі свого
   `payouts.intake_id`, решта — найстаріший відкритий рядок першим; доплата стоїть у черзі під
   датою своєї квитанції. Рядки заморожені: сторно документа гасить його рядки, звільнені гроші
   йдуть новими. Кожен шлях запису спершу блокує рядок постачальника. Історія: 04.09.2026
   таблицю прибрали (не рішення власника), 25.09.2026 розподіл рахувався на льоту, 26.09.2026
   повернуто зберігання.
   ```
4. `intakes` Note (line ~688), the sentence «з 04.09.2026 залишку ОКРЕМОЇ КВИТАНЦІЇ не існує взагалі … не має відповіді ні в схемі, ні на екрані»: replace it with «залишок окремої квитанції — це її сума мінус живі рядки `payout_allocations` (правка 26.09.2026)».
5. The `payouts` Note: if it says `intake_id` is «NOT AN ALLOCATION» / no breakdown exists, add one sentence: «`intake_id` — це прив'язка до візиту; розподіл, що з неї випливає, записується в `payout_allocations` (спершу своя квитанція).»

- [ ] **Step 3: `CLAUDE.md` and `backend/CLAUDE.md`**

- `CLAUDE.md` «Domain» bullet: after the reweigh/day_expenses sentence, add «, plus `payout_allocations` (stored allocations slice, 2026-09-26 — spec `docs/superpowers/specs/2026-09-26-yagoda-payout-allocations-slice.md`)», and change «**twenty-two tables in all**» to «**twenty-three tables in all**».
- `backend/CLAUDE.md`: find the settlement paragraph (`grep -n "settlement\|settle" backend/CLAUDE.md`). Rewrite it in 3–4 lines:
  - `GET /suppliers/:id/settlement` reads live `payout_allocations` rows;
  - `AllocationsService` (`lockSupplier`, `release`, `allocate`) is their only writer;
  - every write path locks the supplier row first and allocates once at the end;
  - raw-SQL fixtures must call `allocate`.

- [ ] **Step 4: Follow-ups**

In `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md`, section «Deferred from slice 2»:
- Mark the stored-allocations item done: `~~…~~ **Done 2026-09-26** on \`feat/payout-allocations\``.
- Add:
  - «Crates could take the supplier lock through `AllocationsService.lockSupplier` instead of their inline `SELECT … FOR UPDATE` (three call sites in `crates.service.ts`). Same query; left out of the allocations slice as an adjacent module.»
  - «No UI shows allocation history (voided rows). `GET /suppliers/:id/settlement` serves live rows only.»

- [ ] **Step 5: Run the full gate**

Run (repo root): `npm run verify:full`
Expected: every row PASSED. Quote the verdict line in the report. If `smoke` fails between 00:00 and 03:00 Kyiv, that is the known `APP_TIMEZONE=UTC` issue from the follow-ups: say so, and do not treat it as green. If `coverage` or another row is red because of this slice, fix the code or the test. Loosen no ceiling, floor, baseline or timeout.

- [ ] **Step 6: Commit**

```bash
git add 26-rules-by-example.md 28-db-schema.dbml CLAUDE.md backend/CLAUDE.md docs/superpowers/2026-09-05-foundation-slice-follow-ups.md
git commit -m "docs(allocations): 26.09 edit reverses 04.09 — allocations are stored again

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

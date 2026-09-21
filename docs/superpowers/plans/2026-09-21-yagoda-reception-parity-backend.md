# «Прийомка» parity — PR 1 (backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `POST /intakes` can hand cash over in the same transaction as the receipt (§2.1 ⑥, §3.1), every payout is capped by the drawer as well as the debt (§3.6), and the intake reads carry what the reception screen needs to show a row without a second request.

**Architecture:** `PayoutsService` gains ONE transactional writer, `writePayout(manager, …)`, that locks the supplier, resolves the open shift, checks the two ceilings, numbers the document and writes it — `create` (standalone «Видати без ягоди») and `IntakesService.create` (paid at reception) both call it, so the ceiling has exactly one implementation. A nullable `payouts.intake_id` records which visit the cash was handed over with — a signature, not a debt allocation (§3.3 is cancelled). `GET /intakes` rows and `GET /intakes/:id` gain aggregate columns computed in SQL (`net_kg`, `lines_count`, `paid_amount`, `supplier_name`), and the detail adds `payouts` and `received_by_name`.

**Tech Stack:** NestJS 12, TypeORM (`synchronize: false`, hand-written migrations), Postgres, jest unit specs with hand-rolled mocks, `*.db-spec.ts` against a real Postgres through `openTestDataSource()` / a booted `AppModule` (see `backend/src/testing/documents-pipeline.db-spec.ts`).

**Spec:** `docs/superpowers/specs/2026-09-21-yagoda-reception-parity.md` §1–§2 (this PR), programme rules in `docs/superpowers/specs/2026-09-17-yagoda-mock-parity-programme.md` §2.

## Global Constraints

- Every arithmetic operation on money or weight goes through `backend/src/common/money.ts` (`add`, `sub`, `sum`, `gt`, `isZero`, …). ESLint bans `*`, `/`, `Number()`, `parseFloat`, `toFixed` inside `intakes/`, `payouts/` and the other money modules. SQL text may aggregate (`SUM`, `COUNT`) — the database is the second sanctioned place for arithmetic, and every numeric leaves it as `::text`.
- `numeric` values are STRINGS end to end; never a JS `number`.
- No `PATCH`, no `DELETE` on a document. Nothing in this plan edits an existing row except adding the nullable column.
- Lock order inside any transaction that writes a payout: `suppliers` row (`FOR UPDATE`) → open shift → debt → cash → `nextDocumentCode` advisory lock → insert. `IntakesService.create` takes the `intakes` advisory lock before any of these; that lock is only ever taken first, so no cycle exists (spec §2.1).
- The next free migration number in this tree is `1788600000016`; PR #128 (open) already uses it, so this PR uses **`1788600000017`**.
- `ValidationPipe` runs with `whitelist: true, forbidNonWhitelisted: true, transform: true` — an unknown body key is a 400.
- Errors are `{ message, code }` objects; the client branches on `code`. New codes in this PR: `PAYOUT_EXCEEDS_CASH`. Reused: `PAYOUT_EXCEEDS_DEBT`, `NO_OPEN_SHIFT`, `PAYOUT_CODE_TAKEN`.
- Verification tier for this PR is **`npm run verify:full`** (a migration and money code). Report the runner's verdict line and name every `SKIPPED` row.
- Commit after every task with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Do not push and do not open a PR — the owner reviews locally first.
- Work in the worktree `.claude/worktrees/reception` on branch `feat/reception-parity`. `.env` is symlinked there; `npm run test:db -w backend` needs the compose Postgres (`docker compose up -d postgres redis` from the MAIN checkout if it is down).

---

### Task 1: `payouts.intake_id` — migration, entity, DBML, schema spec

**Files:**
- Create: `backend/src/migrations/1788600000017-PayoutIntakeLink.ts`
- Create: `backend/src/migrations/payout-intake-link-schema.db-spec.ts`
- Modify: `backend/src/payouts/payout.entity.ts` (after the `supplier` relation, ~line 84)
- Modify: `backend/src/payouts/payout.mapper.ts` (add `intake_id` to `PayoutResponse` and the mapper)
- Modify: `28-db-schema.dbml` (`Table payouts`, ~line 707)

**Interfaces:**
- Produces: `Payout.intake_id: string | null`, `PayoutResponse.intake_id: string | null`.

- [ ] **Step 1: Write the failing schema spec**

```ts
// backend/src/migrations/payout-intake-link-schema.db-spec.ts
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';

/**
 * `payouts.intake_id` — the «paid at reception» signature (spec
 * 2026-09-21 §2.2). What is under test is the DDL only: nullable, a real FK,
 * RESTRICT on the intake side. Per-run uuids in every fixture: app_test
 * persists between runs and nothing here truncates.
 */
describe('payouts.intake_id schema (Postgres)', () => {
  let ds: DataSource;
  let run: string;
  let shiftId: string;
  let supplierId: string;
  let userId: string;
  let intakeId: string;

  beforeAll(async () => {
    ds = await openTestDataSource();
    run = randomUUID().slice(0, 8);

    const [{ id: pointId }] = await ds.query(
      `INSERT INTO collection_points (name, kind, code) VALUES ($1, 'reception', $2) RETURNING id`,
      [`Виплата-при-прийомці ${run}`, `P${run.slice(0, 5).toUpperCase()}`],
    );
    // `CHK_users_role_point`: an operator row must name its point.
    [{ id: userId }] = await ds.query(
      `INSERT INTO users (first_name, last_name, role, collection_point_id)
       VALUES ('Оксана', $1, 'point_operator', $2) RETURNING id`,
      [`Тест-${run}`, pointId],
    );
    [{ id: supplierId }] = await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name, is_active)
       VALUES ($1, 'Іван', $2, true) RETURNING id`,
      [pointId, `Тест-${run}`],
    );
    [{ id: shiftId }] = await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date)
       VALUES ($1, $2, '2026-09-21') RETURNING id`,
      [pointId, userId],
    );
    [{ id: intakeId }] = await ds.query(
      `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id)
       VALUES ($1, $2, $3, '1000.00', $4) RETURNING id`,
      [`P-IN-${run}`, shiftId, supplierId, userId],
    );
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  const insertPayout = (code: string, intake: string | null) =>
    ds.query(
      `INSERT INTO payouts (code, shift_id, supplier_id, amount, paid_by_user_id, intake_id)
       VALUES ($1, $2, $3, '500.00', $4, $5) RETURNING id, intake_id`,
      [code, shiftId, supplierId, userId, intake],
    );

  it('accepts NULL — a standalone «Видати без ягоди»', async () => {
    const [row] = await insertPayout(`P-PO-${run}-1`, null);
    expect(row.intake_id).toBeNull();
  });

  it('stores the intake the cash was handed over with', async () => {
    const [row] = await insertPayout(`P-PO-${run}-2`, intakeId);
    expect(row.intake_id).toBe(intakeId);
  });

  it('refuses an intake that does not exist (FK)', async () => {
    await expect(insertPayout(`P-PO-${run}-3`, randomUUID())).rejects.toMatchObject({
      code: '23503',
    });
  });

  it('RESTRICTs deleting an intake a payout points at', async () => {
    await expect(ds.query(`DELETE FROM intakes WHERE id = $1`, [intakeId])).rejects.toMatchObject(
      { code: '23503' },
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config jest.db.config.js src/migrations/payout-intake-link-schema.db-spec.ts`
Expected: FAIL — `column "intake_id" of relation "payouts" does not exist`.

- [ ] **Step 3: Write the migration**

```ts
// backend/src/migrations/1788600000017-PayoutIntakeLink.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * §2.1 step ⑥ and §3.1 — the cash handed over IN THE SAME VISIT as the receipt.
 * Spec 2026-09-21 §2.2.
 *
 * NOT AN ALLOCATION. The correction to §3.3 cancelled «яку саме дату закриває
 * виплата»: a supplier's debt is one number, and this column does not say
 * which receipt a payout settles. It says with which visit the cash left the
 * drawer, so the printed receipt can carry «Видано готівкою» (#116) and the
 * day's list can show «залишок» beside the receipt it was created on.
 *
 * NULLABLE because §3.7's «Видати без ягоди» is a payout with no visit:
 * a person who came for money and brought nothing.
 *
 * RESTRICT, not CASCADE: nothing deletes a document (§9.3), and a payout must
 * never lose its signature because someone tried.
 */
export class PayoutIntakeLink1788600000017 implements MigrationInterface {
  name = 'PayoutIntakeLink1788600000017';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "payouts" ADD COLUMN "intake_id" uuid`);
    await queryRunner.query(`
      ALTER TABLE "payouts"
        ADD CONSTRAINT "FK_payouts_intake" FOREIGN KEY ("intake_id")
          REFERENCES "intakes"("id") ON DELETE RESTRICT
    `);
    // Partial: the receipt read looks up payouts BY intake, and a standalone
    // payout has nothing to be looked up by.
    await queryRunner.query(
      `CREATE INDEX "IDX_payouts_intake" ON "payouts" ("intake_id") WHERE "intake_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_payouts_intake"`);
    await queryRunner.query(`ALTER TABLE "payouts" DROP CONSTRAINT "FK_payouts_intake"`);
    await queryRunner.query(`ALTER TABLE "payouts" DROP COLUMN "intake_id"`);
  }
}
```

- [ ] **Step 4: Add the column to the entity and the mapper**

In `backend/src/payouts/payout.entity.ts`, add the import and the column after the `supplier` relation:

```ts
import { Intake } from '../intakes/intake.entity';
// …
  /**
   * The receipt this cash was handed over with (§2.1 ⑥), or NULL for a
   * standalone «Видати без ягоди». A SIGNATURE, not an allocation — the
   * correction to §3.3 cancelled «яку дату закриває виплата», and this column
   * never says which debt the money settled. See migration …0017.
   */
  @Column({ type: 'uuid', nullable: true })
  intake_id: string | null;

  @ManyToOne(() => Intake, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'intake_id' })
  intake?: Intake | null;
```

Also add to the class decorators: `@Index('IDX_payouts_intake', ['intake_id'], { where: '"intake_id" IS NOT NULL' })`.

In `backend/src/payouts/payout.mapper.ts`, add `intake_id: string | null;` to `PayoutResponse` (after `supplier_id`) and `intake_id: payout.intake_id,` to `toPayoutResponse`.

- [ ] **Step 5: Update the DBML**

In `28-db-schema.dbml`, inside `Table payouts {`, after `supplier_id uuid [not null, ref: > suppliers.id]`:

```
  // Квитанція, разом з якою видали гроші (§2.1 крок ⑥, §3.1). NULL — «Видати
  // без ягоди» (§3.7). Це ПІДПИС, а не рознесення боргу: правка до §3.3 скасувала
  // «яку саме дату закриває виплата», і ця колонка не каже, який борг погашено.
  // Вона потрібна чекові («Видано готівкою», #116) і списку дня («залишок» біля
  // квитанції). Додано 2026-09-21.
  intake_id uuid [ref: > intakes.id]
```

and in that table's `indexes { … }` block add `(intake_id)`.

- [ ] **Step 6: Run the schema spec and the whole db suite**

Run: `cd backend && npm run test:db`
Expected: PASS, including the new file. (`npm run test:db` replays every migration into a fresh `app_test` — a wrong `down()` shows up here.)

- [ ] **Step 7: Commit**

```bash
git add backend/src/migrations/1788600000017-PayoutIntakeLink.ts backend/src/migrations/payout-intake-link-schema.db-spec.ts backend/src/payouts/payout.entity.ts backend/src/payouts/payout.mapper.ts 28-db-schema.dbml
git commit -m "feat(payouts): intake_id — the receipt a payout was handed over with

Nullable FK, RESTRICT, partial index. A signature for the printed receipt
(#116) and the day's list, not a debt allocation: the correction to §3.3
cancelled «яку дату закриває виплата». Spec 2026-09-21 §2.2.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `CreateIntakeDto.paid_amount`

**Files:**
- Modify: `backend/src/intakes/dto/create-intake.dto.ts` (class `CreateIntakeDto`)
- Create: `backend/src/intakes/dto/create-intake.dto.spec.ts`

**Interfaces:**
- Produces: `CreateIntakeDto.paid_amount?: string` — canonical `'1234.50'` or `undefined`. `PreviewIntakeDto` is the same class; a preview ignores the field.

- [ ] **Step 1: Write the failing DTO spec**

```ts
// backend/src/intakes/dto/create-intake.dto.spec.ts
import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateIntakeDto } from './create-intake.dto';

// Real UUIDs: `@IsUUID()` rejects a hand-written `4444…` (its variant nibble is not 8/9/a/b).
const GRADE = randomUUID();
const CRATE = randomUUID();
const SUPPLIER = randomUUID();

const body = (over: Record<string, unknown> = {}) => ({
  supplier_id: SUPPLIER,
  items: [{ product_grade_id: GRADE, gross_kg: '42.00', tare: [{ tare_type_id: CRATE, units: 3 }] }],
  ...over,
});

/** The pipe's order: transform first, then validate. */
async function check(plain: Record<string, unknown>) {
  const dto = plainToInstance(CreateIntakeDto, plain);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  return { dto, errors };
}

describe('CreateIntakeDto.paid_amount', () => {
  it('is optional — an omitted field validates and stays undefined', async () => {
    const { dto, errors } = await check(body());
    expect(errors).toHaveLength(0);
    expect(dto.paid_amount).toBeUndefined();
  });

  it('canonicalises to two decimals, like every other money field', async () => {
    const { dto, errors } = await check(body({ paid_amount: '500' }));
    expect(errors).toHaveLength(0);
    expect(dto.paid_amount).toBe('500.00');
  });

  it('refuses a comma, a sign and a third decimal', async () => {
    for (const bad of ['12,50', '-1.00', '1.234']) {
      const { errors } = await check(body({ paid_amount: bad }));
      expect(errors.map((e) => e.property)).toEqual(['paid_amount']);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest src/intakes/dto/create-intake.dto.spec.ts`
Expected: FAIL — the second and third tests (`paid_amount` is stripped by `whitelist` today, so `dto.paid_amount` is `undefined` and no error names it).

- [ ] **Step 3: Add the field**

In `backend/src/intakes/dto/create-intake.dto.ts`, after `items` in `CreateIntakeDto`:

```ts
  /**
   * §2.1 step ⑥ and §3.1 — «Видано готівкою», the cash handed over in THIS
   * visit, written as a payout in the same transaction as the receipt (spec
   * 2026-09-21 §2.1). Absent or `0.00` writes no payout document at all:
   * §3.7's «видано 0,00 ₴» is an intake with no payout, not a payout of zero
   * (spec §8.6).
   *
   * UNSIGNED, and the ceiling is not checked here: `min(Разом, каса за ягоду)`
   * (§3.6) needs the debt and the drawer, which only the service can read,
   * under a lock. `PreviewIntakeDto` is this same class and simply ignores it.
   */
  @IsOptional()
  @Matches(/^\d{1,10}(\.\d{1,2})?$/, {
    message: 'paid_amount must be a decimal string with at most 2 decimal places',
  })
  @CanonicalDecimal()
  paid_amount?: string;
```

- [ ] **Step 4: Run the spec to verify it passes**

Run: `cd backend && npx jest src/intakes/dto/create-intake.dto.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/intakes/dto/create-intake.dto.ts backend/src/intakes/dto/create-intake.dto.spec.ts
git commit -m "feat(intakes): accept paid_amount on POST /intakes (§2.1 ⑥, §3.1)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `PayoutsService.writePayout` — one writer, both ceilings

**Files:**
- Modify: `backend/src/payouts/payouts.service.ts` (`create`, new `writePayout`)
- Modify: `backend/src/payouts/payouts.module.ts` (import `PointCashModule`)
- Modify: `backend/src/payouts/payouts.service.spec.ts` (harness + new tests)

**Interfaces:**
- Produces:

```ts
export interface WritePayoutInput {
  actor: AuthenticatedUser;
  pointId: string;
  pointCode: string;
  supplierId: string;
  /** Canonical decimal string, already known to be > 0. */
  amount: string;
  /** The receipt this cash goes with (§2.1 ⑥), or null for «Видати без ягоди». */
  intakeId: string | null;
}
// on PayoutsService:
writePayout(m: EntityManager, input: WritePayoutInput): Promise<{ payout: Payout; shift: Shift }>
```
  Throws `ConflictException NO_OPEN_SHIFT`, `BadRequestException PAYOUT_EXCEEDS_DEBT` / `PAYOUT_EXCEEDS_CASH`, `ConflictException PAYOUT_CODE_TAKEN`. Takes the supplier `FOR UPDATE` lock itself.

- [ ] **Step 1: Extend the spec harness and write the failing tests**

In `backend/src/payouts/payouts.service.spec.ts`:

1. Add to the `let` block: `let pointCash: { cashFor: jest.Mock };`
2. In `beforeEach`, after `audit = …`: `pointCash = { cashFor: jest.fn().mockResolvedValue('10000.00') };` and pass it as the LAST constructor argument: `service = new PayoutsService(repo as never, dataSource as never, shifts as never, suppliers as never, balance as never, points as never, audit as never, pointCash as never);`
3. Add a `describe('the cash half of §3.6', …)` block:

```ts
  describe('the cash half of §3.6', () => {
    it('refuses a payout above the cash for berries, NAMING the code', async () => {
      // Debt admits 380, the drawer holds 300: min(Разом, каса) = 300.
      pointCash.cashFor.mockResolvedValue('300.00');
      await expect(service.create(oksana, dto({ amount: '380.00' }))).rejects.toMatchObject({
        response: { code: 'PAYOUT_EXCEEDS_CASH' },
      });
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('allows a payout equal to the cash', async () => {
      pointCash.cashFor.mockResolvedValue('380.00');
      await expect(service.create(oksana, dto({ amount: '380.00' }))).resolves.toMatchObject({
        amount: '380.00',
      });
    });

    it('reads the cash INSIDE the transaction, after the debt, under the supplier lock', async () => {
      pointCash.cashFor.mockResolvedValue('380.00');
      await service.create(oksana, dto());
      const lockCall = manager.query.mock.invocationCallOrder[0];
      const debtCall = balance.debtFor.mock.invocationCallOrder[0];
      const cashCall = pointCash.cashFor.mock.invocationCallOrder[0];
      expect(lockCall).toBeLessThan(debtCall);
      expect(debtCall).toBeLessThan(cashCall);
      expect(pointCash.cashFor).toHaveBeenCalledWith(POINT_A, undefined, manager);
    });

    it('a negative drawer admits nothing — the reception still proceeds without a payout', async () => {
      pointCash.cashFor.mockResolvedValue('-51130.18');
      await expect(service.create(oksana, dto({ amount: '1.00' }))).rejects.toMatchObject({
        response: { code: 'PAYOUT_EXCEEDS_CASH' },
      });
    });
  });

  describe('writePayout (the shared writer)', () => {
    it('stamps intake_id when handed one, and leaves it null otherwise', async () => {
      const INTAKE = '88888888-8888-8888-8888-888888888888';
      await dataSource.transaction(async (m: never) => {
        await service.writePayout(m, {
          actor: oksana,
          pointId: POINT_A,
          pointCode: 'KPG',
          supplierId: SUPPLIER,
          amount: '380.00',
          intakeId: INTAKE,
        });
      });
      expect(manager.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ intake_id: INTAKE, amount: '380.00', paid_by_user_id: 'u-oksana' }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'payout.created',
          after: expect.objectContaining({ intake_id: INTAKE }),
        }),
        manager,
      );
    });
  });
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `cd backend && npx jest src/payouts/payouts.service.spec.ts`
Expected: FAIL — `service.writePayout is not a function`, and the cash tests resolve instead of rejecting.

- [ ] **Step 3: Implement `writePayout` and route `create` through it**

In `backend/src/payouts/payouts.module.ts` add `import { PointCashModule } from '../point-cash/point-cash.module';` and `PointCashModule,` to `imports`. Update the header comment: «Imports `PointCashModule` for the cash half of §3.6 (2026-09-21): the drawer formula lives in exactly one place too.»

In `backend/src/payouts/payouts.service.ts`:

```ts
import { PointCashService } from '../point-cash/point-cash.service';
import type { CollectionPoint } from '../collection-points/collection-point.entity';

export interface WritePayoutInput {
  actor: AuthenticatedUser;
  pointId: string;
  pointCode: string;
  supplierId: string;
  /** Canonical decimal string, already known to be > 0. */
  amount: string;
  /** The receipt this cash goes with (§2.1 ⑥), or null for «Видати без ягоди». */
  intakeId: string | null;
}
```

Constructor: add `private readonly pointCash: PointCashService,` as the last parameter.

Replace the doc comment above `create` and its transaction body:

```ts
  /**
   * §3.6 IN FULL, since 2026-09-21. The ceiling is `min(Разом, каса за ягоду)`;
   * for years the cash half was unreachable because `transfers`, `cash_counts`
   * and the crate books did not exist. They do now, `PointCashService.cashFor`
   * reads the drawer inside a caller's transaction, and `writePayout` below is
   * the ONE place both halves are enforced — for this route and for a payout
   * written with a receipt (`IntakesService.create`).
   */
  async create(actor: AuthenticatedUser, dto: CreatePayoutDto): Promise<PayoutResponse> {
    const pointId = resolveWritePoint(actor, dto.collection_point_id);

    // (keep the existing zero check, point load, supplier checks verbatim)

    return this.dataSource.transaction(async (m) => {
      const { payout, shift } = await this.writePayout(m, {
        actor,
        pointId,
        pointCode: point.code,
        supplierId: supplier.id,
        amount: dto.amount,
        intakeId: null,
      });
      return toPayoutResponse(payout, shift);
    });
  }

  /**
   * THE payout writer. Called inside the caller's transaction by `create`
   * (standalone) and by `IntakesService.create` (cash handed over with the
   * receipt, §2.1 ⑥), so the two ceilings and the numbering have exactly one
   * implementation.
   *
   * LOCK ORDER IS THE CONTRACT: supplier row → open shift → debt → cash →
   * `nextDocumentCode`'s advisory lock → insert. The reception path holds the
   * `intakes` advisory lock BEFORE calling this and never after, so the two
   * paths cannot form a cycle. (See the comment that used to sit on `create`
   * for why the supplier row is a mutex and why SERIALIZABLE was rejected.)
   */
  async writePayout(
    m: EntityManager,
    { actor, pointId, pointCode, supplierId, amount, intakeId }: WritePayoutInput,
  ): Promise<{ payout: Payout; shift: Shift }> {
    await m.query('SELECT id FROM suppliers WHERE id = $1 FOR UPDATE', [supplierId]);

    const shift = await this.shifts.findOpenAtPoint(pointId, m);
    if (!shift) {
      throw new ConflictException({
        message: 'No open shift at this point — open one first',
        code: 'NO_OPEN_SHIFT',
      });
    }

    // Read INSIDE the transaction, under the lock taken above — otherwise the
    // value checked is not the value that was locked. When the caller has
    // just inserted an intake in this same transaction, this debt already
    // includes it: that is how «Разом» (§3.1) reaches the ceiling.
    const debt = await this.balance.debtFor(supplierId, m);
    if (gt(amount, debt)) {
      throw new BadRequestException({
        message: `Payout of ${amount} exceeds the supplier's balance of ${debt}`,
        code: 'PAYOUT_EXCEEDS_DEBT',
      });
    }

    // The other half of §3.6: «у поле підставляється 1 616,10 ₴, а не 5 497,37».
    // A negative drawer (reachable — the owner may lower a target after the
    // fact) admits nothing, and that is correct: the berries are taken, the
    // money lands in the supplier's balance, and a transfer restores the cash.
    const cash = await this.pointCash.cashFor(pointId, undefined, m);
    if (gt(amount, cash)) {
      throw new BadRequestException({
        message: `Payout of ${amount} exceeds the cash for berries at this point (${cash})`,
        code: 'PAYOUT_EXCEEDS_CASH',
      });
    }

    const code = await nextDocumentCode(m, {
      pointCode,
      businessDate: shift.business_date,
      kind: 'PO',
      shiftId: shift.id,
      table: 'payouts',
    });

    try {
      const payout = await m.save(
        Payout,
        m.create(Payout, {
          code,
          shift_id: shift.id,
          supplier_id: supplierId,
          amount,
          paid_by_user_id: actor.sub,
          intake_id: intakeId,
        }),
      );

      await this.audit.record(
        {
          action: 'payout.created',
          actor_id: actor.sub,
          target_type: 'payout',
          target_id: payout.id,
          after: { code, amount, supplier_id: supplierId, intake_id: intakeId },
        },
        m,
      );

      return { payout, shift };
    } catch (error) {
      throw this.translateDuplicateCode(error, code);
    }
  }
```

Delete the old inline lock/shift/debt/code/save/audit block from `create` — it is now `writePayout`. Keep `translateDuplicateCode` as is. Remove the `CollectionPoint` import if unused.

- [ ] **Step 4: Run the payouts specs**

Run: `cd backend && npx jest src/payouts`
Expected: PASS — every pre-existing test plus the six new ones.

- [ ] **Step 5: Commit**

```bash
git add backend/src/payouts/payouts.service.ts backend/src/payouts/payouts.module.ts backend/src/payouts/payouts.service.spec.ts
git commit -m "feat(payouts): enforce the cash half of §3.6, through one shared writer

writePayout(manager, …) locks the supplier, resolves the shift, checks the
debt AND the drawer (PointCashService.cashFor, inside the transaction),
numbers and writes. POST /payouts calls it; the reception path will too.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Paid at reception — `IntakesService.create` writes the payout in the same transaction

**Files:**
- Modify: `backend/src/intakes/intakes.service.ts` (constructor, `create`)
- Modify: `backend/src/intakes/intakes.module.ts` (import `PayoutsModule`)
- Modify: `backend/src/intakes/intake.mapper.ts` (detail response gains `payouts`; see Task 5 for the row extras — this task adds only what the create path needs and keeps the mapper compiling for Task 5)
- Modify: `backend/src/intakes/intakes.service.spec.ts`

**Interfaces:**
- Consumes: `PayoutsService.writePayout` (Task 3).
- Produces: `IntakeDetailResponse.payouts: IntakePayoutResponse[]` where

```ts
export interface IntakePayoutResponse {
  id: string;
  code: string;
  amount: string;
  voided_at: string | null;
}
```

- [ ] **Step 1: Write the failing unit tests**

In `backend/src/intakes/intakes.service.spec.ts`:

1. Add `let payouts: { writePayout: jest.Mock };` to the `let` block.
2. In `beforeEach`, after `audit = …`:

```ts
    payouts = {
      writePayout: jest.fn().mockImplementation((_m, input: { amount: string; intakeId: string }) =>
        Promise.resolve({
          payout: {
            id: 'po-1',
            code: 'KPG-PO-20260908-001',
            amount: input.amount,
            intake_id: input.intakeId,
            voided_at: null,
          },
          shift: shift(),
        }),
      ),
    };
```

   and append `payouts as never` as the LAST argument of `new IntakesService(…)`.

3. Add a describe block:

```ts
  describe('paid at reception (§2.1 ⑥, §3.1)', () => {
    it('writes no payout when paid_amount is absent', async () => {
      const res = await service.create(oksana, dto() as never);
      expect(payouts.writePayout).not.toHaveBeenCalled();
      expect(res.payouts).toEqual([]);
    });

    it('writes no payout for 0.00 — «видано 0,00» is an intake with no payout', async () => {
      await service.create(oksana, dto({ paid_amount: '0.00' }) as never);
      expect(payouts.writePayout).not.toHaveBeenCalled();
    });

    it('hands the cash to writePayout AFTER the intake is saved, stamped with its id', async () => {
      const res = await service.create(oksana, dto({ paid_amount: '380.00' }) as never);
      expect(manager.save.mock.invocationCallOrder[0]).toBeLessThan(
        payouts.writePayout.mock.invocationCallOrder[0],
      );
      expect(payouts.writePayout).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({
          actor: oksana,
          pointId: POINT_A,
          pointCode: 'KPG',
          supplierId: SUPPLIER,
          amount: '380.00',
          intakeId: INTAKE_ID,
        }),
      );
      expect(res.payouts).toEqual([
        { id: 'po-1', code: 'KPG-PO-20260908-001', amount: '380.00', voided_at: null },
      ]);
    });

    it('lets a ceiling refusal roll the whole transaction back', async () => {
      payouts.writePayout.mockRejectedValue(new Error('PAYOUT_EXCEEDS_CASH'));
      await expect(service.create(oksana, dto({ paid_amount: '380.00' }) as never)).rejects.toThrow(
        'PAYOUT_EXCEEDS_CASH',
      );
      // The mock `transaction` just runs the callback; the real one rolls back
      // on a throw. What this asserts is that the throw is not swallowed.
    });
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx jest src/intakes/intakes.service.spec.ts`
Expected: FAIL — `res.payouts` is undefined; `writePayout` never called.

- [ ] **Step 3: Implement**

`backend/src/intakes/intakes.module.ts`: add `import { PayoutsModule } from '../payouts/payouts.module';` and `PayoutsModule,` to `imports`. Header comment: «Imports `PayoutsModule` so the cash handed over with a receipt (§2.1 ⑥) is written by the ONE payout writer, ceilings included. `PayoutsModule` does not import this module back.»

`backend/src/intakes/intake.mapper.ts`:

```ts
import type { Payout } from '../payouts/payout.entity';

export interface IntakePayoutResponse {
  id: string;
  code: string;
  amount: string;
  voided_at: string | null;
}

export function toIntakePayoutResponse(payout: Payout): IntakePayoutResponse {
  return {
    id: payout.id,
    code: payout.code,
    amount: payout.amount,
    voided_at: payout.voided_at ? payout.voided_at.toISOString() : null,
  };
}

export interface IntakeDetailResponse extends IntakeResponse {
  items: IntakeItemResponse[];
  /** Payouts handed over WITH this receipt (§2.1 ⑥) — `intake_id` = this id,
   *  voided ones included so the receipt can say a payout was cancelled. */
  payouts: IntakePayoutResponse[];
}

export function toIntakeDetailResponse(
  intake: Intake,
  shift: Shift,
  items: IntakeItem[],
  payouts: Payout[] = [],
): IntakeDetailResponse {
  return {
    ...toIntakeResponse(intake, shift),
    items: [...items].sort((a, b) => a.item_order - b.item_order).map(toIntakeItemResponse),
    payouts: [...payouts]
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
      .map(toIntakePayoutResponse),
  };
}
```

`backend/src/intakes/intakes.service.ts`:

- import `{ PayoutsService } from '../payouts/payouts.service'`, `{ isZero } from '../common/money'`, and `type { Payout } from '../payouts/payout.entity'`;
- constructor: add `private readonly payouts: PayoutsService,` last;
- in `create`, replace the `return toIntakeDetailResponse(intake, shift, intake.items ?? []);` line (inside the try) with:

```ts
        // §2.1 ⑥ — the cash for THIS visit leaves the drawer in the same
        // transaction as the receipt. The debt `writePayout` checks already
        // includes the intake saved above (same transaction), so «Разом» is
        // the ceiling as §3.1 defines it. A refusal throws, and the intake is
        // rolled back with it: a receipt without its «видано» would not match
        // the paper in the supplier's hand.
        const paid: Payout[] = [];
        if (dto.paid_amount !== undefined && !isZero(dto.paid_amount)) {
          const { payout } = await this.payouts.writePayout(m, {
            actor,
            pointId,
            pointCode: point.code,
            supplierId: supplier.id,
            amount: dto.paid_amount,
            intakeId: intake.id,
          });
          paid.push(payout);
        }

        return toIntakeDetailResponse(intake, shift, intake.items ?? [], paid);
```

  and update the `create` doc comment: add a paragraph «Since 2026-09-21 the same transaction may also write the payout handed over with the receipt (`paid_amount`, §2.1 ⑥) — see `PayoutsService.writePayout`, which owns both ceilings.»

- in `findOne`, load the linked payouts and pass them:

```ts
    const payouts = await this.repo.manager.find(Payout, {
      where: { intake_id: intake.id },
      order: { created_at: 'ASC' },
    });

    return toIntakeDetailResponse(intake, shift, items, payouts);
```

  (`Payout` must be a value import here, not `import type`.)

- [ ] **Step 4: Run the intakes specs**

Run: `cd backend && npx jest src/intakes`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/intakes/intakes.service.ts backend/src/intakes/intakes.module.ts backend/src/intakes/intake.mapper.ts backend/src/intakes/intakes.service.spec.ts
git commit -m "feat(intakes): pay out at reception — one transaction, two documents (§2.1 ⑥, §3.1)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The list and detail reads carry what a row needs

**Files:**
- Create: `backend/src/intakes/intake-row-extras.ts`
- Create: `backend/src/intakes/intake-row-extras.spec.ts`
- Modify: `backend/src/intakes/intake.mapper.ts` (`IntakeResponse`, `toIntakeResponse`, `toIntakeDetailResponse`)
- Modify: `backend/src/intakes/intakes.service.ts` (`list`, `findOne`, `create`, `void`)
- Modify: `backend/src/intakes/intakes.service.spec.ts` (the `list` and `void` tests' query-builder / manager mocks)

**Interfaces:**
- Produces on every `IntakeResponse` (list rows, detail, void response):

```ts
  /** Σ items.net_kg — the receipt's weight, so a list row can show kilograms (programme §6's first shared read). */
  net_kg: string;
  lines_count: number;
  /** «first last», trimmed, present even for a deactivated supplier. */
  supplier_name: string;
  /** Σ live payouts with intake_id = this id, '0.00' when none. */
  paid_amount: string;
```
  and on the detail additionally `received_by_name: string | null`.

- [ ] **Step 1: Write the failing spec for the SQL fragments' contract**

```ts
// backend/src/intakes/intake-row-extras.spec.ts
import { ROW_EXTRAS_SQL, rowExtrasSelects, type IntakeRowExtras } from './intake-row-extras';

describe('intake row extras SQL', () => {
  it('names the four columns every consumer maps by', () => {
    const selects = rowExtrasSelects('i', 'sup');
    expect(selects.map((s) => s.alias)).toEqual([
      'net_kg',
      'lines_count',
      'paid_amount',
      'supplier_name',
    ]);
    // Every numeric leaves Postgres as text — never a JS number (§5.1).
    expect(selects.find((s) => s.alias === 'net_kg')?.sql).toContain('::text');
    expect(selects.find((s) => s.alias === 'paid_amount')?.sql).toContain('::text');
    expect(selects.find((s) => s.alias === 'paid_amount')?.sql).toContain('voided_at IS NULL');
  });

  it('the one-row query selects the same aliases', () => {
    for (const alias of ['net_kg', 'lines_count', 'paid_amount', 'supplier_name']) {
      expect(ROW_EXTRAS_SQL).toContain(`AS ${alias}`);
    }
    const shape: IntakeRowExtras = {
      net_kg: '36.90',
      lines_count: 2,
      supplier_name: 'Іван Коваль',
      paid_amount: '0.00',
    };
    expect(shape.lines_count).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx jest src/intakes/intake-row-extras.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the fragments module**

```ts
// backend/src/intakes/intake-row-extras.ts
/**
 * The four columns a list row carries beyond the `intakes` table itself
 * (spec 2026-09-21 §2.4 — the programme's first shared read). Computed IN
 * POSTGRES so no kilogram or kopiyka passes through JavaScript on its way to
 * the page, and defined ONCE: `list` adds them as selects on its query
 * builder, every single-document path (`findOne`, `create`, `void`) reads
 * them through `ROW_EXTRAS_SQL`. Two definitions of «paid_amount» would drift
 * on the first `voided_at` filter somebody forgot.
 */
export interface IntakeRowExtras {
  net_kg: string;
  lines_count: number;
  supplier_name: string;
  paid_amount: string;
}

/** `alias` is the intakes alias, `supplierAlias` the joined suppliers row. */
export function rowExtrasSelects(
  alias: string,
  supplierAlias: string,
): ReadonlyArray<{ sql: string; alias: keyof IntakeRowExtras }> {
  return [
    {
      sql: `(SELECT COALESCE(SUM(ii.net_kg), 0)::text FROM intake_items ii WHERE ii.intake_id = ${alias}.id)`,
      alias: 'net_kg',
    },
    {
      sql: `(SELECT COUNT(ii.id)::int FROM intake_items ii WHERE ii.intake_id = ${alias}.id)`,
      alias: 'lines_count',
    },
    {
      // Live payouts only: a voided payout was never really paid (the DEBT
      // reading of `voided_at`, same as `supplier-balance`).
      sql: `(SELECT COALESCE(SUM(p.amount), 0)::text FROM payouts p WHERE p.intake_id = ${alias}.id AND p.voided_at IS NULL)`,
      alias: 'paid_amount',
    },
    {
      sql: `btrim(${supplierAlias}.first_name || ' ' || ${supplierAlias}.last_name)`,
      alias: 'supplier_name',
    },
  ];
}

/** One document's extras, by id — `$1` is the intake id. */
export const ROW_EXTRAS_SQL = `
  SELECT
    ${rowExtrasSelects('i', 's')
      .map((s) => `${s.sql} AS ${s.alias}`)
      .join(',\n    ')}
  FROM intakes i
  JOIN suppliers s ON s.id = i.supplier_id
  WHERE i.id = $1`;
```

- [ ] **Step 4: Thread the extras through the mapper**

In `backend/src/intakes/intake.mapper.ts`:

```ts
import type { IntakeRowExtras } from './intake-row-extras';

export interface IntakeResponse {
  // …existing fields…
  /** Σ items.net_kg — kilograms on the list row (programme §6). */
  net_kg: string;
  lines_count: number;
  /** «first last», trimmed; present even for a deactivated supplier. */
  supplier_name: string;
  /** Σ live payouts handed over with this receipt (`payouts.intake_id`); '0.00' when none. */
  paid_amount: string;
}

export function toIntakeResponse(intake: Intake, shift: Shift, extras: IntakeRowExtras): IntakeResponse {
  return {
    // …existing fields…
    net_kg: extras.net_kg,
    lines_count: extras.lines_count,
    supplier_name: extras.supplier_name,
    paid_amount: extras.paid_amount,
  };
}

export interface IntakeDetailResponse extends IntakeResponse {
  items: IntakeItemResponse[];
  payouts: IntakePayoutResponse[];
  /** «Приймав» on the printed receipt. `null` only if the user row is gone. */
  received_by_name: string | null;
}

export function toIntakeDetailResponse(
  intake: Intake,
  shift: Shift,
  items: IntakeItem[],
  extras: IntakeRowExtras,
  payouts: Payout[],
  receivedByName: string | null,
): IntakeDetailResponse {
  return {
    ...toIntakeResponse(intake, shift, extras),
    items: /* as before */,
    payouts: /* as before */,
    received_by_name: receivedByName,
  };
}
```

- [ ] **Step 5: Read the extras in every service path**

In `backend/src/intakes/intakes.service.ts`:

```ts
import { Supplier } from '../suppliers/supplier.entity';
import { User } from '../users/user.entity';
import { displayNameOf } from '../users/display-name';
import { ROW_EXTRAS_SQL, rowExtrasSelects, type IntakeRowExtras } from './intake-row-extras';

  /** The four derived columns for ONE document, read by id — `findOne`,
   *  `create` (after the insert, so `paid_amount` sees the payout it just
   *  wrote) and `void` all go through here. */
  private async extrasFor(intakeId: string, m: EntityManager): Promise<IntakeRowExtras> {
    const [row] = (await m.query(ROW_EXTRAS_SQL, [intakeId])) as IntakeRowExtras[];
    return row;
  }

  private async nameOf(userId: string, m: EntityManager): Promise<string | null> {
    const user = await m.findOne(User, { where: { id: userId } });
    return user ? displayNameOf(user) : null;
  }
```

- `create`: replace the final `return toIntakeDetailResponse(intake, shift, intake.items ?? [], paid);` with

```ts
        return toIntakeDetailResponse(
          intake,
          shift,
          intake.items ?? [],
          await this.extrasFor(intake.id, m),
          paid,
          await this.nameOf(actor.sub, m),
        );
```

- `void`: `return toIntakeResponse(saved, shift, await this.extrasFor(saved.id, m));`
- `findOne`: `const m = this.repo.manager;` then `return toIntakeDetailResponse(intake, shift, items, await this.extrasFor(intake.id, m), payouts, await this.nameOf(intake.received_by_user_id, m));`
- `list`: replace from `const qb = …` to the return with:

```ts
    const qb = this.repo
      .createQueryBuilder('i')
      .innerJoinAndMapOne('i.shift', Shift, 's', 's.id = i.shift_id')
      .innerJoin(Supplier, 'sup', 'sup.id = i.supplier_id');
    for (const { sql, alias } of rowExtrasSelects('i', 'sup')) qb.addSelect(sql, alias);

    if (pointId) qb.andWhere('s.collection_point_id = :pointId', { pointId });
    // …the other five filters unchanged…

    qb.orderBy('i.created_at', 'DESC').addOrderBy('i.id', 'ASC').skip(skipOf(query)).take(query.limit);

    // `getManyAndCount` cannot carry raw selects; `getRawAndEntities` keeps
    // `raw[n]` aligned with `entities[n]` (one row per intake — both joins are
    // to-one), and the count runs over the same filtered builder.
    const [{ entities, raw }, total] = await Promise.all([qb.getRawAndEntities(), qb.getCount()]);

    return {
      data: entities.map((i, n) =>
        toIntakeResponse(i, i.shift as Shift, {
          net_kg: raw[n].net_kg,
          lines_count: raw[n].lines_count,
          supplier_name: raw[n].supplier_name,
          paid_amount: raw[n].paid_amount,
        }),
      ),
      total,
      page: query.page,
      limit: query.limit,
    };
```

  Note: with `skip`/`take` on a builder that has `innerJoinAndMapOne`, TypeORM may emit a two-step query; `getRawAndEntities` still returns aligned arrays. The db-spec in Task 6 proves the values.

- [ ] **Step 6: Fix the unit specs' mocks**

In `backend/src/intakes/intakes.service.spec.ts`:

- `manager.query` must answer `ROW_EXTRAS_SQL`: change the mock to
  `query: jest.fn().mockImplementation((sql: string) => Promise.resolve(sql.includes('count(*)') ? [{ n: 2 }] : sql.includes('AS net_kg') ? [{ net_kg: '36.90', lines_count: 2, supplier_name: 'Іван Коваль', paid_amount: '0.00' }] : []))` (mirror the existing `count(*)` branch exactly as it is written today).
- `manager.findOne` for the `User` lookup: make it return `{ first_name: 'Оксана', last_name: 'Гнатюк' }` when called with `User` — simplest: `findOne: jest.fn().mockImplementation((entity: { name?: string }) => Promise.resolve(entity?.name === 'User' ? { first_name: 'Оксана', last_name: 'Гнатюк' } : null))`. Existing `void` tests that set `manager.findOne.mockResolvedValue(intake())` keep working because they override.
- the `list` tests: replace the query-builder mock's `getManyAndCount` with `getRawAndEntities: jest.fn().mockResolvedValue({ entities: [ …same rows… ], raw: [{ net_kg: '36.90', lines_count: 2, supplier_name: 'Іван Коваль', paid_amount: '0.00' }] })` and `getCount: jest.fn().mockResolvedValue(1)`, and add `innerJoin: jest.fn().mockReturnThis()` and `addSelect: jest.fn().mockReturnThis()` to the chain. Assert the mapped row carries `net_kg: '36.90'` and `paid_amount: '0.00'`.
- `plainManager` (used by `findOne` through `this.repo.manager`): give it `query` and `findOne` and `find` mocks with the same behaviour as `manager`'s.
- Add one test: `it('names the receiver on the detail', …)` — `findOne` returns `received_by_name: 'Оксана Гнатюк'`.

- [ ] **Step 7: Run the intakes specs**

Run: `cd backend && npx jest src/intakes`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/src/intakes
git commit -m "feat(intakes): net_kg, lines_count, supplier_name, paid_amount on every row; receiver name on the receipt

One SQL definition (intake-row-extras.ts) for the list's selects and the
single-document read. Programme §6's first shared read.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Prove it over HTTP against Postgres

**Files:**
- Create: `backend/src/intakes/intake-paid-at-reception.db-spec.ts`

**Interfaces:** consumes everything above through the real routes.

- [ ] **Step 1: Write the spec**

Copy the boot block of `backend/src/testing/documents-pipeline.db-spec.ts` (imports, `pointCode()`, `beforeAll` up to and including the operator creation, `afterAll`) into the new file, then the tests. Two points: A with a small drawer (the cash ceiling), B with a large one (the debt ceiling).

```ts
// backend/src/intakes/intake-paid-at-reception.db-spec.ts
// (imports and the boot block exactly as in testing/documents-pipeline.db-spec.ts,
//  except: create TWO operators, `oksanaToken` at point A and `bohdanToken` at point B)

describe('paid at reception (HTTP, Postgres)', () => {
  let gradeId: string;
  let crateId: string;

  beforeAll(async () => {
    // catalog — same bodies as the pipeline spec: product, grade, crate tare
    // type (names carry a per-run uuid), then a price at EACH point:
    //   base_price '100.00', max_markup '30.00', max_discount '20.00'
    // A crate of 1.20 kg and gross 11.20 kg make a 10.00 kg line = 1000.00 ₴.
  }, 30_000);

  const line = () => ({
    product_grade_id: gradeId,
    gross_kg: '11.20',
    tare: [{ tare_type_id: crateId, units: 1 }],
  });

  describe('point A — the drawer holds 500.00', () => {
    let supplierId: string;
    let shiftId: string;

    beforeAll(async () => {
      const s = await request(app.getHttpServer())
        .post('/suppliers')
        .set('Authorization', `Bearer ${oksanaToken}`)
        .send({ first_name: 'Ніна', last_name: `Ільчук-${randomUUID()}` })
        .expect(201);
      supplierId = s.body.id;
      const sh = await request(app.getHttpServer())
        .post('/shifts')
        .set('Authorization', `Bearer ${oksanaToken}`)
        .send({ counted_amount: '500.00' })
        .expect(201);
      shiftId = sh.body.id;
    });

    it('refuses 600.00 against 500.00 in the drawer, and writes NO intake', async () => {
      const res = await request(app.getHttpServer())
        .post('/intakes')
        .set('Authorization', `Bearer ${oksanaToken}`)
        .send({ supplier_id: supplierId, items: [line()], paid_amount: '600.00' })
        .expect(400);
      expect(res.body.code).toBe('PAYOUT_EXCEEDS_CASH');

      const journal = await request(app.getHttpServer())
        .get('/intakes')
        .query({ shift_id: shiftId })
        .set('Authorization', `Bearer ${oksanaToken}`)
        .expect(200);
      expect(journal.body.total).toBe(0);
    });

    it('writes the receipt AND the payout together, and the reads carry both', async () => {
      const res = await request(app.getHttpServer())
        .post('/intakes')
        .set('Authorization', `Bearer ${oksanaToken}`)
        .send({ supplier_id: supplierId, items: [line()], paid_amount: '500.00' })
        .expect(201);

      expect(res.body.amount).toBe('1000.00');
      expect(res.body.net_kg).toBe('10.00');
      expect(res.body.lines_count).toBe(1);
      expect(res.body.paid_amount).toBe('500.00');
      expect(res.body.received_by_name).toBe('Оксана Приймальник');
      expect(res.body.supplier_name).toMatch(/^Ніна Ільчук-/);
      expect(res.body.payouts).toHaveLength(1);
      expect(res.body.payouts[0].code).toMatch(/-PO-\d{8}-\d+$/);
      expect(res.body.payouts[0].amount).toBe('500.00');

      const row = await request(app.getHttpServer())
        .get('/intakes')
        .query({ shift_id: shiftId })
        .set('Authorization', `Bearer ${oksanaToken}`)
        .expect(200);
      expect(row.body.data[0]).toMatchObject({
        id: res.body.id,
        net_kg: '10.00',
        lines_count: 1,
        paid_amount: '500.00',
      });

      const payouts = await request(app.getHttpServer())
        .get('/payouts')
        .query({ shift_id: shiftId })
        .set('Authorization', `Bearer ${oksanaToken}`)
        .expect(200);
      expect(payouts.body.data[0].intake_id).toBe(res.body.id);

      const balance = await request(app.getHttpServer())
        .get(`/suppliers/${supplierId}/balance`)
        .set('Authorization', `Bearer ${oksanaToken}`)
        .expect(200);
      expect(balance.body.debt).toBe('500.00');
    });

    it('a standalone payout is capped by the drawer too — it is now empty', async () => {
      const res = await request(app.getHttpServer())
        .post('/payouts')
        .set('Authorization', `Bearer ${oksanaToken}`)
        .send({ supplier_id: supplierId, amount: '100.00' })
        .expect(400);
      expect(res.body.code).toBe('PAYOUT_EXCEEDS_CASH');
    });

    it('a preview ignores paid_amount and writes nothing', async () => {
      await request(app.getHttpServer())
        .post('/intakes/preview')
        .set('Authorization', `Bearer ${oksanaToken}`)
        .send({ supplier_id: supplierId, items: [line()], paid_amount: '999999.00' })
        .expect(200);
    });
  });

  describe('point B — the drawer holds 100000.00', () => {
    let supplierId: string;

    beforeAll(async () => {
      // supplier at B (bohdanToken), shift opened with counted_amount '100000.00'
    });

    it('refuses more than «Разом» — the debt half', async () => {
      const res = await request(app.getHttpServer())
        .post('/intakes')
        .set('Authorization', `Bearer ${bohdanToken}`)
        .send({ supplier_id: supplierId, items: [line()], paid_amount: '1000.01' })
        .expect(400);
      expect(res.body.code).toBe('PAYOUT_EXCEEDS_DEBT');
    });

    it('pays «Разом» in full — the receipt reads «розраховано повністю»', async () => {
      const res = await request(app.getHttpServer())
        .post('/intakes')
        .set('Authorization', `Bearer ${bohdanToken}`)
        .send({ supplier_id: supplierId, items: [line()], paid_amount: '1000.00' })
        .expect(201);
      expect(res.body.paid_amount).toBe('1000.00');
      const balance = await request(app.getHttpServer())
        .get(`/suppliers/${supplierId}/balance`)
        .set('Authorization', `Bearer ${bohdanToken}`)
        .expect(200);
      expect(balance.body.debt).toBe('0.00');
    });

    it('«Разом» includes the previous balance: an unpaid receipt, then a second visit paid above its own amount', async () => {
      await request(app.getHttpServer())
        .post('/intakes')
        .set('Authorization', `Bearer ${bohdanToken}`)
        .send({ supplier_id: supplierId, items: [line()] })
        .expect(201); // debt 1000
      const res = await request(app.getHttpServer())
        .post('/intakes')
        .set('Authorization', `Bearer ${bohdanToken}`)
        .send({ supplier_id: supplierId, items: [line()], paid_amount: '1500.00' })
        .expect(201); // Разом = 2000, paid 1500
      expect(res.body.paid_amount).toBe('1500.00');
      const balance = await request(app.getHttpServer())
        .get(`/suppliers/${supplierId}/balance`)
        .set('Authorization', `Bearer ${bohdanToken}`)
        .expect(200);
      expect(balance.body.debt).toBe('500.00');
    });
  });
});
```

Fill the two `beforeAll` bodies with the pipeline spec's exact request shapes (`/products`, `/product-grades`, `/tare-types` with `is_crate: true`, `/grade-prices` per point, `/suppliers`, `/shifts`).

- [ ] **Step 2: Run it**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config jest.db.config.js src/intakes/intake-paid-at-reception.db-spec.ts`
Expected: PASS (8 tests). If `PAYOUT_EXCEEDS_CASH` comes back where `PAYOUT_EXCEEDS_DEBT` is expected, the drawer at that point is smaller than the fixture assumes — check the `counted_amount`.

- [ ] **Step 3: Run the whole db suite on ONE database** (memory: a partial run can pass falsely)

Run: `cd backend && npm run test:db`
Expected: PASS, every suite.

- [ ] **Step 4: Commit**

```bash
git add backend/src/intakes/intake-paid-at-reception.db-spec.ts
git commit -m "test(intakes): prove paid-at-reception and both §3.6 ceilings over HTTP

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Records of truth and the full verification tier

**Files:**
- Modify: `backend/CLAUDE.md` (`intakes/` and `payouts/` lines in «Structure», the «Key conventions» bullets on documents and codes, the `migrations/` line)
- Modify: `docs/superpowers/specs/2026-09-21-yagoda-reception-parity.md` (mark §2 delivered; note the two receipt rows not derivable — see the frontend plan)

- [ ] **Step 1: Document the read and the writer**

In `backend/CLAUDE.md`:

- `intakes/` line: append «Since 2026-09-21 `POST /intakes` takes an optional `paid_amount` and writes the payout handed over with the receipt IN THE SAME TRANSACTION through `PayoutsService.writePayout` (§2.1 ⑥, §3.1); `GET /intakes` rows carry `net_kg`, `lines_count`, `supplier_name`, `paid_amount` (one SQL definition in `intake-row-extras.ts`, the programme's first shared read), and the detail adds `payouts` and `received_by_name`.»
- `payouts/` line: append «`writePayout(manager, …)` is the ONE writer — supplier lock → open shift → debt → cash (`PointCashService.cashFor`, §3.6's second half, enforced since 2026-09-21) → number → insert; `intake_id` (nullable) says which receipt the cash left with, and is NOT a debt allocation (§3.3 correction).»
- `migrations/` line: append `, PayoutIntakeLink`.
- In «Key conventions», the «A document is never edited» bullet: add a sentence «A payout made at reception carries `intake_id`; voiding the intake does not void it (§3.5's recorded exception) and voiding the payout does not touch the intake.»

- [ ] **Step 2: Run the full tier**

Run: `npm run verify:full` (from the worktree root)
Expected: every row `PASSED` except `test:ci-scripts` (`SKIPPED`, no jq on this machine — say so). Quote the verdict line. If `documents` or `schema` flags the new column, read its message: `schema` models only numeric columns and `intake_id` is uuid; `documents` reads route decorators and none changed.

- [ ] **Step 3: Commit**

```bash
git add backend/CLAUDE.md docs/superpowers/specs/2026-09-21-yagoda-reception-parity.md
git commit -m "docs(intakes): record paid-at-reception, the shared payout writer and the row read

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review against the spec (done while writing)

- §2.1 `paid_amount`, same transaction, both ceilings, lock order → Tasks 2–4, 6.
- §2.2 `payouts.intake_id`, migration, DBML → Task 1.
- §2.3 cash ceiling on `POST /payouts` → Task 3 (+ Task 6 test).
- §2.4 list fields → Task 5 (+ Task 6 assertions).
- §2.5 detail `payouts`, `received_by_name` → Tasks 4, 5.
- §2.6 `POST /intakes` returns the detail → Task 4.
- §2.7 tests: ceiling matrix (Task 3), atomicity + race (Task 6 proves atomicity through the journal count; the race primitive is already `payout-race.db-spec.ts`), migration spec (Task 1), mapper/extras (Task 5). `verify:full` in Task 7.
- Names used consistently: `writePayout`, `WritePayoutInput`, `IntakeRowExtras`, `rowExtrasSelects`, `ROW_EXTRAS_SQL`, `IntakePayoutResponse`, `received_by_name`, `paid_amount`, `intake_id`, `PAYOUT_EXCEEDS_CASH`.

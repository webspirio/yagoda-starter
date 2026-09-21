# Broken Crates at Shift Close — Implementation Plan (#110)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator record how many crates broke during a shift, and expose the three numbers §6.8 prints — «з ягодою», «бій», «відвантажено» — for the close screen.

**Architecture:** One nullable `int` column on `shifts`, written inside the existing close transaction and cleared by the existing reopen transaction. No new table, no new write path, no new audit action. The two derived numbers are computed on read by a new service in `crates/`, which already owns crate counting.

**Tech Stack:** NestJS 11, TypeORM (`synchronize: false`, migrations auto-run at boot), PostgreSQL 16, Jest (`*.spec.ts` mocked, `*.db-spec.ts` against real Postgres), class-validator.

**Spec:** `docs/superpowers/specs/2026-09-18-yagoda-crate-dispatch-slice.md`

## Global Constraints

- **`NULL` and `0` are different facts.** `NULL` is «не записано», `0` is «нічого не побилось». Never coalesce one into the other, anywhere — not in SQL, not in a mapper, not in a DTO default.
- **No new table.** The schema stays at twenty-two tables; `grep -c "^Table " 28-db-schema.dbml` must still print `22` when this is done.
- **`broken_crates` is `int`, not `numeric`.** It is a count of physical objects. `src/common/money.ts` is not involved at any point in this slice.
- **The only arithmetic is `with_berry + broken`**, integer addition. Never introduce `*`, `/`, `Number()` or `toFixed` in any file this plan touches.
- **`SUM()` must be cast `::int`.** `runner.query` returns `any`; an uncast `SUM()` is Postgres `int8`, which node-postgres yields as a **string**, and TypeScript will not catch it landing in a field typed `number`.
- **Close stays operator-only** (`@Auth(UserRole.PointOperator)`, §10.3) and **reopen stays owner-only**. This slice adds no role and changes none.
- **A shift is never voided.** There is no `void_*` trio on `shifts` and this slice does not add one; a correction is reopen + re-close.
- **Verification tier:** this slice carries a migration, so it needs `npm run verify:full` (that is where `test:db` lives), not just `npm run verify`. Per CLAUDE.md, a `SKIPPED` row is spoken aloud and is never reported as a pass.
- **Ratchets turn one way.** If a check goes red, fix the cause. Widening an eslint glob, adding a knip suppression or lowering a coverage floor is not turning green.

---

### Task 1: The column, the migration and its constraints

**Files:**
- Modify: `backend/src/shifts/shift.entity.ts`
- Create: `backend/src/migrations/1788600000016-ShiftBrokenCrates.ts`
- Test: `backend/src/migrations/shift-broken-crates-schema.db-spec.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `Shift.broken_crates: number | null`; the constraints `CHK_shifts_broken_crates_non_negative` and `CHK_shifts_broken_crates_closed`.

- [ ] **Step 1: Write the failing schema test**

Create `backend/src/migrations/shift-broken-crates-schema.db-spec.ts`:

```ts
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';

/**
 * Both CHECKs on `shifts.broken_crates` get a row that would be legal without
 * them. A constraint nobody has watched reject anything is a constraint nobody
 * knows is there.
 */
describe('shifts.broken_crates schema (Postgres)', () => {
  let ds: DataSource;
  let pointId: string;
  let userId: string;
  let day = 0;

  /** A fresh business_date per call — UQ_shifts_point_business_date allows one
   *  shift per point per day, and these tests need several. */
  const insertShift = async (over: Record<string, unknown> = {}) => {
    day += 1;
    const row: Record<string, unknown> = {
      collection_point_id: pointId,
      opened_by_user_id: userId,
      business_date: `2026-01-${String(day).padStart(2, '0')}`,
      status: 'open',
      ...over,
    };
    const keys = Object.keys(row);
    return ds.query(
      `INSERT INTO shifts (${keys.map((k) => `"${k}"`).join(', ')})
       VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      keys.map((k) => row[k]),
    );
  };

  beforeAll(async () => {
    ds = await openTestDataSource();
    const run = randomUUID().slice(0, 8);
    [{ id: pointId }] = await ds.query(
      `INSERT INTO collection_points (name, code, kind, is_active)
       VALUES ($1, $2, 'reception', true) RETURNING id`,
      [`Точка ${run}`, `T${run.slice(0, 6).toUpperCase()}`],
    );
    [{ id: userId }] = await ds.query(
      `INSERT INTO users (first_name, last_name, role, is_active)
       VALUES ('Тест', $1, 'network_owner', true) RETURNING id`,
      [`Owner ${run}`],
    );
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it('defaults to NULL on a newly opened shift', async () => {
    const [{ id }] = await insertShift();
    const [row] = await ds.query('SELECT broken_crates FROM shifts WHERE id = $1', [id]);
    // NULL is «не записано». It is NOT zero, and nothing may default it to zero.
    expect(row.broken_crates).toBeNull();
  });

  it('refuses a negative count', async () => {
    await expect(
      insertShift({
        status: 'closed',
        closed_at: new Date(),
        closed_by_user_id: userId,
        broken_crates: -1,
      }),
    ).rejects.toThrow(/CHK_shifts_broken_crates_non_negative/);
  });

  it('accepts zero on a closed shift — «нуль це нормальне значення»', async () => {
    const [{ id }] = await insertShift({
      status: 'closed',
      closed_at: new Date(),
      closed_by_user_id: userId,
      broken_crates: 0,
    });
    const [row] = await ds.query('SELECT broken_crates FROM shifts WHERE id = $1', [id]);
    expect(row.broken_crates).toBe(0);
  });

  it('refuses a count on an OPEN shift', async () => {
    await expect(insertShift({ broken_crates: 3 })).rejects.toThrow(
      /CHK_shifts_broken_crates_closed/,
    );
  });

  it('allows a closed shift to carry NULL — history predates the column', async () => {
    const [{ id }] = await insertShift({
      status: 'closed',
      closed_at: new Date(),
      closed_by_user_id: userId,
    });
    const [row] = await ds.query('SELECT broken_crates FROM shifts WHERE id = $1', [id]);
    expect(row.broken_crates).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm run test:db -w backend -- shift-broken-crates-schema
```

Expected: FAIL — `column "broken_crates" of relation "shifts" does not exist`.

- [ ] **Step 3: Add the entity field**

In `backend/src/shifts/shift.entity.ts`, add the two `@Check` decorators next to the existing ones on the class:

```ts
// #110 / §6.8 — «бій вписує приймальник руками; нуль — нормальне значення».
@Check('CHK_shifts_broken_crates_non_negative', `"broken_crates" >= 0`)
// ONE-SIDED ON PURPOSE. The symmetrical form —
// ("closed_at" IS NULL) = ("broken_crates" IS NULL) — would force this
// migration to backfill a number onto every already-closed shift, and the only
// available number is 0, which asserts «нічого не побилось» about days nobody
// was asked about. That is the same lie `collection_points.target_crates` is
// nullable to avoid: «нуль стверджував би, що ящиків немає, тоді як ми просто
// не знаємо». The half that IS true forever is «a number never sits on an open
// shift», and it survives both the history and the reopen-to-NULL rule.
@Check('CHK_shifts_broken_crates_closed', `"closed_at" IS NOT NULL OR "broken_crates" IS NULL`)
```

and the column itself, after `explanation`:

```ts
  /**
   * §6.8's «бій» — crates that broke during the shift and travel to the base
   * with the full ones. Written by `ShiftsService.close`, cleared to `null` by
   * `ShiftsService.reopen`, and never touched anywhere else.
   *
   * `null` MEANS «НЕ ЗАПИСАНО», NOT ZERO. An open shift has `null` because the
   * day is not over; a shift closed before this column existed has `null`
   * because nobody was asked. `0` is a positive claim that nothing broke, and
   * `#110` says it is a normal value. Never coalesce one into the other.
   *
   * A re-close OVERWRITES it and the previous value survives only in the
   * `shift.closed` audit entry — accepted, because no rule in §6 asks what the
   * breakage figure was before a correction.
   */
  @Column({ type: 'int', nullable: true })
  broken_crates: number | null;
```

- [ ] **Step 4: Write the migration**

Create `backend/src/migrations/1788600000016-ShiftBrokenCrates.ts`:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ADDS `shifts.broken_crates` — §6.8's «бій», the one fact in issue #110 that
 * no table could hold.
 *
 * NULLABLE WITH NO DEFAULT, AND THAT IS THE WHOLE DESIGN. A `DEFAULT 0` would
 * backfill «нічого не побилось» onto every shift ever closed, including the
 * 150 the dev seed generates, and make «не записано» indistinguishable from a
 * real zero on every one of them. `collection_points.target_crates` is
 * nullable for the identical reason, stated in its own DBML Note.
 *
 * `CHK_shifts_broken_crates_closed` is therefore ONE-SIDED: it forbids a count
 * on an OPEN shift, which is true forever, rather than requiring one on a
 * closed shift, which no pre-existing row can satisfy.
 */
export class ShiftBrokenCrates1788600000016 implements MigrationInterface {
  name = 'ShiftBrokenCrates1788600000016';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "shifts" ADD "broken_crates" integer`);
    await queryRunner.query(
      `ALTER TABLE "shifts" ADD CONSTRAINT "CHK_shifts_broken_crates_non_negative"
         CHECK ("broken_crates" >= 0)`,
    );
    await queryRunner.query(
      `ALTER TABLE "shifts" ADD CONSTRAINT "CHK_shifts_broken_crates_closed"
         CHECK ("closed_at" IS NOT NULL OR "broken_crates" IS NULL)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "shifts" DROP CONSTRAINT "CHK_shifts_broken_crates_closed"`,
    );
    await queryRunner.query(
      `ALTER TABLE "shifts" DROP CONSTRAINT "CHK_shifts_broken_crates_non_negative"`,
    );
    await queryRunner.query(`ALTER TABLE "shifts" DROP COLUMN "broken_crates"`);
  }
}
```

- [ ] **Step 5: Run the test and watch it pass**

```bash
npm run test:db -w backend -- shift-broken-crates-schema
```

Expected: PASS, 5 tests. If `openTestDataSource` cannot connect, start Postgres first: `docker compose up -d postgres redis` from the repo root.

- [ ] **Step 6: Confirm no unintended schema drift**

```bash
cd backend && DB_NAME=app_test npm run migration:generate -- src/migrations/ScratchCheck
```

Read the generated file, `grep -v '"FK_'` it, confirm nothing about `broken_crates` remains (renamed FK constraints are expected noise — see backend/CLAUDE.md), then **delete it**. It must not be committed.

- [ ] **Step 7: Commit**

```bash
git add backend/src/shifts/shift.entity.ts \
        backend/src/migrations/1788600000016-ShiftBrokenCrates.ts \
        backend/src/migrations/shift-broken-crates-schema.db-spec.ts
git commit -m "feat(shifts): add broken_crates, nullable with a one-sided CHECK (#110)"
```

---

### Task 2: Writing it at close, clearing it at reopen

**Files:**
- Modify: `backend/src/shifts/dto/close-shift.dto.ts`
- Modify: `backend/src/shifts/shifts.service.ts` (`close` ~line 185–200, `reopen` ~line 310–316)
- Modify: `backend/src/shifts/shift.mapper.ts`
- Test: `backend/src/shifts/shifts.service.spec.ts` (modify), `backend/src/testing/documents-pipeline.db-spec.ts` (modify)

**Interfaces:**
- Consumes: `Shift.broken_crates: number | null` from Task 1.
- Produces: `CloseShiftDto.broken_crates: number` (required); `ShiftResponse.broken_crates: number | null`.

- [ ] **Step 1: Write the failing DTO + service tests**

Append to `backend/src/shifts/shifts.service.spec.ts` (inside the existing `describe` for the service — reuse the file's established mock setup rather than building a new one):

```ts
  it('stores broken_crates on the closed shift', async () => {
    const saved = await service.close(operator, shiftId, {
      counted_amount: '100.00',
      broken_crates: 3,
    });
    expect(saved.broken_crates).toBe(3);
  });

  it('stores a zero — «нуль це нормальне значення»', async () => {
    const saved = await service.close(operator, shiftId, {
      counted_amount: '100.00',
      broken_crates: 0,
    });
    // Zero is a positive claim that nothing broke. It must survive as 0, not
    // become null, and not be dropped as falsy.
    expect(saved.broken_crates).toBe(0);
  });

  it('clears broken_crates when the owner reopens', async () => {
    await service.close(operator, shiftId, { counted_amount: '100.00', broken_crates: 3 });
    const reopened = await service.reopen(owner, shiftId, { reason: 'помилка' });
    expect(reopened.broken_crates).toBeNull();
  });

  it('records the breakage in the shift.closed audit entry', async () => {
    await service.close(operator, shiftId, { counted_amount: '100.00', broken_crates: 3 });
    // The overwritten value survives ONLY here — see the entity's doc comment.
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'shift.closed',
        after: expect.objectContaining({ broken_crates: 3 }),
      }),
      expect.anything(),
    );
  });
```

Create `backend/src/shifts/dto/close-shift.dto.spec.ts`:

```ts
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CloseShiftDto } from './close-shift.dto';

const validate = (body: Record<string, unknown>) =>
  validateSync(plainToInstance(CloseShiftDto, body)).flatMap((e) => Object.keys(e.constraints ?? {}));

describe('CloseShiftDto.broken_crates', () => {
  const base = { counted_amount: '100.00' };

  it('accepts zero', () => {
    expect(validate({ ...base, broken_crates: 0 })).toEqual([]);
  });

  it('accepts a positive integer', () => {
    expect(validate({ ...base, broken_crates: 3 })).toEqual([]);
  });

  it('rejects a negative count', () => {
    expect(validate({ ...base, broken_crates: -1 })).toContain('min');
  });

  it('rejects a fractional count — crates are whole objects', () => {
    expect(validate({ ...base, broken_crates: 3.5 })).toContain('isInt');
  });

  it('rejects an absent count — a number that can be skipped gets skipped', () => {
    expect(validate(base)).toContain('isInt');
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npm test -w backend -- close-shift.dto shifts.service
```

Expected: FAIL — `broken_crates` is not a property of `CloseShiftDto`, and the service tests fail on `undefined`.

- [ ] **Step 3: Add the DTO field**

In `backend/src/shifts/dto/close-shift.dto.ts`, extend the import to `import { IsInt, Matches, Max, Min } from 'class-validator';` and add:

```ts
  /**
   * §6.8's «бій» — crates that broke during the shift (#110).
   *
   * REQUIRED, not optional, for the reason the cash count is written inside
   * this same transaction rather than beside it: a number that can be skipped
   * gets skipped. ZERO IS A NORMAL VALUE (#110, literally: «нуль — нормальне
   * значення»), so there is no `@IsOptional()` and no default — `null` means
   * «не записано» and is unreachable through this DTO.
   *
   * `@Max` is a typo guard, not a business rule — #110's own example is 3.
   * Same ceiling as `CreateCrateIssuanceDto.units`.
   */
  @IsInt()
  @Min(0)
  @Max(10000)
  broken_crates: number;
```

- [ ] **Step 4: Write it in `close`, clear it in `reopen`**

In `shifts.service.ts`'s `close`, beside the three existing assignments:

```ts
      shift.closed_at = closedAt;
      shift.closed_by_user_id = actor.sub;
      shift.status = ShiftStatus.Closed;
      // §6.8 — «бій вписує приймальник». The ONLY write of this column.
      shift.broken_crates = dto.broken_crates;
      const saved = await m.save(Shift, shift);
```

and extend the `shift.closed` audit entry's `after`:

```ts
          after: { business_date: saved.business_date, broken_crates: saved.broken_crates },
```

In `reopen`, beside the three existing resets:

```ts
      shift.closed_at = null;
      shift.closed_by_user_id = null;
      shift.status = ShiftStatus.Open;
      // Back to «не записано»: CHK_shifts_broken_crates_closed forbids a count
      // on an open shift, and the re-close will ask the operator again.
      shift.broken_crates = null;
      const saved = await m.save(Shift, shift);
```

Extend `reopen`'s `before` and `after` to carry it:

```ts
      const before = {
        closed_at: shift.closed_at,
        status: shift.status,
        broken_crates: shift.broken_crates,
      };
```
```ts
          after: { closed_at: null, status: ShiftStatus.Open, broken_crates: null },
```

- [ ] **Step 5: Expose it on the response**

In `backend/src/shifts/shift.mapper.ts`, add to the `ShiftResponse` interface:

```ts
  /** §6.8's «бій» (#110). `null` means «не записано» — an open shift, or one
   *  closed before the column existed. `0` means nothing broke. */
  broken_crates: number | null;
```

and to `toShiftResponse`'s returned object:

```ts
    broken_crates: shift.broken_crates,
```

- [ ] **Step 6: Run the tests and watch them pass**

```bash
npm test -w backend -- close-shift.dto shifts.service
```

Expected: PASS. Then the full unit suite, which must stay green — every existing `close` call site in a spec now needs the new required field:

```bash
npm test -w backend
```

If a spec fails with a validation error on `broken_crates`, add `broken_crates: 0` to that call — do not make the DTO field optional to silence it.

- [ ] **Step 7: Prove it end to end against Postgres**

Add to `backend/src/testing/documents-pipeline.db-spec.ts`, in the shift-closing section:

```ts
  it('carries the breakage through close, reopen and re-close', async () => {
    await request(app.getHttpServer())
      .post(`/shifts/${shiftId}/close`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ counted_amount: '100.00', broken_crates: 3 })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/shifts/${shiftId}/reopen`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ reason: 'перерахунок' })
      .expect(201);

    const reopened = await request(app.getHttpServer())
      .get(`/shifts/${shiftId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(reopened.body.broken_crates).toBeNull();

    const reclosed = await request(app.getHttpServer())
      .post(`/shifts/${shiftId}/close`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ counted_amount: '100.00', broken_crates: 0 })
      .expect(201);
    // 0 survives as 0 — it is not null, and it is not dropped as falsy.
    expect(reclosed.body.broken_crates).toBe(0);
  });
```

Reuse the file's existing token and shift fixtures; **do not add a `/auth/login` call** — see backend/CLAUDE.md on the shared login throttle.

```bash
npm run test:db -w backend -- documents-pipeline
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/src/shifts backend/src/testing/documents-pipeline.db-spec.ts
git commit -m "feat(shifts): record broken crates at close, clear on reopen (#110)"
```

---

### Task 3: The derived read — `GET /shifts/:id/crates`

**Files:**
- Create: `backend/src/crates/crate-dispatch.service.ts`
- Create: `backend/src/crates/crate-dispatch.controller.ts`
- Modify: `backend/src/crates/crates.module.ts`
- Test: `backend/src/crates/crate-dispatch.service.spec.ts` (create), `backend/src/crates/crates.db-spec.ts` (modify)

**Interfaces:**
- Consumes: `Shift.broken_crates` (Task 1), `ShiftsService.findOne(actor, id)` for point scoping.
- Produces: `CrateDispatchResponse { with_berry: number; broken: number | null; dispatched: number | null }` and `CrateDispatchService.forShift(actor, shiftId)`.

- [ ] **Step 1: Write the failing unit test**

Create `backend/src/crates/crate-dispatch.service.spec.ts`:

```ts
import { CrateDispatchService } from './crate-dispatch.service';

describe('CrateDispatchService.forShift', () => {
  const shift = { id: 'shift-1', broken_crates: 3 };
  const shifts = { findOne: jest.fn().mockResolvedValue(shift) };
  const dataSource = { manager: { query: jest.fn() } };

  const make = () =>
    new CrateDispatchService(
      dataSource as never,
      shifts as never,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    shifts.findOne.mockResolvedValue(shift);
  });

  it('sums the crates on the shift’s intakes and adds the breakage', async () => {
    dataSource.manager.query.mockResolvedValue([{ with_berry: 142 }]);
    await expect(make().forShift({} as never, 'shift-1')).resolves.toEqual({
      with_berry: 142,
      broken: 3,
      dispatched: 145,
    });
  });

  it('reports 0 for a shift with no intakes — not null', async () => {
    dataSource.manager.query.mockResolvedValue([{ with_berry: 0 }]);
    const result = await make().forShift({} as never, 'shift-1');
    // The query KNOWS there were no crates. That differs from not knowing.
    expect(result.with_berry).toBe(0);
    expect(result.dispatched).toBe(3);
  });

  it('leaves broken and dispatched null while the shift is open', async () => {
    shifts.findOne.mockResolvedValue({ id: 'shift-1', broken_crates: null });
    dataSource.manager.query.mockResolvedValue([{ with_berry: 142 }]);
    await expect(make().forShift({} as never, 'shift-1')).resolves.toEqual({
      with_berry: 142,
      broken: null,
      dispatched: null,
    });
  });

  it('adds a zero breakage rather than treating it as absent', async () => {
    shifts.findOne.mockResolvedValue({ id: 'shift-1', broken_crates: 0 });
    dataSource.manager.query.mockResolvedValue([{ with_berry: 142 }]);
    const result = await make().forShift({} as never, 'shift-1');
    expect(result.broken).toBe(0);
    expect(result.dispatched).toBe(142);
  });

  it('filters voided intakes and non-crate tare in SQL', async () => {
    dataSource.manager.query.mockResolvedValue([{ with_berry: 0 }]);
    await make().forShift({} as never, 'shift-1');
    const [sql] = dataSource.manager.query.mock.calls[0];
    expect(sql).toContain('i.voided_at IS NULL');
    expect(sql).toContain('tt.is_crate');
    // int8 would arrive as a string and land silently in a `number` field.
    expect(sql).toContain('::int');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test -w backend -- crate-dispatch
```

Expected: FAIL — `Cannot find module './crate-dispatch.service'`.

- [ ] **Step 3: Write the service**

Create `backend/src/crates/crate-dispatch.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ShiftsService } from '../shifts/shifts.service';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/** §6.8's three numbers. Only `broken` is stored. */
export interface CrateDispatchResponse {
  /** Σ crates on the shift's live intakes. `0` on an empty shift — the query
   *  knows there were none, which is not the same as not knowing. */
  with_berry: number;
  /** `shifts.broken_crates`. `null` while the shift is open. */
  broken: number | null;
  /** `with_berry + broken`, or `null` while `broken` is. Never stored. */
  dispatched: number | null;
}

/**
 * WHY THIS LIVES IN `crates/` AND NOT IN `shifts/`. `crates/` owns crate
 * counting, exactly as `point-cash/` reads `CRATE_BOOK_SQL` out of
 * `crate-balance.service.ts` rather than re-deriving the filter. Putting this
 * query in `shifts/` would make `shifts/` the second module that knows how
 * `is_crate` selects a tare type. (An earlier draft of the spec claimed the
 * money-arithmetic eslint rule FORCED the move; it does not — `Number.parseInt`
 * is a MemberExpression and passes that rule. The module boundary is the real
 * reason and stands on its own.)
 *
 * NOTHING HERE IS STORED. §6.8's «кількість "з ягодою" запамʼятовується на
 * момент відправлення» is a DISPATCH-DOCUMENT rule, and `crate_shipments` is
 * deferred — so voiding an intake on a closed day silently moves that day's
 * «відвантажено», and §6.8's «було 142, стало 145» warning cannot be built
 * until the snapshot exists. Named in the spec's §4.3, not an oversight.
 */
@Injectable()
export class CrateDispatchService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly shifts: ShiftsService,
  ) {}

  async forShift(actor: AuthenticatedUser, shiftId: string): Promise<CrateDispatchResponse> {
    // Point scope and existence are the shifts service's to enforce — a shift
    // at another point 404s there, so this never leaks a foreign point's count.
    const shift = await this.shifts.findOne(actor, shiftId);

    // `::int` IS LOAD-BEARING: an uncast SUM() is int8, which node-postgres
    // yields as a STRING, and `runner.query` returns `any` so TypeScript would
    // not catch it landing in `with_berry: number`.
    const rows: Array<{ with_berry: number }> = await this.dataSource.manager.query(
      `SELECT COALESCE(SUM(itt.units), 0)::int AS with_berry
         FROM intake_item_tare_types itt
         JOIN intake_items ii ON ii.id = itt.item_id
         JOIN intakes i       ON i.id = ii.intake_id
         JOIN tare_types tt   ON tt.id = itt.tare_type_id
        WHERE i.shift_id = $1
          AND i.voided_at IS NULL
          AND tt.is_crate`,
      [shiftId],
    );

    const with_berry = rows[0]?.with_berry ?? 0;
    const broken = shift.broken_crates;

    return {
      with_berry,
      broken,
      // `null` propagates deliberately. `broken === null` is «не записано», and
      // a dispatched total built on an unknown breakage would be a guess.
      // `broken === 0` is a real value and must still add — hence the explicit
      // null test rather than a falsy one.
      dispatched: broken === null ? null : with_berry + broken,
    };
  }
}
```

- [ ] **Step 4: Run the unit test and watch it pass**

```bash
npm test -w backend -- crate-dispatch
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Add the controller and wire the module**

Create `backend/src/crates/crate-dispatch.controller.ts`:

```ts
import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CrateDispatchService, CrateDispatchResponse } from './crate-dispatch.service';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * §6.8's dispatch line for the close screen. A FOURTH controller in this
 * module for the reason there are already three: `/shifts/:id/crates` cannot
 * live on a `/crate-issuances` prefix.
 *
 * IT MUST SERVE AN OPEN SHIFT. The close form renders «з ягодою 142» while the
 * operator is still typing the breakage, so refusing an open shift would make
 * this useless to the one screen that needs it.
 *
 * `@Auth()` — both roles. §6.10 gives the operator their own point's crate
 * summary at close; point scope comes from `ShiftsService.findOne`.
 */
@Controller('shifts')
export class CrateDispatchController {
  constructor(private readonly dispatch: CrateDispatchService) {}

  @Get(':id/crates')
  @Auth()
  forShift(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CrateDispatchResponse> {
    return this.dispatch.forShift(actor, id);
  }
}
```

In `backend/src/crates/crates.module.ts`, import both new classes, add `CrateDispatchService` to `providers`, and add `CrateDispatchController` to `controllers`. `ShiftsModule` is already imported — do not add it twice.

- [ ] **Step 6: Prove the SQL against real Postgres**

Add to `backend/src/crates/crates.db-spec.ts`:

```ts
  it('counts only crate tare on live intakes', async () => {
    // A receipt with 12 crates and 8 Чешка: only the crates count.
    const shiftId = await seedOpenShift();
    const intakeId = await seedIntake(shiftId, [
      { tare_type_id: crateTareId, units: 12 },
      { tare_type_id: boxTareId, units: 8 },
    ]);

    await expect(dispatch.forShift(owner, shiftId)).resolves.toMatchObject({ with_berry: 12 });

    await ds.query(`UPDATE intakes SET voided_at = now() WHERE id = $1`, [intakeId]);
    // A voided receipt's crates never left the point.
    await expect(dispatch.forShift(owner, shiftId)).resolves.toMatchObject({ with_berry: 0 });
  });
```

Reuse the file's existing fixture helpers and uuid-scoped setup; if `seedOpenShift`/`seedIntake` do not exist under those names, use whatever the file already provides rather than adding new global fixtures.

```bash
npm run test:db -w backend -- crates
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/crates
git commit -m "feat(crates): serve §6.8's dispatch line at GET /shifts/:id/crates (#110)"
```

---

### Task 4: The dev seed, and the docs of record

**Files:**
- Modify: `backend/src/seed/dev-seed.ts` (the `INSERT INTO shifts` at ~line 547)
- Modify: `backend/src/seed/dev-seed.data.ts`
- Modify: `backend/src/seed/dev-seed.history.ts`
- Modify: `28-db-schema.dbml`
- Modify: `backend/CLAUDE.md`
- Test: `backend/src/seed/dev-seed.db-spec.ts` (modify)

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces: nothing new.

- [ ] **Step 1: Write the failing seed test**

Add to `backend/src/seed/dev-seed.db-spec.ts`:

```ts
  it('gives the demo both breakage cases', async () => {
    const rows = await ds.query(
      `SELECT broken_crates FROM shifts WHERE closed_at IS NOT NULL AND broken_crates IS NOT NULL`,
    );
    // Both cases must exist on a fresh database, or the close screen is only
    // ever read against one of them.
    expect(rows.some((r: { broken_crates: number }) => r.broken_crates > 0)).toBe(true);
    expect(rows.some((r: { broken_crates: number }) => r.broken_crates === 0)).toBe(true);
  });

  it('never writes a breakage onto an open shift', async () => {
    const [{ count }] = await ds.query(
      `SELECT COUNT(*)::int AS count FROM shifts
        WHERE closed_at IS NULL AND broken_crates IS NOT NULL`,
    );
    expect(count).toBe(0);
  });
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm run test:db -w backend -- dev-seed
```

Expected: FAIL — no closed shift carries a non-null `broken_crates`.

- [ ] **Step 3: Seed the column**

In `dev-seed.ts`'s `INSERT INTO shifts`, add `broken_crates` to the column list and a parameter that is `NULL` for an open shift and the curated number for a closed one:

```sql
       VALUES ($1, $2, $3::date, $4::shift_status,
               CASE WHEN $5::boolean THEN ${localTs(3, 6, 8)} ELSE NULL END,
               CASE WHEN $5::boolean THEN $2::uuid ELSE NULL END,
               ${localTs(3, 7, 8)},
               CASE WHEN $5::boolean THEN $9::int ELSE NULL END)
```

with `sh.broken ?? 0` appended to the parameter array. Give the curated dataset (`dev-seed.data.ts`) a `broken` on Шипинки's closed shift — **3**, matching #110's own example — and leave the others at `0`. The generated history (`dev-seed.history.ts`) writes `0` for every closed shift: it must stay deterministic, and a PRNG-driven breakage would add a moving number to a file whose whole point is that it does not move.

- [ ] **Step 4: Run the seed tests and watch them pass**

```bash
npm run test:db -w backend -- dev-seed
npm test -w backend -- dev-seed
```

Expected: PASS both. The curated cash assertions (Шипинки 20 910.00, Конищів 12 800.00, Гайове 500.00) must be untouched — `broken_crates` moves no money.

- [ ] **Step 5: Update the schema of record**

In `28-db-schema.dbml`, add to `Table shifts`:

```
  broken_crates int
```

and append to that table's `Note` — in Ukrainian, matching the file's voice — that it is §6.8's «бій», that `null` is «не записано» and `0` is «нічого не побилось», that the CHECK is one-sided so history can stay null, that a re-close overwrites it, and that `crate_shipments` and §6.9's panel remain out of scope. Confirm the table count is unchanged:

```bash
grep -c "^Table " 28-db-schema.dbml   # must print 22
```

- [ ] **Step 6: Update `backend/CLAUDE.md`**

In the `shifts/` line of the Structure block, note that closing also records §6.8's breakage; in the `crates/` line, note the fourth controller and `crate-dispatch.service.ts`. Add `ShiftBrokenCrates` to the `migrations/` list.

- [ ] **Step 7: Run the full verification**

```bash
npm run verify:full
```

Expected: green. **This tier is required** — the fast tier has no `test:db`, and this slice's migration is only exercised there. Report any `SKIPPED` row out loud by name rather than calling the run green.

- [ ] **Step 8: Commit**

```bash
git add backend/src/seed 28-db-schema.dbml backend/CLAUDE.md
git commit -m "feat(seed): seed §6.8's breakage and record it in the schema of record (#110)"
```

---

## Self-review notes

- **Spec coverage.** §2 decisions 1–4 → Task 1 + Task 2; decision 5 (`crate_shipments` deferred) → nothing built, restated in Task 3's service doc comment; decision 6 → Task 3; decision 7 → nothing built, restated in Task 4's DBML note. §3 → Task 1. §4.1 → Task 2. §4.2 → Task 3. §4.3 → Task 3's doc comment. §5 → Tasks 2 and 3. §6 → each task's tests. §7 → Task 4 step 5.
- **Not covered by any task, deliberately:** §6.9's panel, listed out of scope in the spec's §7.
  **This line also said «all frontend», and that was a PLAN DEFECT — recorded rather than deleted,
  because the next plan will reach for the same checklist.** The «Known risk» note below enumerated
  only the backend specs that call `close`, and missed that `POST /shifts/:id/close` is a live route
  the shipped SPA calls. Making `broken_crates` required therefore made a frontend task MANDATORY,
  and this four-task plan had no fifth task for it — it shipped as `8efe669`, outside the plan. Any
  new required DTO field is a breaking change for every live client, frontend included.
- **Type consistency.** `broken_crates` is the column and DTO name throughout; the response field is `broken`, and that rename happens in exactly one place (`CrateDispatchService.forShift`) and nowhere else. `with_berry`/`dispatched` appear only in `CrateDispatchResponse`.
- **Known risk at Task 2 step 6.** Making `broken_crates` required will break every existing spec that calls `close`. The fix is to add `broken_crates: 0` at those call sites, never to make the field optional — that would reintroduce the skippable number the spec's §4.1 argues against.

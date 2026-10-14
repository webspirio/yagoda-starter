# Crates On-Hand Invariant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No new document can drive a point's «Пустих на точці» (`on_hand`) below zero. The six decreasing write paths refuse with 409 `CRATES_ON_HAND_INSUFFICIENT`, and the UI explains why.

**Architecture:** The `on_hand` formula is extracted into one SQL fragment (`onHandSql`) that both `/crate-standing` and a new leaf-module guard (`CrateStockGuard`) read. Each decreasing path calls `assertOnHand(m, pointId, required)` as the last step of its own transaction. The guard locks the `collection_points` row, recomputes `on_hand`, and throws when it is negative. Increasing paths never call it.

**Tech Stack:** NestJS + TypeORM + Postgres 16 (backend, Jest unit + `*.db-spec.ts` against a real DB), React + react-hook-form + react-i18next + Vitest (frontend).

**Spec:** `docs/superpowers/specs/2026-09-30-yagoda-crates-on-hand-invariant.md` (read it first). Evidence: `docs/manual-testing/2026-09-30-crates-negative-on-hand.md`.

## Global Constraints

- Error code: exactly `CRATES_ON_HAND_INSUFFICIENT`, HTTP 409. Body fields: `available`, `required`, `in_transit` (ints). `message`: `The point has ${available} empty crates, this takes ${required}`.
- The guard runs ONLY when the operation's own delta is negative (spec §3 table). Increasing paths never call it.
- The guard is the LAST step inside the path's transaction. In `CreateIntakeCommand.create` it runs BEFORE the payout.
- One formula: `onHandSql` in `backend/src/crates/crate-balance.service.ts`. No other copy of the arithmetic may exist.
- `CrateStockModule` imports no domain module (`ShiftsModule` ← `CratesModule` would be a cycle).
- Crate counts are ints: plain `+`/`-` on numbers. No `Number()`/`parseInt` in backend money modules (`backend/eslint.config.mjs` money `files`).
- Frontend tests run in English (`test-setup` pins `en`). Every new i18n key goes into BOTH `uk.json` and `en.json`.
- Vitest does not typecheck. Run `npm run build -w frontend` (it runs `tsc -b`) after frontend tasks.
- Commit after every task. End each commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Branch: `fix/crates-on-hand-invariant` (already checked out, in place; no worktree).
- DB specs: `npm run test:db -w backend -- <pattern>`. Needs the dev Postgres from `docker compose up`. Unit: `npm test -w backend -- <pattern>`.

## Review Focus

1. **A point already negative before this slice** (e.g. data written earlier). Increasing operations — accept a transfer, return crates, void an issuance, reopen a shift, void a receipt — must still succeed. Pinned in Task 7.
2. **Two operators or an operator plus the owner at one point simultaneously.** Two issuances that each fit alone but not together: exactly one wins. Pinned in Task 7 (race).
3. **A receipt that returns as many crates as its crate tare** (`returned_crates == crate tare`, delta 0) at a point with 0 empties must pass. Pinned in Task 5.
4. **Voiding a `sent` transfer** at a point with negative empties must pass (it counted 0). Pinned in Task 6.
5. **The issue dialog opened by an OWNER for a point that is not theirs.** The hint must read that point's standing, not «no point». Pinned in Task 11.

---

### Task 1: One `on_hand` formula, plus `in_transit`

**Files:**
- Modify: `backend/src/crates/crate-balance.service.ts` (add two exported fragments after `transferCratesSql`)
- Modify: `backend/src/crates/crate-standing.service.ts` (use them; add `in_transit` to the response)
- Test: `backend/src/crates/crate-standing.db-spec.ts`

**Interfaces:**
- Produces: `onHandSql(pointExpr: string): string` — a parenthesised `::int` scalar. `inTransitCratesSql(pointExpr: string): string` — Σ `crates` of non-voided `sent` transfers. `CrateStandingResponse.in_transit: number`.

- [ ] **Step 1: Write the failing test.** In `crate-standing.db-spec.ts`, add a test next to the existing transfer cases. Use the file's own point/owner/operator setup helpers.

```ts
it('reports crates still in transit, and they do not count as empties', async () => {
  // A `sent` transfer: in transit, not received.
  await request(app.getHttpServer())
    .post('/transfers')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ collection_point_id: pointId, cash: '0.00', crates: 30, carrier: 'Водій' })
    .expect(201);

  const res = await request(app.getHttpServer())
    .get('/crate-standing')
    .query({ collection_point_id: pointId })
    .set('Authorization', `Bearer ${ownerToken}`)
    .expect(200);

  expect(res.body.in_transit).toBe(30);
  expect(res.body.on_hand).toBe(beforeOnHand); // unchanged by a sent transfer
});
```

(`beforeOnHand` = `on_hand` read by the same GET just before the POST. Name the point variable after whatever the file uses.)

- [ ] **Step 2: Run it and watch it fail.** Run `npm run test:db -w backend -- crate-standing`. Expected: FAIL, `in_transit` is `undefined`.

- [ ] **Step 3: Add the fragments** to `crate-balance.service.ts`, directly after `transferCratesSql`:

```ts
/**
 * CRATES IN TRANSIT — `sent`, not yet accepted or disputed, not voided. They are NOT
 * empties at the point (`transferCratesSql` counts `sent` as 0); the guard names them so an
 * operator who already unloaded the truck is told to press «Прийняв» first.
 */
export const inTransitCratesSql = (pointExpr: string): string => `(
    SELECT COALESCE(SUM(t.crates), 0)::int
      FROM transfers t
     WHERE t.collection_point_id = ${pointExpr}
       AND t.status = 'sent'
       AND t.voided_at IS NULL
)`;

/**
 * EMPTIES AT THE POINT — the ONE formula (spec 2026-09-30 §4.1). `/crate-standing` shows it
 * and `CrateStockGuard` refuses a write that leaves it below zero, so the two cannot drift:
 * received − issued + returned − crate tare on every live receipt − breakage.
 */
export const onHandSql = (pointExpr: string): string => `(
    ${transferCratesSql(pointExpr)}
  - (SELECT COALESCE(SUM(ci.units), 0)::int
       FROM crate_issuances ci
       JOIN shifts s ON s.id = ci.shift_id
      WHERE s.collection_point_id = ${pointExpr}
        AND ci.voided_at IS NULL)
  + (SELECT COALESCE(SUM(cr.units), 0)::int
       FROM crate_returns cr
       JOIN shifts s ON s.id = cr.shift_id
      WHERE s.collection_point_id = ${pointExpr}
        AND cr.voided_at IS NULL)
  - ${crateTareUnitsSql(`sh.collection_point_id = ${pointExpr}`)}
  - (SELECT COALESCE(SUM(bs.broken_crates), 0)::int
       FROM shifts bs
      WHERE bs.collection_point_id = ${pointExpr})
)::int`;
```

- [ ] **Step 4: Switch `CrateStandingService` to them.**
  - Add `in_transit: number` to `CrateStandingResponse`, with a doc line: `/** Σ crates of `sent` transfers — on their way, not yet empties. */`
  - Import `onHandSql` and `inTransitCratesSql`.
  - In the `figures` CTE, delete the `issued`, `returned`, `all_receipt_crates` and `broken` columns (they only fed `on_hand`) and add:
    ```sql
    ${onHandSql('$1')} AS on_hand,
    ${inTransitCratesSql('$1')} AS in_transit,
    ```
  - Delete the `standing` CTE and select `f.*`-derived fields straight from `figures` (rename `st.` to `f.`), keeping `total` and `shortfall` expressions unchanged. Add `f.in_transit` to the final SELECT.
  - Update the doc comment on `on_hand` to say it reads `onHandSql`.

- [ ] **Step 5: Run the whole standing spec.** Run `npm run test:db -w backend -- crate-standing`. Expected: PASS, every pre-existing test included. That proves the extraction kept the formula.

- [ ] **Step 6: Unit spec.** Run `npm test -w backend -- crate-standing`. If `crate-standing.service.spec.ts` asserts on the SQL text or on the removed columns, update those assertions to the new column list. Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add backend/src/crates/crate-balance.service.ts backend/src/crates/crate-standing.service.ts backend/src/crates/crate-standing.db-spec.ts backend/src/crates/crate-standing.service.spec.ts
git commit -m "refactor(crates): one on_hand formula, and crates in transit on /crate-standing"
```

---

### Task 2: `CrateStockGuard` leaf module and the test fixture

**Files:**
- Create: `backend/src/crate-stock/crate-stock.guard.ts`
- Create: `backend/src/crate-stock/crate-stock.module.ts`
- Create: `backend/src/testing/crate-stock-fixture.ts`
- Test: `backend/src/crate-stock/crate-stock.db-spec.ts`

**Interfaces:**
- Consumes: `onHandSql`, `inTransitCratesSql` (Task 1).
- Produces: `CrateStockGuard.assertOnHand(m: EntityManager, pointId: string, required: number): Promise<void>`. `CrateStockModule` (exports the guard). Fixture (Task 3–8 use it):
  - `bootApp(): Promise<{ app: INestApplication; ds: DataSource; ownerToken: string }>`
  - `makePoint(app, ownerToken, label): Promise<{ pointId: string; operatorToken: string }>` — point + operator + an open shift.
  - `makeSupplier(app, operatorToken): Promise<string>`
  - `sendCrates(app, ownerToken, pointId, crates): Promise<string>` — a `sent` transfer's id.
  - `stockPoint(app, ownerToken, operatorToken, pointId, crates): Promise<string>` — send + accept; the transfer's id.
  - `onHand(ds, pointId): Promise<number>`

- [ ] **Step 1: Write the fixture** `backend/src/testing/crate-stock-fixture.ts`. Model it on `crates/crates-race.db-spec.ts`'s `beforeAll` (same imports, same `relaxThrottleForTests` / `resolveTestDatabaseName` ordering: the harness import MUST come before `AppModule`).

```ts
import { randomUUID } from 'crypto';
import request = require('supertest');
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ClassSerializerInterceptor, INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
// MUST precede `../app.module` — see crates-race.db-spec.ts.
import { relaxThrottleForTests, resolveTestDatabaseName } from './db-harness';
import { AppModule } from '../app.module';
import { UsersService } from '../users/users.service';
import { CredentialsService } from '../users/credentials.service';
import { LOCAL_PROVIDER } from '../users/user-identity.entity';
import { UserRole } from '../users/user-role.enum';
import { onHandSql } from '../crates/crate-balance.service';

/** Crates on-hand invariant (spec 2026-09-30): every spec that issues crates, closes with
 *  breakage or weighs crate tare now needs empties at the point first. */
const code = (): string => randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
let app: INestApplication;

export async function bootApp(): Promise<{ app: INestApplication; ds: DataSource; ownerToken: string }> {
  process.env.DB_NAME = resolveTestDatabaseName();
  relaxThrottleForTests();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  await app.init();
  const { user: owner } = await app.get(UsersService).createWithIdentity(
    {
      provider: LOCAL_PROVIDER,
      providerUserId: `stock-owner-${randomUUID()}`,
      first_name: 'Stock',
      last_name: 'Owner',
      role: UserRole.NetworkOwner,
    },
    async (created, manager) => app.get(CredentialsService).set(created.id, 'hunter2!!', manager),
  );
  const ownerToken = app.get(JwtService).sign({ sub: owner.id });
  // Exactly one crate type must exist (`NO_CRATE_TYPE` otherwise); creating one demotes others.
  await request(app.getHttpServer())
    .post('/tare-types')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ name: `stock-crate-${randomUUID()}`, weight_kg: '1.20', deposit_price: '120.00', is_crate: true })
    .expect(201);
  return { app, ds: app.get(DataSource), ownerToken };
}

export async function makePoint(
  a: INestApplication,
  ownerToken: string,
  label: string,
): Promise<{ pointId: string; operatorToken: string }> {
  const p = await request(a.getHttpServer())
    .post('/collection-points')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ name: `${label}-${randomUUID()}`, code: code() })
    .expect(201);
  const pointId = p.body.id as string;
  const { user: op } = await a.get(UsersService).createWithIdentity(
    {
      provider: LOCAL_PROVIDER,
      providerUserId: `${label}-op-${randomUUID()}`,
      first_name: 'Stock',
      last_name: 'Operator',
      role: UserRole.PointOperator,
      collection_point_id: pointId,
    },
    async (created, manager) => a.get(CredentialsService).set(created.id, 'hunter2!!', manager),
  );
  const operatorToken = a.get(JwtService).sign({ sub: op.id });
  await request(a.getHttpServer())
    .post('/shifts')
    .set('Authorization', `Bearer ${operatorToken}`)
    .send({ counted_amount: '0.00' })
    .expect(201);
  return { pointId, operatorToken };
}

export async function makeSupplier(a: INestApplication, operatorToken: string): Promise<string> {
  const s = await request(a.getHttpServer())
    .post('/suppliers')
    .set('Authorization', `Bearer ${operatorToken}`)
    .send({ first_name: 'Stock', last_name: `Supplier-${randomUUID()}` })
    .expect(201);
  return s.body.id as string;
}

export async function sendCrates(a: INestApplication, ownerToken: string, pointId: string, crates: number): Promise<string> {
  const t = await request(a.getHttpServer())
    .post('/transfers')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ collection_point_id: pointId, cash: '0.00', crates, carrier: 'Водій' })
    .expect(201);
  return t.body.id as string;
}

export async function stockPoint(
  a: INestApplication,
  ownerToken: string,
  operatorToken: string,
  pointId: string,
  crates: number,
): Promise<string> {
  const id = await sendCrates(a, ownerToken, pointId, crates);
  await request(a.getHttpServer())
    .post(`/transfers/${id}/accept`)
    .set('Authorization', `Bearer ${operatorToken}`)
    .expect(201);
  return id;
}

export async function onHand(ds: DataSource, pointId: string): Promise<number> {
  const [row] = (await ds.query(`SELECT ${onHandSql('$1')} AS n`, [pointId])) as { n: number }[];
  return row.n;
}
```

(If `POST /transfers/:id/accept` returns 200 rather than 201 in this codebase, match what `transfers` db-specs expect.)

- [ ] **Step 2: Write the failing guard spec** `backend/src/crate-stock/crate-stock.db-spec.ts`:

```ts
import { ConflictException, INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { bootApp, makePoint, stockPoint, sendCrates } from '../testing/crate-stock-fixture';
import { CrateStockGuard } from './crate-stock.guard';

describe('CrateStockGuard (real Postgres)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let ownerToken: string;
  let guard: CrateStockGuard;

  beforeAll(async () => {
    ({ app, ds, ownerToken } = await bootApp());
    guard = app.get(CrateStockGuard);
  }, 30_000);
  afterAll(async () => app?.close());

  it('passes when the point stays at or above zero', async () => {
    const { pointId, operatorToken } = await makePoint(app, ownerToken, 'guard-ok');
    await stockPoint(app, ownerToken, operatorToken, pointId, 10);
    await expect(ds.transaction((m) => guard.assertOnHand(m, pointId, 10))).resolves.toBeUndefined();
  });

  it('refuses a negative point, naming what was there, what is asked and what is in transit', async () => {
    const { pointId } = await makePoint(app, ownerToken, 'guard-neg');
    await sendCrates(app, ownerToken, pointId, 20); // sent, not accepted
    // A crate_issuances row written straight by SQL stands in for "the write that just happened".
    await ds.query(
      `INSERT INTO crate_issuances (code, shift_id, supplier_id, units, mode, deposit_per_unit, deposit_taken, issued_by_user_id)
       SELECT 'GUARD-' || substr(md5(random()::text), 1, 8), s.id, sup.id, 5, 'receipt', 0, 0, s.opened_by_user_id
         FROM shifts s, LATERAL (SELECT id FROM suppliers LIMIT 1) sup
        WHERE s.collection_point_id = $1 AND s.closed_at IS NULL`,
      [pointId],
    );
    const err = await ds.transaction((m) => guard.assertOnHand(m, pointId, 5)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      code: 'CRATES_ON_HAND_INSUFFICIENT',
      available: 0,
      required: 5,
      in_transit: 20,
    });
  });
});
```

(If the raw INSERT trips a NOT NULL column this codebase has on `crate_issuances`, read `crate-issuance.entity.ts` and add the column. The point is one live 5-unit issuance at a point with 0 received.)

- [ ] **Step 3: Run it and watch it fail.** Run `npm run test:db -w backend -- crate-stock`. Expected: FAIL, `Cannot find module './crate-stock.guard'`.

- [ ] **Step 4: Implement the guard and module.**

`backend/src/crate-stock/crate-stock.guard.ts`:

```ts
import { ConflictException, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { inTransitCratesSql, onHandSql } from '../crates/crate-balance.service';

/**
 * «Пустих на точці» never goes below zero through a new document (spec 2026-09-30).
 *
 * Called LAST in the transaction of each write that TAKES empties (issue, breakage, a receipt's
 * crate tare, voiding a transfer or a return, resolving a dispute downwards) — never by one that
 * gives them back, so a point already negative can still be healed. The point row lock comes
 * after every other lock the caller holds, and under READ COMMITTED the recount below sees any
 * write that committed while we waited — two issuances that each fit alone cannot both pass.
 */
@Injectable()
export class CrateStockGuard {
  async assertOnHand(m: EntityManager, pointId: string, required: number): Promise<void> {
    await m.query('SELECT id FROM collection_points WHERE id = $1 FOR UPDATE', [pointId]);
    const [row] = (await m.query(
      `SELECT ${onHandSql('$1')} AS after, ${inTransitCratesSql('$1')} AS in_transit`,
      [pointId],
    )) as Array<{ after: number; in_transit: number }>;
    if (row.after >= 0) return;
    const available = row.after + required;
    throw new ConflictException({
      message: `The point has ${available} empty crates, this takes ${required}`,
      code: 'CRATES_ON_HAND_INSUFFICIENT',
      available,
      required,
      in_transit: row.in_transit,
    });
  }
}
```

`backend/src/crate-stock/crate-stock.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { CrateStockGuard } from './crate-stock.guard';

/** A LEAF on purpose: `CratesModule` imports `ShiftsModule`, so the guard that
 *  `ShiftsModule` needs cannot live in `CratesModule`. It reads SQL fragments from
 *  the crates FILE, as `point-cash` does, and imports no domain module. */
@Module({ providers: [CrateStockGuard], exports: [CrateStockGuard] })
export class CrateStockModule {}
```

Register `CrateStockModule` in `backend/src/app.module.ts`'s `imports` (next to `CratesModule`) so `app.get(CrateStockGuard)` resolves in the spec.

- [ ] **Step 5: Run it and watch it pass.** Run `npm run test:db -w backend -- crate-stock`. Expected: PASS (2 tests).

- [ ] **Step 6: Commit.**

```bash
git add backend/src/crate-stock backend/src/testing/crate-stock-fixture.ts backend/src/app.module.ts
git commit -m "feat(crates): CrateStockGuard — refuse a write that leaves empties below zero"
```

---

### Task 3: Guard issuing crates and voiding a return

**Files:**
- Modify: `backend/src/crates/crates.module.ts` (import `CrateStockModule`)
- Modify: `backend/src/crates/crates.service.ts` (`issue`, `voidReturn`, constructor)
- Modify: `backend/src/crates/crates.service.spec.ts:113` (constructor call)
- Test: `backend/src/crate-stock/crate-stock.db-spec.ts` (cases 1, 2, 6)

**Interfaces:**
- Consumes: `CrateStockGuard.assertOnHand` (Task 2), fixture (Task 2).
- Produces: `CratesService` constructor gains a LAST parameter `private readonly stock: CrateStockGuard`.

- [ ] **Step 1: Write the failing db tests** — append to `crate-stock.db-spec.ts` a `describe('write paths')` block. Add `import request = require('supertest');` and `makeSupplier`, `onHand` to the fixture import.

```ts
const refused = (res: request.Response, available: number, required: number, inTransit = 0) => {
  expect(res.status).toBe(409);
  expect(res.body).toMatchObject({ code: 'CRATES_ON_HAND_INSUFFICIENT', available, required, in_transit: inTransit });
};
const issue = (token: string, supplierId: string, units: number) =>
  request(app.getHttpServer())
    .post('/crate-issuances')
    .set('Authorization', `Bearer ${token}`)
    .send({ supplier_id: supplierId, units, mode: 'receipt' });

it('case 1 — issuing with no transfer at all is refused and writes nothing', async () => {
  const { pointId, operatorToken } = await makePoint(app, ownerToken, 'case1');
  const sup = await makeSupplier(app, operatorToken);
  refused(await issue(operatorToken, sup, 10), 0, 10);
  const [{ n }] = (await ds.query(
    `SELECT COUNT(*)::int AS n FROM crate_issuances ci JOIN shifts s ON s.id = ci.shift_id WHERE s.collection_point_id = $1`,
    [pointId],
  )) as { n: number }[];
  expect(n).toBe(0);
});

it('case 2 — a sent, unaccepted transfer does not count; the refusal names it', async () => {
  const { pointId, operatorToken } = await makePoint(app, ownerToken, 'case2');
  const sup = await makeSupplier(app, operatorToken);
  await sendCrates(app, ownerToken, pointId, 20);
  refused(await issue(operatorToken, sup, 10), 0, 10, 20);
});

it('boundary — issuing exactly what is on hand passes and leaves 0', async () => {
  const { pointId, operatorToken } = await makePoint(app, ownerToken, 'boundary');
  const sup = await makeSupplier(app, operatorToken);
  await stockPoint(app, ownerToken, operatorToken, pointId, 10);
  expect((await issue(operatorToken, sup, 10)).status).toBe(201);
  expect(await onHand(ds, pointId)).toBe(0);
});

it('case 6 — voiding a return whose crates went out again is refused', async () => {
  const { pointId, operatorToken } = await makePoint(app, ownerToken, 'case6');
  const a = await makeSupplier(app, operatorToken);
  const b = await makeSupplier(app, operatorToken);
  await stockPoint(app, ownerToken, operatorToken, pointId, 10);
  expect((await issue(operatorToken, a, 10)).status).toBe(201);
  const ret = await request(app.getHttpServer())
    .post('/crate-returns')
    .set('Authorization', `Bearer ${operatorToken}`)
    .send({ supplier_id: a, units: 10 })
    .expect(201);
  expect((await issue(operatorToken, b, 10)).status).toBe(201);
  const res = await request(app.getHttpServer())
    .post(`/crate-returns/${ret.body.id}/void`)
    .set('Authorization', `Bearer ${operatorToken}`)
    .send({ reason: 'помилка' });
  refused(res, 0, 10);
  expect(await onHand(ds, pointId)).toBe(0);
});
```

- [ ] **Step 2: Run them and watch them fail.** Run `npm run test:db -w backend -- crate-stock`. Expected: the new cases FAIL (201 instead of 409); boundary passes.

- [ ] **Step 3: Wire the guard.**
  - `crates.module.ts`: add `CrateStockModule` to `imports`, with `import { CrateStockModule } from '../crate-stock/crate-stock.module';`.
  - `crates.service.ts`: `import { CrateStockGuard } from '../crate-stock/crate-stock.guard';` and add `private readonly stock: CrateStockGuard,` as the LAST constructor parameter.
  - In `issue`, directly before `return toCrateIssuanceResponse(issuance, shift, false);`:
    ```ts
    // Last: the issuance and its audit are written, so the recount includes them (spec 2026-09-30).
    await this.stock.assertOnHand(m, pointId, dto.units);
    ```
  - In `voidReturn`, directly after the `crate-return.voided` audit record, before loading allocations:
    ```ts
    // The returned crates leave the empties again — refused if they already went out.
    await this.stock.assertOnHand(m, shift.collection_point_id, saved.units);
    ```
  - Do NOT touch `writeReturn`, `voidIssuance` or `voidReturnForIntake` (they only give empties back).
  - Update the `issue` doc comment. Replace the «NO `target_crates` CHECK EITHER» paragraph's last sentence with: «The one crates check it DOES make is physical — `CrateStockGuard`, empties at the point (spec 2026-09-30).»

- [ ] **Step 4: Fix the unit spec's constructor.** In `crates.service.spec.ts` near line 113, add a mock as the last argument, and a test:

```ts
const stock = { assertOnHand: jest.fn().mockResolvedValue(undefined) };
// ... new CratesService(..., balance, stock as never)
```

```ts
it('asks the stock guard for exactly the units issued, at the issuing point', async () => {
  // Arrange exactly as the neighbouring successful-issue test does, then:
  await service.issue(operator, { supplier_id: supplierId, units: 12, mode: CrateIssuanceMode.Receipt });
  expect(stock.assertOnHand).toHaveBeenCalledWith(expect.anything(), pointId, 12);
});
```

- [ ] **Step 5: Run the tests.** Run `npm test -w backend -- crates.service`, then `npm run test:db -w backend -- crate-stock`. Expected: both PASS. (Other db-specs may now fail. Task 8 fixes them; do not run the whole db suite yet.)

- [ ] **Step 6: Commit.**

```bash
git add backend/src/crates backend/src/crate-stock
git commit -m "feat(crates): refuse an issuance or a return void that would take empties below zero"
```

---

### Task 4: Guard closing a shift with breakage

**Files:**
- Modify: `backend/src/shifts/shifts.module.ts`, `backend/src/shifts/shifts.service.ts` (`close`, constructor)
- Modify: `backend/src/shifts/shifts.service.spec.ts` (4 constructor calls: lines ~107, 436, 534, 622)
- Test: `backend/src/crate-stock/crate-stock.db-spec.ts` (case 5)

**Interfaces:**
- Consumes: `CrateStockGuard` (Task 2).
- Produces: `ShiftsService` constructor gains a LAST parameter `private readonly stock: CrateStockGuard`.

- [ ] **Step 1: Write the failing db test** (append to the `write paths` block):

```ts
it('case 5 — closing with more breakage than empties is refused; the shift stays open', async () => {
  const { pointId, operatorToken } = await makePoint(app, ownerToken, 'case5');
  await stockPoint(app, ownerToken, operatorToken, pointId, 10);
  const [{ id }] = (await ds.query(
    `SELECT id FROM shifts WHERE collection_point_id = $1 AND closed_at IS NULL`,
    [pointId],
  )) as { id: string }[];
  const res = await request(app.getHttpServer())
    .post(`/shifts/${id}/close`)
    .set('Authorization', `Bearer ${operatorToken}`)
    .send({ counted_amount: '0.00', broken_crates: 25 });
  refused(res, 10, 25);
  const [{ closed_at }] = (await ds.query(`SELECT closed_at FROM shifts WHERE id = $1`, [id])) as { closed_at: Date | null }[];
  expect(closed_at).toBeNull();
});
```

- [ ] **Step 2: Run it and watch it fail.** Run `npm run test:db -w backend -- crate-stock`. Expected: case 5 FAILS (201).

- [ ] **Step 3: Wire it.**
  - `shifts.module.ts`: import `CrateStockModule`.
  - `shifts.service.ts`: import `CrateStockGuard` and add `private readonly stock: CrateStockGuard,` as the LAST constructor parameter.
  - In `close`, directly after the second `audit.record` (`cash-count.recorded`), before `namesFor`:
    ```ts
    // §6.8's breakage leaves the empties (spec 2026-09-30) — refused if there are not that many.
    if (dto.broken_crates > 0) {
      await this.stock.assertOnHand(m, saved.collection_point_id, dto.broken_crates);
    }
    ```
  - Do NOT touch `reopen` (it sets breakage back to NULL, which only gives empties back).

- [ ] **Step 4: Fix the unit spec.** In each of the four `new ShiftsService(` calls in `shifts.service.spec.ts`, append `stock as never`, with `const stock = { assertOnHand: jest.fn().mockResolvedValue(undefined) };` declared at the top of the file's outer `describe` and `stock.assertOnHand.mockClear()` in its `beforeEach`. Add, next to the existing close tests:

```ts
it('asks the stock guard for the breakage, and not at all when there is none', async () => {
  // Arrange a closable shift exactly as the neighbouring close test does.
  await service.close(operator, shiftId, { counted_amount: '0.00', broken_crates: 3 });
  expect(stock.assertOnHand).toHaveBeenCalledWith(expect.anything(), pointId, 3);
});
it('does not ask the stock guard when nothing broke', async () => {
  await service.close(operator, shiftId, { counted_amount: '0.00', broken_crates: 0 });
  expect(stock.assertOnHand).not.toHaveBeenCalled();
});
```

Search for other `new ShiftsService(` calls outside this file (`grep -rn "new ShiftsService(" backend/src`) and append the same argument.

- [ ] **Step 5: Run the tests.** Run `npm test -w backend -- shifts.service`, then `npm run test:db -w backend -- crate-stock`. Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add backend/src/shifts backend/src/crate-stock
git commit -m "feat(shifts): refuse a close whose breakage exceeds the empties at the point"
```

---

### Task 5: Guard a receipt's crate tare

**Files:**
- Modify: `backend/src/intakes/intakes.module.ts`, `backend/src/intakes/commands/create-intake.command.ts`
- Modify: `backend/src/testing/unit/intakes.mocks.ts:231` (constructor call)
- Test: `backend/src/crate-stock/crate-stock.db-spec.ts` (case 7 + Review Focus 3)

**Interfaces:**
- Consumes: `CrateStockGuard` (Task 2). `built.crate_units` (existing, `intakes/intake-lines.ts:59`).
- Produces: `CreateIntakeCommand` constructor gains a LAST parameter `private readonly stock: CrateStockGuard`.

- [ ] **Step 1: Write the failing db tests.** Add a `describe('receipts')` block with its own `beforeAll`: a product, a grade and a grade price at the point, following `intakes/intake-crate-return.db-spec.ts` lines 99–120. The crate type is the fixture's (`bootApp` created it). Read its id with `SELECT id FROM tare_types WHERE is_crate`.

```ts
describe('receipts', () => {
  let pointId: string; let operatorToken: string; let supplierId: string; let gradeId: string; let crateTypeId: string;

  beforeAll(async () => {
    ({ pointId, operatorToken } = await makePoint(app, ownerToken, 'case7'));
    supplierId = await makeSupplier(app, operatorToken);
    const product = await request(app.getHttpServer()).post('/products')
      .set('Authorization', `Bearer ${ownerToken}`).send({ name: `stock-product-${Date.now()}` }).expect(201);
    const grade = await request(app.getHttpServer()).post('/product-grades')
      .set('Authorization', `Bearer ${ownerToken}`).send({ product_id: product.body.id, name: `сорт-${Date.now()}` }).expect(201);
    gradeId = grade.body.id as string;
    await request(app.getHttpServer()).post('/grade-prices').set('Authorization', `Bearer ${ownerToken}`)
      .send({ collection_point_id: pointId, product_grade_id: gradeId, base_price: '50.00', max_markup: '0.00', max_discount: '0.00' })
      .expect(201);
    [{ id: crateTypeId }] = (await ds.query(`SELECT id FROM tare_types WHERE is_crate`)) as { id: string }[];
  });

  const receipt = (crates: number, returned?: number) =>
    request(app.getHttpServer()).post('/intakes').set('Authorization', `Bearer ${operatorToken}`).send({
      supplier_id: supplierId,
      items: [{ product_grade_id: gradeId, gross_kg: '40.00', tare: [{ tare_type_id: crateTypeId, units: crates }] }],
      ...(returned === undefined ? {} : { returned_crates: returned }),
    });

  it('case 7 — crate tare with no empties at the point is refused, and no receipt is written', async () => {
    refused(await receipt(12), 0, 12);
    const [{ n }] = (await ds.query(
      `SELECT COUNT(*)::int AS n FROM intakes i JOIN shifts s ON s.id = i.shift_id WHERE s.collection_point_id = $1`,
      [pointId],
    )) as { n: number }[];
    expect(n).toBe(0);
  });

  it('a receipt returning every crate it carries takes no empties, so it passes at 0', async () => {
    // The return needs outstanding crates: stock 5, issue 5 (on_hand back to 0).
    await stockPoint(app, ownerToken, operatorToken, pointId, 5);
    await request(app.getHttpServer()).post('/crate-issuances').set('Authorization', `Bearer ${operatorToken}`)
      .send({ supplier_id: supplierId, units: 5, mode: 'receipt' }).expect(201);
    expect(await onHand(ds, pointId)).toBe(0);
    expect((await receipt(5, 5)).status).toBe(201);
    expect(await onHand(ds, pointId)).toBe(0);
  });
});
```

(Gross `40.00` kg against 12 × 1.20 kg tare leaves a positive net. If `NET_WEIGHT_NOT_POSITIVE` fires, raise the gross.)

- [ ] **Step 2: Run them and watch them fail.** Run `npm run test:db -w backend -- crate-stock`. Expected: case 7 FAILS (201); the net-zero case passes.

- [ ] **Step 3: Wire it.**
  - `intakes.module.ts`: import `CrateStockModule`.
  - `create-intake.command.ts`: import `CrateStockGuard`, add `private readonly stock: CrateStockGuard,` as the LAST constructor parameter.
  - Directly after the `if (returned > 0) { await this.crates.writeReturn(...) }` block and BEFORE the `// §2.1 ⑥` payout block:
    ```ts
    // Spec 2026-09-30 — full crates are always ours, so the crate tare this receipt weighs comes
    // out of the empties, less any it gives back (`returned`). Before the payout, so a refusal
    // hands no cash over.
    const taken = built.crate_units - returned;
    if (taken > 0) await this.stock.assertOnHand(m, pointId, taken);
    ```
  - Do NOT touch `void-intake.command.ts`: voiding gives back `crate tare − returned ≥ 0`.

- [ ] **Step 4: Fix the unit mocks.** In `testing/unit/intakes.mocks.ts` at the `new CreateIntakeCommand(` call (~line 231), append a stock mock and expose it on the returned mocks object:

```ts
const stock = { assertOnHand: jest.fn().mockResolvedValue(undefined) };
// ... new CreateIntakeCommand(..., detail, stock as never)
// and add `stock` to the object this factory returns
```

In `create-intake.command.spec.ts` add:

```ts
it('asks the stock guard for crate tare net of the crates returned', async () => {
  // Arrange a priced line whose built.crate_units is 5, as the returned_crates tests at ~line 311 do.
  await command.create(oksana, dto({ returned_crates: 2 }) as never);
  expect(mocks.stock.assertOnHand).toHaveBeenCalledWith(expect.anything(), expect.any(String), 3);
});
it('does not ask when the receipt gives back every crate it weighs', async () => {
  await command.create(oksana, dto({ returned_crates: 5 }) as never);
  expect(mocks.stock.assertOnHand).not.toHaveBeenCalled();
});
```

(Use the file's own names for the mocks object and the crate-unit fixture. The assertions are what matter.)

- [ ] **Step 5: Run the tests.** Run `npm test -w backend -- create-intake`, then `npm run test:db -w backend -- crate-stock`. Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add backend/src/intakes backend/src/testing/unit/intakes.mocks.ts backend/src/crate-stock
git commit -m "feat(intakes): refuse a receipt whose crate tare the point has no empties for"
```

---

### Task 6: Guard voiding a transfer and resolving a dispute downwards

**Files:**
- Create: `backend/src/transfers/transfer-crates.ts` + `backend/src/transfers/transfer-crates.spec.ts`
- Modify: `backend/src/transfers/transfers.module.ts`, `backend/src/transfers/transfers.service.ts` (`void`, `resolve`, constructor)
- Modify: `backend/src/transfers/transfers.service.spec.ts` (every `new TransfersService(`)
- Test: `backend/src/crate-stock/crate-stock.db-spec.ts` (cases 3, 4, Review Focus 4)

**Interfaces:**
- Produces: `countedCrates(t: CountedTransfer): number`. `TransfersService` constructor gains a LAST parameter `private readonly stock: CrateStockGuard`.

- [ ] **Step 1: Write the failing unit test** `transfer-crates.spec.ts`:

```ts
import { countedCrates } from './transfer-crates';
import { TransferStatus } from './transfer-status.enum';

const t = (over: Partial<Parameters<typeof countedCrates>[0]>) => ({
  status: TransferStatus.Sent, crates: 20, reported_crates: null, resolved_crates: null, resolved_at: null, ...over,
});

describe('countedCrates — what transferCratesSql counts for one transfer', () => {
  it('sent counts nothing', () => expect(countedCrates(t({}))).toBe(0));
  it('accepted counts what was sent', () => expect(countedCrates(t({ status: TransferStatus.Accepted }))).toBe(20));
  it('disputed and open counts what the point reported', () =>
    expect(countedCrates(t({ status: TransferStatus.Disputed, reported_crates: 18 }))).toBe(18));
  it('disputed and resolved counts the resolution', () =>
    expect(countedCrates(t({ status: TransferStatus.Disputed, reported_crates: 18, resolved_crates: 5, resolved_at: new Date() }))).toBe(5));
});
```

- [ ] **Step 2: Run it and watch it fail.** Run `npm test -w backend -- transfer-crates`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `transfer-crates.ts`:

```ts
import { TransferStatus } from './transfer-status.enum';
import type { Transfer } from './transfer.entity';

export type CountedTransfer = Pick<Transfer, 'status' | 'crates' | 'reported_crates' | 'resolved_crates' | 'resolved_at'>;

/** The crates ONE transfer adds to the point's empties — the TS twin of `transferCratesSql`'s
 *  CASE (void aside), used to size what voiding it takes away. Keep the two in step. */
export function countedCrates(t: CountedTransfer): number {
  if (t.status === TransferStatus.Accepted) return t.crates;
  if (t.status === TransferStatus.Disputed) return (t.resolved_at ? t.resolved_crates : t.reported_crates) ?? 0;
  return 0;
}
```

Run `npm test -w backend -- transfer-crates`. Expected: PASS.

- [ ] **Step 4: Write the failing db tests** (append to `write paths`):

```ts
it('case 3 — voiding an accepted transfer whose crates went out is refused', async () => {
  const { pointId, operatorToken } = await makePoint(app, ownerToken, 'case3');
  const sup = await makeSupplier(app, operatorToken);
  const tr = await stockPoint(app, ownerToken, operatorToken, pointId, 20);
  expect((await issue(operatorToken, sup, 15)).status).toBe(201);
  const res = await request(app.getHttpServer()).post(`/transfers/${tr}/void`)
    .set('Authorization', `Bearer ${ownerToken}`).send({ reason: 'помилка' });
  refused(res, 5, 20);
  const [{ voided_at }] = (await ds.query(`SELECT voided_at FROM transfers WHERE id = $1`, [tr])) as { voided_at: Date | null }[];
  expect(voided_at).toBeNull();
});

it('case 4 — resolving a dispute below what was already issued is refused', async () => {
  const { pointId, operatorToken } = await makePoint(app, ownerToken, 'case4');
  const sup = await makeSupplier(app, operatorToken);
  const tr = await sendCrates(app, ownerToken, pointId, 20);
  await request(app.getHttpServer()).post(`/transfers/${tr}/dispute`).set('Authorization', `Bearer ${operatorToken}`)
    .send({ reported_cash: '0.00', reported_crates: 20, dispute_note: 'перевірка' }).expect(201);
  expect((await issue(operatorToken, sup, 20)).status).toBe(201);
  const res = await request(app.getHttpServer()).post(`/transfers/${tr}/resolve`)
    .set('Authorization', `Bearer ${ownerToken}`).send({ resolved_cash: '0.00', resolved_crates: 5 });
  refused(res, 0, 15);
});

it('voiding a sent transfer takes nothing, so it passes even at a negative point', async () => {
  const { pointId, operatorToken } = await makePoint(app, ownerToken, 'void-sent');
  await ds.query(`UPDATE shifts SET broken_crates = 7, closed_at = now(), status = 'closed' WHERE collection_point_id = $1`, [pointId]);
  expect(await onHand(ds, pointId)).toBe(-7);
  const tr = await sendCrates(app, ownerToken, pointId, 10);
  expect((await request(app.getHttpServer()).post(`/transfers/${tr}/void`)
    .set('Authorization', `Bearer ${ownerToken}`).send({ reason: 'не поїхала' })).status).toBe(201);
});
```

(If the codebase answers these POSTs with 200, match it. If the raw `UPDATE shifts` trips another CHECK, set the columns that constraint needs; the point is a closed shift with breakage 7 and nothing received.)

- [ ] **Step 5: Run them and watch them fail.** Run `npm run test:db -w backend -- crate-stock`. Expected: cases 3 and 4 FAIL (201); void-sent passes.

- [ ] **Step 6: Wire it.**
  - `transfers.module.ts`: import `CrateStockModule`.
  - `transfers.service.ts`: import `CrateStockGuard` and `countedCrates`, and add `private readonly stock: CrateStockGuard,` as the LAST constructor parameter.
  - In `void`, before mutating `transfer`: `const counted = countedCrates(transfer);`. After the `transfer.voided` audit record, before `return saved;`:
    ```ts
    // Whatever this transfer put into the empties leaves with it (spec 2026-09-30).
    if (counted > 0) await this.stock.assertOnHand(m, saved.collection_point_id, counted);
    ```
  - In `resolve`, before mutating: `const before = transfer.reported_crates ?? 0;`. After the `transfer.resolved` audit record, before `return saved;`:
    ```ts
    // A resolution below the point's own count takes the difference back out of the empties.
    if (dto.resolved_crates < before) {
      await this.stock.assertOnHand(m, saved.collection_point_id, before - dto.resolved_crates);
    }
    ```
  - Do NOT touch `accept` or `dispute` (only from `sent`, which counts 0).

- [ ] **Step 7: Fix the unit spec.** Append `stock as never` to every `new TransfersService(` in `transfers.service.spec.ts` (`grep -n "new TransfersService(" backend/src -r` for others), with a shared `const stock = { assertOnHand: jest.fn().mockResolvedValue(undefined) };` cleared in `beforeEach`. Add:

```ts
it('void asks the stock guard for what an accepted transfer counted', async () => {
  // Arrange an accepted transfer with crates: 20, as the existing void test does.
  await service.void(owner, transferId, { reason: 'x' });
  expect(stock.assertOnHand).toHaveBeenCalledWith(expect.anything(), pointId, 20);
});
it('resolve does not ask when the resolution is not below the report', async () => {
  // Arrange a disputed transfer with reported_crates: 10, as the existing resolve test does.
  await service.resolve(owner, transferId, { resolved_cash: '0.00', resolved_crates: 10 });
  expect(stock.assertOnHand).not.toHaveBeenCalled();
});
```

- [ ] **Step 8: Run the tests.** Run `npm test -w backend -- transfers`, then `npm run test:db -w backend -- crate-stock`. Expected: PASS.

- [ ] **Step 9: Commit.**

```bash
git add backend/src/transfers backend/src/crate-stock
git commit -m "feat(transfers): refuse a void or a resolution that takes back crates already issued"
```

---

### Task 7: Increasing paths stay open on a negative point; races

**Files:**
- Test: `backend/src/crate-stock/crate-stock.db-spec.ts`

**Interfaces:**
- Consumes: the fixture and every wired path (Tasks 2–6).

- [ ] **Step 1: Write the tests** (a new `describe('a point already below zero, and races')`). A point goes negative the way legacy data did, by SQL, bypassing the guard: a closed earlier shift with breakage. Then the operator works a new shift.

```ts
/** A point at `-n`: an earlier CLOSED shift with breakage n, written past the guard, and a
 *  fresh open shift for today's work. */
const negativePoint = async (label: string, n: number) => {
  const p = await makePoint(app, ownerToken, label);
  // Yesterday's shift, closed with breakage n — moved back a day because
  // UQ_shifts_point_business_date allows one shift per point per day.
  await ds.query(
    `UPDATE shifts SET broken_crates = $2, closed_at = now(), status = 'closed',
                       business_date = business_date - 1
      WHERE collection_point_id = $1 AND closed_at IS NULL`,
    [p.pointId, n],
  );
  await request(app.getHttpServer()).post('/shifts').set('Authorization', `Bearer ${p.operatorToken}`)
    .send({ counted_amount: '0.00' }).expect(201);
  expect(await onHand(ds, p.pointId)).toBe(-n);
  return p;
};

it('accepting a transfer heals a negative point', async () => {
  const { pointId, operatorToken } = await negativePoint('heal-accept', 30);
  await stockPoint(app, ownerToken, operatorToken, pointId, 10);
  expect(await onHand(ds, pointId)).toBe(-20);
});

it('a crate return and an issuance void both pass while the point is negative', async () => {
  const { pointId, operatorToken } = await negativePoint('heal-return', 5);
  const a = await makeSupplier(app, operatorToken);
  const b = await makeSupplier(app, operatorToken);
  await stockPoint(app, ownerToken, operatorToken, pointId, 10);          // -5 → 5
  expect((await issue(operatorToken, a, 3)).status).toBe(201);           // 5 → 2
  const toVoid = await issue(operatorToken, b, 2);                        // 2 → 0
  expect(toVoid.status).toBe(201);
  // Push the point negative again past the guard (legacy data): breakage on yesterday's shift.
  await ds.query(
    `UPDATE shifts SET broken_crates = broken_crates + 4 WHERE collection_point_id = $1 AND closed_at IS NOT NULL`,
    [pointId],
  );
  expect(await onHand(ds, pointId)).toBe(-4);
  await request(app.getHttpServer()).post('/crate-returns').set('Authorization', `Bearer ${operatorToken}`)
    .send({ supplier_id: a, units: 3 }).expect(201);                      // -4 → -1
  await request(app.getHttpServer()).post(`/crate-issuances/${toVoid.body.id}/void`)
    .set('Authorization', `Bearer ${operatorToken}`).send({ reason: 'помилка' }).expect(201); // -1 → 1
  expect(await onHand(ds, pointId)).toBe(1);
});

it('reopening a shift gives its breakage back', async () => {
  const { pointId, operatorToken } = await makePoint(app, ownerToken, 'heal-reopen');
  await stockPoint(app, ownerToken, operatorToken, pointId, 10);
  const [{ id }] = (await ds.query(`SELECT id FROM shifts WHERE collection_point_id = $1 AND closed_at IS NULL`, [pointId])) as { id: string }[];
  await request(app.getHttpServer()).post(`/shifts/${id}/close`).set('Authorization', `Bearer ${operatorToken}`)
    .send({ counted_amount: '0.00', broken_crates: 10 }).expect(201);
  expect(await onHand(ds, pointId)).toBe(0);
  await request(app.getHttpServer()).post(`/shifts/${id}/reopen`).set('Authorization', `Bearer ${ownerToken}`)
    .send({ reason: 'помилка' }).expect(201);
  expect(await onHand(ds, pointId)).toBe(10);
});

it('two concurrent issuances that fit alone but not together — exactly one wins', async () => {
  const { pointId, operatorToken } = await makePoint(app, ownerToken, 'race');
  const a = await makeSupplier(app, operatorToken);
  const b = await makeSupplier(app, operatorToken);
  await stockPoint(app, ownerToken, operatorToken, pointId, 10);
  const [ra, rb] = await Promise.all([issue(operatorToken, a, 10), issue(operatorToken, b, 10)]);
  expect([ra.status, rb.status].sort()).toEqual([201, 409]);
  expect(await onHand(ds, pointId)).toBe(0);
});

it('a concurrent issuance and a close with breakage — never both', async () => {
  const { pointId, operatorToken } = await makePoint(app, ownerToken, 'race-close');
  const sup = await makeSupplier(app, operatorToken);
  await stockPoint(app, ownerToken, operatorToken, pointId, 10);
  const [{ id }] = (await ds.query(`SELECT id FROM shifts WHERE collection_point_id = $1 AND closed_at IS NULL`, [pointId])) as { id: string }[];
  const [ri, rc] = await Promise.all([
    issue(operatorToken, sup, 6),
    request(app.getHttpServer()).post(`/shifts/${id}/close`).set('Authorization', `Bearer ${operatorToken}`)
      .send({ counted_amount: '0.00', broken_crates: 6 }),
  ]);
  expect([ri.status, rc.status]).toContain(409);
  expect(await onHand(ds, pointId)).toBeGreaterThanOrEqual(0);
});
```

Also add a void-receipt case to the `receipts` block: stock 12, a receipt with 12 crate tare (on_hand 0), then `SET broken` to push the point negative by SQL (as in `negativePoint`), void the receipt via `POST /intakes/:id/void` with `{ reason: 'x' }` → not 409, and `on_hand` rises by 12. Use the void body shape from `intakes/intake-crate-return.db-spec.ts:338`.

- [ ] **Step 2: Run them.** Run `npm run test:db -w backend -- crate-stock`. Expected: PASS. No production code changes in this task. A failure here is a real bug in Tasks 3–6: fix it there, do not weaken the test.

- [ ] **Step 3: Commit.**

```bash
git add backend/src/crate-stock/crate-stock.db-spec.ts
git commit -m "test(crates): a negative point still heals, and concurrent takers cannot both pass"
```

---

### Task 8: Stock the points of every existing db-spec the invariant now refuses

**Files:**
- Modify: whichever `backend/src/**/*.db-spec.ts` fail (candidates: `crates/crates.db-spec.ts`, `crates/crates-race.db-spec.ts`, `crates/crate-balances.db-spec.ts`, `crates/crate-standing.db-spec.ts`, `point-cash/point-cash.db-spec.ts`, `intakes/intake-crate-return.db-spec.ts`, `intakes/intake-paid-at-reception.db-spec.ts`, `intakes/intake-reception-race.db-spec.ts`, `testing/documents-pipeline.db-spec.ts`, `shifts/shift-close*.db-spec.ts`, `cash-counts/cash-count-recount.db-spec.ts`, `supplier-balance/allocation-write-paths.db-spec.ts`, `payouts/payout-cash-race.db-spec.ts`)

**Interfaces:**
- Consumes: `stockPoint` / `sendCrates` from `testing/crate-stock-fixture.ts`. Each spec keeps its own app boot; only the helpers that take `app` are used.

- [ ] **Step 1: Run the whole db suite and list the failures.** Run `npm run test:db -w backend 2>&1 | tee /tmp/db-after.txt; grep -E "✕|CRATES_ON_HAND_INSUFFICIENT|Tests:" /tmp/db-after.txt`. Record each failing spec and test.

- [ ] **Step 2: For each spec failing with `CRATES_ON_HAND_INSUFFICIENT` (or a 409 where it expected 201 on a crate write),** stock its point in `beforeAll`, right after its shift is opened:

```ts
import { stockPoint } from '../testing/crate-stock-fixture';
// …after the shift is opened:
// Spec 2026-09-30: empties must exist before crates can go out. 1000 is far above anything
// this spec issues, weighs or breaks, so no figure it asserts changes.
await stockPoint(app, ownerToken, operatorToken, pointId, 1000);
```

**Exception:** a spec that asserts an exact `on_hand`, `received`, `total` or `shortfall` (`crate-standing.db-spec.ts`, possibly `crate-balances`) must stock the exact amount its scenario implies, and each asserted figure must be re-derived by hand and commented. A spec that asserts cash (`point-cash`) must not change: the stocking transfer carries `cash: '0.00'`.

A failure that is NOT caused by the invariant (it failed on `main` too) is out of scope. Record it in the task report; do not fix it.

- [ ] **Step 3: Run the whole db suite again.** Run `npm run test:db -w backend`. Expected: every spec PASSES, or fails identically on `main` (prove it with `git stash && npm run test:db -w backend -- <spec>; git stash pop`).

- [ ] **Step 4: Commit.**

```bash
git add backend/src
git commit -m "test: stock each spec's point with empties before it takes crates"
```

---

### Task 9: The dev seed keeps every point at or above zero

**Files:**
- Modify: `backend/src/seed/dev-seed.db-spec.ts`
- Modify (only if Step 2 is red): `backend/src/seed/dev-seed.data.ts` (`SEED_TRANSFERS`)
- Modify: `backend/src/seed/dev-seed.history.ts` (header only)

**Interfaces:**
- Consumes: `onHandSql` (Task 1).

**Note for the spec reader:** generated history weighs only `Ящик` tare, and `SEED_TARE_TYPES` marks `Чешка` as the crate (`dev-seed.data.ts:191-194`). History therefore never takes empties, and its transfers only add them, so the generator needs no new logic. Only curated data can be red. The spec's «property 4 in the generator» becomes a stated property in the header, not code. The −763 seen at Шипинки in the local DB came from local edits after seeding, not from the seed.

- [ ] **Step 1: Write the failing assertion.** In `dev-seed.db-spec.ts`, next to the other whole-dataset invariants (e.g. «no seeded supplier balance is negative»):

```ts
it('leaves no seeded point with negative empties (spec 2026-09-30)', async () => {
  const rows = (await ds.query(
    `SELECT cp.code, ${onHandSql('cp.id')} AS on_hand FROM collection_points cp ORDER BY cp.code`,
  )) as { code: string; on_hand: number }[];
  expect(rows.filter((r) => r.on_hand < 0)).toEqual([]);
});
```

with `import { onHandSql } from '../crates/crate-balance.service';`.

- [ ] **Step 2: Run it.** Run `npm run test:db -w backend -- dev-seed`. If it is GREEN, skip to Step 4. If RED, the failure lists `{ code, on_hand }` for each negative point.

- [ ] **Step 3 (only if red): Fix curated data.** For each negative point, raise `crates` on that point's EARLIEST `accepted` entry in `SEED_TRANSFERS` by exactly `-on_hand` (or add one `accepted` entry on its first curated day with `cash: '0.00'` if it has none). Cash stays untouched, so the curated cash assertions hold. Re-run until green. Also re-run the curated crates assertions in the same file: any exact `on_hand`/`received` figure they pin moves by the same amount, and updating it is correct only when this step moved it.

- [ ] **Step 4: State the property** in `dev-seed.history.ts`'s header list, after property 4:

```
 * 5. EMPTIES THAT NEVER GO NEGATIVE (spec 2026-09-30). Generated receipts weigh `Ящик`, which is
 *    NOT the crate type (`SEED_TARE_TYPES`), and generated transfers only ADD crates, so history
 *    cannot take a point's empties below zero. Switching the history tare to the crate type
 *    would break that; `dev-seed.db-spec.ts` asserts it for every point.
```

- [ ] **Step 5: Run and commit.** Run `npm run test:db -w backend -- dev-seed` (expected PASS), then `npm test -w backend -- dev-seed` (expected PASS).

```bash
git add backend/src/seed
git commit -m "test(seed): no seeded point starts with negative empties"
```

---

### Task 10: Frontend — the refusal, translated, in all six forms

**Files:**
- Modify: `frontend/src/shared/lib/api-error/apiErrorToBanner.ts`, `frontend/src/shared/lib/api-error/index.ts`
- Test: `frontend/src/shared/lib/api-error/apiErrorToBanner.test.ts`
- Modify: `frontend/src/features/issue-crates/ui/IssueCratesDialog.tsx`, `frontend/src/features/count-shift/ui/CountDrawerDialog.tsx`, `frontend/src/features/void-document/ui/VoidDocumentDialog.tsx`, `frontend/src/features/resolve-transfer/ui/ResolveTransferDialog.tsx`
- Modify: `frontend/src/pages/reception/lib/apiErrorToFields.ts`, `frontend/src/pages/reception/ui/ReceptionPage.tsx`, `frontend/src/pages/reception/ui/TotalsSection.tsx`
- Modify: `frontend/src/shared/lib/i18n/locales/uk.json`, `en.json` (`crates.errors`)

**Interfaces:**
- Produces (from `@/shared/lib/api-error`):
  - `apiErrorParams(error: unknown): Record<string, number>` — numeric fields of the error body.
  - `interface BannerError { key: string; params: Record<string, number> }`
  - `toBannerError(error: unknown, fallback: string, overrides?: Readonly<Record<string, string>>): BannerError`
  - `onHandKey(error: unknown): string`
- `ApiFieldErrors` gains `formErrorParams?: Record<string, number>`.

- [ ] **Step 1: Write the failing tests** in `apiErrorToBanner.test.ts`:

```ts
import { apiErrorToBanner, apiErrorParams, toBannerError } from './apiErrorToBanner';

const onHand = (inTransit: number) =>
  new ApiError(409, 'Request failed', undefined, 'CRATES_ON_HAND_INSUFFICIENT', {
    code: 'CRATES_ON_HAND_INSUFFICIENT', available: 5, required: 15, in_transit: inTransit, message: 'x',
  });

describe('CRATES_ON_HAND_INSUFFICIENT', () => {
  it('maps to the plain sentence when nothing is in transit', () => {
    expect(apiErrorToBanner(onHand(0), 'crates.errors.issueFailed')).toBe('crates.errors.onHandInsufficient');
  });
  it('points at the transfer in transit when there is one', () => {
    expect(apiErrorToBanner(onHand(20), 'crates.errors.issueFailed')).toBe('crates.errors.onHandInsufficientInTransit');
  });
  it('carries the numbers for interpolation, and only the numbers', () => {
    expect(apiErrorParams(onHand(20))).toMatchObject({ available: 5, required: 15, in_transit: 20 });
    expect(apiErrorParams(onHand(20))).not.toHaveProperty('message');
  });
  it('toBannerError bundles both', () => {
    expect(toBannerError(onHand(0), 'x')).toEqual({
      key: 'crates.errors.onHandInsufficient',
      params: expect.objectContaining({ available: 5, required: 15 }),
    });
  });
  it('has no params for a non-ApiError', () => expect(apiErrorParams(new Error('down'))).toEqual({}));
});
```

(Check `ApiError`'s constructor order in `shared/api/client.ts:30-47`, `(status, message, details?, code?, payload?)`, and adjust the helper if it differs.)

- [ ] **Step 2: Run them and watch them fail.** Run `npm test -w frontend -- apiErrorToBanner`. Expected: FAIL, exports missing.

- [ ] **Step 3: Implement** in `apiErrorToBanner.ts`. Change the import to `import { ApiError, apiErrorCode } from '@/shared/api';` and add:

```ts
/** Spec 2026-09-30 — the one code whose sentence depends on a FIELD, not the endpoint: with a
 *  transfer in transit the operator's fix is «Прийняв», not a smaller number. */
export function onHandKey(error: unknown): string {
  const inTransit = error instanceof ApiError ? error.payload?.in_transit : undefined;
  return typeof inTransit === 'number' && inTransit > 0
    ? 'crates.errors.onHandInsufficientInTransit'
    : 'crates.errors.onHandInsufficient';
}

/** The error body's numeric context fields, for `t(key, params)`. */
export function apiErrorParams(error: unknown): Record<string, number> {
  if (!(error instanceof ApiError) || !error.payload) return {};
  return Object.fromEntries(
    Object.entries(error.payload).filter((e): e is [string, number] => typeof e[1] === 'number'),
  );
}

export interface BannerError {
  key: string;
  params: Record<string, number>;
}

export function toBannerError(
  error: unknown,
  fallback: string,
  overrides?: Readonly<Record<string, string>>,
): BannerError {
  return { key: apiErrorToBanner(error, fallback, overrides), params: apiErrorParams(error) };
}
```

In `apiErrorToBanner`, right after `if (!code) return fallback;`: `if (code === 'CRATES_ON_HAND_INSUFFICIENT') return onHandKey(error);`.

Export all four (and the type) from `index.ts`. Run `npm test -w frontend -- apiErrorToBanner`. Expected: PASS.

- [ ] **Step 4: Add the copy.** In `uk.json` under `crates.errors`, next to `cashInsufficient`:

```json
"onHandInsufficient": "На точці {{available}} пустих ящиків, а ця операція забирає {{required}}.",
"onHandInsufficientInTransit": "На точці {{available}} пустих ящиків, а ця операція забирає {{required}}. У дорозі ще {{in_transit}} ящ. — спершу натисніть «Прийняв» у Касі точки.",
```

In `en.json` at the same path:

```json
"onHandInsufficient": "The point has {{available}} empty crates, and this takes {{required}}.",
"onHandInsufficientInTransit": "The point has {{available}} empty crates, and this takes {{required}}. {{in_transit}} more are in transit — press «Accepted» in Point cash first.",
```

(Use the exact English label of the accept button from `en.json`'s transfer keys in place of «Accepted» if it differs.)

- [ ] **Step 5: Switch the four dialogs to `BannerError`.** In each of `IssueCratesDialog.tsx`, `CountDrawerDialog.tsx`, `VoidDocumentDialog.tsx`, `ResolveTransferDialog.tsx`:
  - `useState<string | null>(null)` for `formError` → `useState<BannerError | null>(null)`.
  - `setFormError(apiErrorToBanner(error, X, Y))` → `setFormError(toBannerError(error, X, Y))`.
  - Any other `setFormError('some.key')` → `setFormError({ key: 'some.key', params: {} })`.
  - `{t(formError)}` → `{t(formError.key, formError.params)}`.
  - Imports: `apiErrorToBanner` → `toBannerError, type BannerError`.

Confirm that crate-return voids reach `VoidDocumentDialog`: `grep -rn "VoidDocumentDialog" frontend/src/pages/crates`. If `PersonCrateDocs` uses another dialog, apply the same change there.

- [ ] **Step 6: Reception.**
  - `apiErrorToFields.ts`: add `formErrorParams?: Record<string, number>;` to `ApiFieldErrors`, import `onHandKey, apiErrorParams` from `@/shared/lib/api-error`, and in `apiErrorToFields` right before `const banner = BANNER[error.code];`:
    ```ts
    if (error.code === 'CRATES_ON_HAND_INSUFFICIENT') {
      return { fieldErrors: [], formErrorKey: onHandKey(error), formErrorParams: apiErrorParams(error) };
    }
    ```
  - `ReceptionPage.tsx` (~line 183): alongside `formErrorKey`, derive `const formErrorParams = serverErrors?.formErrorParams;` and pass `formErrorParams={formErrorParams}` to `TotalsSection` (~line 522).
  - `TotalsSection.tsx`: add prop `formErrorParams?: Record<string, number>;` and render `{t(formErrorKey, formErrorParams)}`.
  - Add a test to the existing `apiErrorToFields` test file (same folder):
    ```ts
    it('maps CRATES_ON_HAND_INSUFFICIENT to a banner carrying the numbers', () => {
      const e = new ApiError(409, 'x', undefined, 'CRATES_ON_HAND_INSUFFICIENT', { available: 0, required: 12, in_transit: 0 });
      expect(apiErrorToFields(e, 1)).toEqual({
        fieldErrors: [], formErrorKey: 'crates.errors.onHandInsufficient',
        formErrorParams: { available: 0, required: 12, in_transit: 0 },
      });
    });
    ```

- [ ] **Step 7: Run everything frontend.** Run `npm test -w frontend` and `npm run build -w frontend`. Expected: PASS and a clean build. Pre-existing dialog tests that asserted `t(formError)` text keep passing, because the keys are unchanged.

- [ ] **Step 8: Commit.**

```bash
git add frontend/src
git commit -m "feat(frontend): say how many empties the point has when a crates write is refused"
```

---

### Task 11: Frontend — «На точці N пустих» in the issue dialog

**Files:**
- Modify: `frontend/src/entities/crate/model/crate.ts` (`CrateStanding.in_transit`)
- Modify: `frontend/src/features/issue-crates/ui/IssueCratesDialog.tsx`
- Test: `frontend/src/features/issue-crates/ui/IssueCratesDialog.test.tsx`
- Modify: `uk.json`, `en.json` (`crates.issue.*`, `crates.errors.overOnHand`)

**Interfaces:**
- Consumes: `useCrateStandingQuery({ pointId, isOwner })` from `@/entities/crate`. `CrateStanding.in_transit` (backend Task 1).

- [ ] **Step 1: Write the failing tests.** In `IssueCratesDialog.test.tsx`, add a hoisted `standingMock` and mock the entity (the dialog will now import a hook from it):

```ts
const { issueMock, suppliersMock, standingMock } = vi.hoisted(() => ({
  issueMock: vi.fn(), suppliersMock: vi.fn(), standingMock: vi.fn(),
}));
vi.mock('@/entities/crate', () => ({ useCrateStandingQuery: (a: unknown) => standingMock(a) }));
// in beforeEach:
standingMock.mockReturnValue({ data: { on_hand: 100, in_transit: 0 } });
```

New tests:

```ts
it('shows how many empties the point has', () => {
  standingMock.mockReturnValue({ data: { on_hand: 7, in_transit: 0 } });
  open();
  expect(screen.getByText(/7 empty crates at the point/i)).toBeInTheDocument();
});

it('refuses more than the point has, before asking the server', async () => {
  standingMock.mockReturnValue({ data: { on_hand: 7, in_transit: 0 } });
  const user = userEvent.setup();
  open();
  await user.selectOptions(screen.getByLabelText('Person'), 's1');
  await user.type(screen.getByLabelText('Crates'), '8');
  await user.click(screen.getByRole('button', { name: /^issue$/i }));
  expect(await screen.findByText(/more than the point has/i)).toBeInTheDocument();
  expect(issueMock).not.toHaveBeenCalled();
});

it('with no empties, disables Issue and points at the transfer in transit', () => {
  standingMock.mockReturnValue({ data: { on_hand: 0, in_transit: 20 } });
  open();
  expect(screen.getByRole('button', { name: /^issue$/i })).toBeDisabled();
  expect(screen.getByText(/20 in transit/i)).toBeInTheDocument();
});

it('reads the OWNER-picked point', () => {
  open('p1');
  expect(standingMock).toHaveBeenCalledWith({ pointId: 'p1', isOwner: true });
});
```

- [ ] **Step 2: Run them and watch them fail.** Run `npm test -w frontend -- IssueCratesDialog`. Expected: the new tests FAIL.

- [ ] **Step 3: Add `in_transit`** to `CrateStanding` in `entities/crate/model/crate.ts`: `/** Σ crates of `sent` transfers — on their way, not yet empties. */ in_transit: number;`. Fix any test fixture typed `CrateStanding` that now lacks it (`grep -rn "on_hand:" frontend/src --include=*.test.tsx`).

- [ ] **Step 4: Implement** in `IssueCratesDialog.tsx`:

```ts
import { useCrateStandingQuery, type CrateIssuanceMode } from '@/entities/crate';
// …
const standing = useCrateStandingQuery({ pointId: pointId ?? null, isOwner: Boolean(pointId) });
const onHand = standing.data?.on_hand;
const inTransit = standing.data?.in_transit ?? 0;
const noneLeft = onHand !== undefined && onHand <= 0;
```

On the units field:

```ts
{...register('units', {
  ...cratesRules('crates.errors.unitsFormat'),
  // A hint, not the rule: the server's CrateStockGuard is the final word (spec 2026-09-30).
  validate: (v) =>
    onHand === undefined || Number.parseInt(v.trim(), 10) <= onHand || 'crates.errors.overOnHand',
})}
```

(If `cratesRules` already returns a `validate`, merge: `validate: { ...(rules.validate as object), onHand: … }`.)

Under the units `Field`:

```tsx
{onHand !== undefined ? (
  <p className={noneLeft ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
    {t('crates.issue.onHandHint', { on_hand: onHand })}
    {inTransit > 0 ? ` ${t('crates.issue.inTransitHint', { in_transit: inTransit })}` : null}
  </p>
) : null}
```

And the submit button: `disabled={isSubmitting || noneLeft}`.

- [ ] **Step 5: Copy.** `uk.json`:
  - `crates.issue.onHandHint`: `"На точці {{on_hand}} пустих ящиків."`
  - `crates.issue.inTransitHint`: `"У дорозі ще {{in_transit}} — спершу прийміть переказ."`
  - `crates.errors.overOnHand`: `"Більше, ніж пустих на точці."`

  `en.json`:
  - `onHandHint`: `"{{on_hand}} empty crates at the point."`
  - `inTransitHint`: `"{{in_transit}} in transit — accept the transfer first."`
  - `overOnHand`: `"More than the point has empty."`

  (The test regex `/more than the point has/i` matches it.)

- [ ] **Step 6: Run everything frontend.** Run `npm test -w frontend` and `npm run build -w frontend`. Expected: PASS and a clean build. If another test renders `IssueCratesDialog` without mocking `@/entities/crate` (e.g. `CratesPage.test.tsx`), give it the same mock.

- [ ] **Step 7: Commit.**

```bash
git add frontend/src
git commit -m "feat(crates): show the empties at the point in the issue dialog and cap the count"
```

---

### Task 12: Rules, schema note, follow-ups

**Files:**
- Modify: `26-rules-by-example.md` (§6.9, after its «→ **Правило:**» line)
- Modify: `28-db-schema.dbml` (`crate_issuances` Note)
- Modify: `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md` (append)
- Modify: `CLAUDE.md` (Architecture → Documents bullet: one sentence)

- [ ] **Step 1: §6.9 amendment.** Append after `→ **Правило:** система показує факт, а не спиняє день заднім числом. `[ЯЩ-33, ЯЩ-34, КС-45]``:

```markdown
→ **Правка (2026-09-30, інваріант пустих ящиків):** «пустих на точці» більше **не буває менше
нуля** через новий документ. Текст вище писався під формулу від наділу («наділ − у людей − з
ягодою»); тепер пусті рахуються від документів — отримано переказами − видано + повернуто −
ящики-тара на квитанціях − бій, — і мінус означає не «наділ пробито», а видачу ящиків, яких за
документами на точці немає. Тому операцію, що забирає більше пустих, ніж є, система **відхиляє**:
видачу, бій при закритті, квитанцію з ящиковою тарою, сторно переказу, врегулювання спору на
меншу кількість і сторно повернення. Операції, що ящики повертають, дозволені завжди — навіть
на точці, яка вже в мінусі від старих даних. Якщо на точку їде переказ, відмова каже спершу
натиснути «Прийняв». Червоне попередження на екрані лишається лише для даних, записаних до
цієї правки. Специфікація: `docs/superpowers/specs/2026-09-30-yagoda-crates-on-hand-invariant.md`.
```

- [ ] **Step 2: DBML.** In `28-db-schema.dbml`, inside `Table crate_issuances { … Note: '''…''' }`, append one paragraph:

```
Empties at the point (`onHandSql`) never go below zero through a new document: an issuance,
breakage, a receipt's crate tare, voiding a transfer or a return, and resolving a dispute
downwards are refused past zero by `CrateStockGuard` (spec 2026-09-30). Documents that give
crates back are never refused.
```

- [ ] **Step 3: Follow-ups.** Append to `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md`:

```markdown
## From the crates on-hand invariant (2026-09-30)

- **`tare_types.is_crate` toggle** is an eighth path below zero: moving the single crate flag onto
  a tare type already on receipts reclassifies history at every point at once. Candidate: refuse
  the toggle once the type is on any live receipt.
- **Up-front hints** in the void-transfer, resolve-dispute and close-shift dialogs (e.g. «з цього
  переказу вже видано 15»); today they learn of the guard only from the 409.
```

- [ ] **Step 4: CLAUDE.md.** In the Architecture «Documents» bullet, add one sentence at the end: `Empties at a point never go below zero through a new document: \`CrateStockGuard\` (\`backend/src/crate-stock/\`) refuses the six writes that take crates, never the ones that give them back.`

- [ ] **Step 5: Commit.**

```bash
git add 26-rules-by-example.md 28-db-schema.dbml docs/superpowers/2026-09-05-foundation-slice-follow-ups.md CLAUDE.md
git commit -m "docs: §6.9 amendment — empties at a point never go below zero"
```

---

### Task 13: Verify, re-run the seven cases in the browser, clean up

**Files:**
- Modify: `docs/manual-testing/2026-09-30-crates-negative-on-hand.md` (new section «Після виправлення»)
- Create: `docs/manual-testing/2026-09-30-crates-negative-on-hand/after-case{1..7}.png`

- [ ] **Step 1: Full verification.** Run `npm run verify:full`. Paste its verdict line into the task report and name every SKIPPED row. Any red row is fixed in the owning task's files, never by widening a baseline.

- [ ] **Step 2: Restart the dev stack** so the running backend has the change: `docker compose up -d --build backend frontend`, then wait for `curl -s localhost:3000/health/ready` to report `"status":"ok"`.

- [ ] **Step 3: Re-run the seven browser cases.** The Playwright scripts from the manual test live in the session scratchpad (`ui/scripts/lib.mjs`, `case*.mjs`). Copy them to a temporary `.ui/` folder at the repo root (Playwright resolves from the repo's `node_modules`). Use new point codes `AF1`…`AF7` (replace `BR` in each script). Expected per case: the step that went negative now shows the Ukrainian refusal and nothing is recorded; `standing()` reports «Пустих» ≥ 0. In case 1, «Видати» is disabled because the point has 0 empties: record that as the outcome. Save each final screenshot as `after-caseN.png`.

- [ ] **Step 4: Write «Після виправлення»** in the report: a table with case, what the UI said, and «Пустих» after, linking the screenshots.

- [ ] **Step 5: Clean up.**
  - `rm -rf .ui` at the repo root. Delete the scratchpad scripts.
  - Remove the test points `NEG1…NEG7`, `BR1…BR7`, `AF1…AF7` and everything hanging off them from the LOCAL dev DB (never any other). Delete in dependency order inside one transaction: allocations → returns → issuances → intake tare/items/intakes → payouts → top-ups → transfers → cash counts → shifts → grade prices → suppliers → user identities/credentials/users → the points. Check first with `SELECT` counts, and confirm with the user before running the DELETE.
  - `git status` shows only intended files.

- [ ] **Step 6: Commit.**

```bash
git add docs/manual-testing
git commit -m "docs(manual-testing): the seven cases after the fix — each one refused"
```

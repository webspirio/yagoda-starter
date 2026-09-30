# Crates Standing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the «Ящики» screen to mock parity — a server-computed allotment breakdown (on hand / with people / at base) and a per-person document drill-down with server-hinted voids.

**Architecture:** One new read endpoint `GET /crate-standing` in the existing `crates` module, computed in one SQL query whose fragments live beside `crateBookSql`; three additive response-contract changes in the same module. The frontend adds `useCrateStandingQuery` to `entities/crate` and three page-local components under `pages/crates/ui/`.

**Tech Stack:** NestJS 11 + TypeORM (raw SQL via `DataSource.query`), Postgres, Jest (`*.spec.ts` unit, `*.db-spec.ts` real Postgres); React 19, TanStack Query v5, Vitest + Testing Library, i18next.

**Spec:** `docs/superpowers/specs/2026-09-23-yagoda-crates-standing.md`

## Global Constraints

- Branch `feat/crates-standing` in the main checkout (already created; spec committed as `4854488`). No worktree.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- No migration, no new table.
- `allotment` / `on_hand` are `null` for «не задано» — never `0`. UI prints «—».
- `on_hand` MAY be negative (§6.9) — rendered red, never clamped in the number (only the bar width clamps at 0).
- Crate counts are integers; money (`deposit_held`) is a 2-decimal string computed by Postgres, never summed in JS.
- Every `SUM(...)` over an int column is cast `::int` (uncast is int8 → string from node-postgres).
- Voided documents are excluded from every figure; transfer crates use point-cash's three-way CASE with the void filter in the OUTER `WHERE`.
- Frontend tests run in English (`test-setup.ts`); Ukrainian plurals need an explicit `i18n.changeLanguage('uk')`.
- Vitest does not typecheck — run `npx tsc -b` in `frontend/` before claiming a frontend task done.
- Never `git checkout --`/`git restore` a frontend file; undo surgically.
- Ratchets turn one way: no eslint suppression, no baseline widening.

## Review Focus

1. **Owner with no point chosen** — `/crate-standing` without `collection_point_id` as owner must 400 (`POINT_REQUIRED`), and the page must not fire the request at all (`enabled` gate). Pinned in Task 2 (unit) and Task 5 (hook).
2. **Operator passing another point's id** — silently pinned to their own point, never another point's figures. Pinned in Task 2 (unit + db).
3. **A disputed transfer that is later voided** — must contribute nothing even though it has `resolved_crates`. Pinned in Task 2 db-spec.
4. **Point with issuances but no allotment and zero at base** — bar renders with «—» for allotment and on-hand, no identity line, no NaN widths. Pinned in Task 6.
5. **Operator on a closed-shift document** — no void button (the server would 403); owner sees it. Pinned in Task 8.

---

## File map

Backend (`backend/src/crates/`):
- Modify `crate-balance.service.ts` — add `crateTareUnitsSql`, `transferCratesSql` next to `crateBookSql`.
- Modify `crate-dispatch.service.ts` — read `crateTareUnitsSql`.
- Create `dto/crate-standing.query.ts`, `crate-standing.service.ts`, `crate-standing.controller.ts`, `crate-standing.service.spec.ts`, `crate-standing.db-spec.ts`.
- Modify `crates.module.ts` — register service + controller.
- Modify `crate-balances.service.ts` + `crate-balances.db-spec.ts` — `deposit_units`, `receipt_units`.
- Modify `crate-issuance.mapper.ts`, `crate-return.mapper.ts`, `crate-balance.service.ts` (list methods), `crates.service.ts` (3 call sites), `dto/list-crate-issuances.query.ts`, `dto/list-crate-returns.query.ts`, `crates.db-spec.ts` — `shift_closed`, `has_live_returns`, `include_voided`.
- Modify `backend/eslint.config.mjs` — add `src/crates/crate-standing.service.ts` to the money `files` array (it returns `deposit_held`).

Frontend (`frontend/src/`):
- Modify `entities/crate/model/crate.ts`, `entities/crate/api/useCrates.ts`, `entities/crate/index.ts`; create `entities/crate/api/useCrates.test.tsx`.
- Create `pages/crates/ui/CrateStandingBar.tsx` (+ test), `pages/crates/ui/InFieldTable.tsx` (+ test), `pages/crates/ui/PersonCrateDocs.tsx` (+ test).
- Modify `pages/crates/ui/CratesPage.tsx`, `pages/crates/ui/CratesPage.test.tsx`.
- Modify `shared/lib/i18n/locales/en.json`, `uk.json`.

Docs: `frontend/CLAUDE.md` (entities/crate + pages/crates lines), `CLAUDE.md` (no change needed unless a count moves), `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md` (one follow-up).

---

### Task 1: Shared crate SQL fragments; dispatch reads them

**Files:**
- Modify: `backend/src/crates/crate-balance.service.ts` (after `crateBookSql`, ~line 65)
- Modify: `backend/src/crates/crate-dispatch.service.ts:55-66`
- Test: existing `backend/src/crates/crate-dispatch.service.spec.ts`, `backend/src/crates/crates.db-spec.ts` («counts only crate tare on live intakes»)

**Interfaces:**
- Produces:
  - `export const crateTareUnitsSql = (where: string): string` — a parenthesised scalar subquery yielding `int`: Σ `intake_item_tare_types.units` for `is_crate` tare on live intakes, where `where` is a SQL predicate over aliases `i` (intakes) and `sh` (the intake's shift).
  - `export const transferCratesSql = (pointExpr: string): string` — parenthesised scalar `int`: the point-cash three-way crates reading of non-voided transfers to `pointExpr`.

- [ ] **Step 1: Add the fragments** below `crateBookSql` in `crate-balance.service.ts`:

```ts
/**
 * CRATES ON RECEIPTS — the ONE place that knows `is_crate` selects the crate
 * tare. §6.8's «з ягодою» for one shift (`CrateDispatchService`) and the
 * point-lifetime «у нас з ягодою» (`CrateStandingService`) both read it, so the
 * two cannot drift. `where` is a predicate over `i` (intakes) and `sh` (the
 * intake's shift) — an SQL naming, never a request value.
 */
export const crateTareUnitsSql = (where: string): string => `(
    SELECT COALESCE(SUM(itt.units), 0)::int
      FROM intake_item_tare_types itt
      JOIN intake_items ii ON ii.id = itt.item_id
      JOIN intakes i       ON i.id = ii.intake_id
      JOIN shifts sh       ON sh.id = i.shift_id
      JOIN tare_types tt   ON tt.id = itt.tare_type_id
     WHERE ${where}
       AND i.voided_at IS NULL
       AND tt.is_crate
)`;

/**
 * CRATES BROUGHT BACK TO A POINT BY TRANSFER — the same three-way reading
 * `point-cash`'s `movementsSql` gives the cash on the same rows (09.09.2026
 * client ruling): accepted → `crates`; disputed and resolved →
 * `resolved_crates`; disputed and open → the point's own `reported_crates`.
 * `sent` moves nothing. The void filter sits in the OUTER `WHERE` so a
 * resolved-then-voided transfer counts for nothing — voided wins.
 */
export const transferCratesSql = (pointExpr: string): string => `(
    SELECT COALESCE(SUM(CASE
             WHEN t.status = 'accepted' THEN t.crates
             WHEN t.status = 'disputed' AND t.resolved_at IS NOT NULL THEN t.resolved_crates
             WHEN t.status = 'disputed' THEN t.reported_crates
           END), 0)::int
      FROM transfers t
     WHERE t.collection_point_id = ${pointExpr}
       AND t.voided_at IS NULL
)`;
```

- [ ] **Step 2: Point dispatch at the fragment.** In `crate-dispatch.service.ts` add `import { crateTareUnitsSql } from './crate-balance.service';` and replace the query string:

```ts
    const rows: Array<{ with_berry: number }> = await this.dataSource.manager.query(
      `SELECT ${crateTareUnitsSql('i.shift_id = $1')} AS with_berry`,
      [shiftId],
    );
```

Update the class doc's «Putting this query in `shifts/` would make `shifts/` the second module that knows how `is_crate` selects a tare type» paragraph to add: «The selector itself is `crateTareUnitsSql` in `crate-balance.service.ts`, shared with the point standing.»

- [ ] **Step 3: Run the dispatch unit spec**

Run: `cd backend && npx jest src/crates/crate-dispatch.service.spec.ts`
Expected: PASS. If a test asserted the literal SQL text, update it to assert `toContain('tt.is_crate')` and `toContain('i.shift_id = $1')` instead.

- [ ] **Step 4: Run the crates db-spec** (needs the dev Postgres from `docker compose up postgres`)

Run: `cd backend && npm run test:db -- src/crates/crates.db-spec.ts`
Expected: PASS, including «counts only crate tare on live intakes».

- [ ] **Step 5: Commit**

```bash
git add backend/src/crates/crate-balance.service.ts backend/src/crates/crate-dispatch.service.ts backend/src/crates/crate-dispatch.service.spec.ts
git commit -m "refactor(crates): share the crate-tare and transfer-crates SQL fragments

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `GET /crate-standing`

**Files:**
- Create: `backend/src/crates/dto/crate-standing.query.ts`
- Create: `backend/src/crates/crate-standing.service.ts`
- Create: `backend/src/crates/crate-standing.controller.ts`
- Create: `backend/src/crates/crate-standing.service.spec.ts`
- Create: `backend/src/crates/crate-standing.db-spec.ts`
- Modify: `backend/src/crates/crates.module.ts`
- Modify: `backend/eslint.config.mjs` (money `files` array, after `'src/crates/crate-balance.service.ts'`)
- Modify: `docs/superpowers/specs/2026-09-23-yagoda-crates-standing.md` §3 `in_field` row

**Interfaces:**
- Consumes: `crateBookSql`, `crateTareUnitsSql`, `transferCratesSql` (Task 1); `resolvePointFilter(actor, requested?)` from `../auth/access/point-scope`.
- Produces: `CrateStandingService.forPoint(actor: AuthenticatedUser, query: CrateStandingQueryDto): Promise<CrateStandingResponse>`; route `GET /crate-standing?collection_point_id=<uuid>`;

```ts
export interface CrateStandingResponse {
  collection_point_id: string;
  allotment: number | null;
  in_field: number;
  deposit_units: number;
  deposit_held: string;
  at_base: number;
  on_hand: number | null;
  shortfall: number;
}
```

- [ ] **Step 1: Write the failing unit spec** `crate-standing.service.spec.ts`:

```ts
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CrateStandingService } from './crate-standing.service';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

const POINT_A = '11111111-1111-1111-1111-111111111111';
const POINT_B = '22222222-2222-2222-2222-222222222222';

const owner = { sub: 'o', role: UserRole.NetworkOwner, collection_point_id: null } as unknown as AuthenticatedUser;
const operatorAtA = { sub: 'p', role: UserRole.PointOperator, collection_point_id: POINT_A } as unknown as AuthenticatedUser;
const scopeless = { sub: 'x', role: UserRole.PointOperator, collection_point_id: null } as unknown as AuthenticatedUser;

const ROW = {
  collection_point_id: POINT_A,
  allotment: 800,
  in_field: 195,
  deposit_units: 115,
  deposit_held: '13800.00',
  at_base: 264,
  on_hand: 341,
  shortfall: 459,
};

describe('CrateStandingService', () => {
  let ds: { query: jest.Mock };
  let service: CrateStandingService;

  beforeEach(() => {
    ds = { query: jest.fn().mockResolvedValue([ROW]) };
    service = new CrateStandingService(ds as never);
  });

  it('pins an operator to their own point and IGNORES a requested one', async () => {
    await service.forPoint(operatorAtA, { collection_point_id: POINT_B });
    expect(ds.query.mock.calls[0][1]).toEqual([POINT_A]);
  });

  it('serves an owner the point they ask for', async () => {
    await expect(service.forPoint(owner, { collection_point_id: POINT_A })).resolves.toEqual(ROW);
    expect(ds.query.mock.calls[0][1]).toEqual([POINT_A]);
  });

  /** A standing is ONE point's — there is no network-wide allotment. */
  it('refuses an owner who names no point', async () => {
    await expect(service.forPoint(owner, {})).rejects.toBeInstanceOf(BadRequestException);
    expect(ds.query).not.toHaveBeenCalled();
  });

  it('refuses an operator with no point assigned', async () => {
    await expect(service.forPoint(scopeless, {})).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('404s an unknown point', async () => {
    ds.query.mockResolvedValue([]);
    await expect(service.forPoint(owner, { collection_point_id: POINT_B })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd backend && npx jest src/crates/crate-standing.service.spec.ts`
Expected: FAIL — `Cannot find module './crate-standing.service'`.

- [ ] **Step 3: Write the DTO** `dto/crate-standing.query.ts`:

```ts
import { IsOptional, IsUUID } from 'class-validator';

/**
 * Optional at the DTO so an operator can omit it (the server pins them from
 * their token); REQUIRED for an owner, which the service enforces — a
 * standing is one point's, and there is no network-wide allotment to answer
 * with.
 */
export class CrateStandingQueryDto {
  @IsOptional()
  @IsUUID()
  collection_point_id?: string;
}
```

- [ ] **Step 4: Write the service** `crate-standing.service.ts`:

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { crateBookSql, crateTareUnitsSql, transferCratesSql } from './crate-balance.service';
import { CrateIssuanceMode } from './crate-issuance-mode.enum';
import { CrateStandingQueryDto } from './dto/crate-standing.query';
import { resolvePointFilter } from '../auth/access/point-scope';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

export interface CrateStandingResponse {
  collection_point_id: string;
  /** `collection_points.target_crates` — `null` is «не задано», never 0. */
  allotment: number | null;
  in_field: number;
  /** Of `in_field`, the units out on a deposit (the rest are on a розписка). */
  deposit_units: number;
  /** The point's crates book — `crateBookSql`, not re-derived. */
  deposit_held: string;
  at_base: number;
  /** `allotment − in_field − at_base`; `null` when `allotment` is; MAY be < 0 (§6.9). */
  on_hand: number | null;
  shortfall: number;
}

/**
 * §6.8's 20:40 block — «800 = 341 порожніх + 195 у людей + 264 на базі» —
 * for ONE point, point-lifetime, every figure computed by Postgres.
 *
 * `in_field` AND `deposit_units` USE THE OPEN-TRANCHE DEFINITION
 * `/crate-balances` uses (units issued minus units allocated to live returns),
 * so this total and the sum of that list cannot disagree; the db-spec pins it.
 *
 * `at_base` = crates on live receipts across ALL the point's shifts, the open
 * one included (§6.8's 20:40 example counts today's 142 before the 20:55
 * close) + recorded breakage − crates brought back by transfer. NOTHING IS
 * SNAPSHOTTED: voiding an old receipt moves it silently — the same
 * `crate_shipments` gap `CrateDispatchService` names. A closed shift whose
 * `broken_crates` is NULL (history older than the column) adds 0.
 */
@Injectable()
export class CrateStandingService {
  constructor(private readonly dataSource: DataSource) {}

  async forPoint(
    actor: AuthenticatedUser,
    query: CrateStandingQueryDto,
  ): Promise<CrateStandingResponse> {
    const pointId = resolvePointFilter(actor, query.collection_point_id);
    if (!pointId) {
      throw new BadRequestException({
        message: 'collection_point_id is required',
        code: 'POINT_REQUIRED',
      });
    }

    const rows: CrateStandingResponse[] = await this.dataSource.query(
      `WITH tranche AS (
         SELECT ci.mode,
                (ci.units - COALESCE((
                    SELECT SUM(a.units)
                      FROM crate_return_allocations a
                      JOIN crate_returns cr ON cr.id = a.return_id
                     WHERE a.issuance_id = ci.id
                       AND cr.voided_at IS NULL), 0))::int AS remaining_units
           FROM crate_issuances ci
           JOIN shifts s ON s.id = ci.shift_id
          WHERE s.collection_point_id = $1
            AND ci.voided_at IS NULL
       ),
       figures AS (
         SELECT cp.id AS collection_point_id,
                cp.target_crates AS allotment,
                (SELECT COALESCE(SUM(remaining_units), 0)::int FROM tranche) AS in_field,
                (SELECT COALESCE(SUM(remaining_units), 0)::int FROM tranche
                  WHERE mode = '${CrateIssuanceMode.Deposit}'::crate_issuance_mode) AS deposit_units,
                ${crateBookSql('$1')}::text AS deposit_held,
                (${crateTareUnitsSql('sh.collection_point_id = $1')}
                 + (SELECT COALESCE(SUM(bs.broken_crates), 0)::int
                      FROM shifts bs WHERE bs.collection_point_id = $1)
                 - ${transferCratesSql('$1')})::int AS at_base
           FROM collection_points cp
          WHERE cp.id = $1
       )
       SELECT f.*,
              CASE WHEN f.allotment IS NULL THEN NULL
                   ELSE f.allotment - f.in_field - f.at_base END AS on_hand,
              (f.in_field + f.at_base) AS shortfall
         FROM figures f`,
      [pointId],
    );

    const row = rows[0];
    if (!row) throw new NotFoundException('Collection point not found');
    return row;
  }
}
```

Note: `CrateIssuanceMode.Deposit` is an enum literal compiled into the SQL, not a request value. Confirm the enum member is named `Deposit` (`crate-issuance-mode.enum.ts`); if it is spelled differently, use that name.

- [ ] **Step 5: Write the controller** `crate-standing.controller.ts`:

```ts
import { Controller, Get, Query } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CrateStandingService, CrateStandingResponse } from './crate-standing.service';
import { CrateStandingQueryDto } from './dto/crate-standing.query';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * The «Ящики» screen's allotment bar. Its own noun rather than a block on
 * `/crate-balances`: that is a paginated per-supplier list, this is one
 * point's aggregate. Both roles — §6.10 gives the operator «склад цільового
 * значення» of their own point; the scope is the service's to decide.
 */
@Controller('crate-standing')
export class CrateStandingController {
  constructor(private readonly standing: CrateStandingService) {}

  @Get()
  @Auth()
  get(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: CrateStandingQueryDto,
  ): Promise<CrateStandingResponse> {
    return this.standing.forPoint(actor, query);
  }
}
```

- [ ] **Step 6: Register** in `crates.module.ts`: import both, add `CrateStandingService` to `providers` and `CrateStandingController` to `controllers`.

- [ ] **Step 7: Add to the money guard.** In `backend/eslint.config.mjs`, after `'src/crates/crate-balance.service.ts',` add `'src/crates/crate-standing.service.ts',`.

- [ ] **Step 8: Run the unit spec**

Run: `cd backend && npx jest src/crates/crate-standing.service.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 9: Write the db-spec** `crate-standing.db-spec.ts`. It builds the §6.8 day at a fresh point and pins every definition:

```ts
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { CrateStandingService } from './crate-standing.service';
import { CrateBalancesService } from './crate-balances.service';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * `GET /crate-standing` against a real Postgres — the §6.8 20:40 day:
 * allotment 800 = 341 empty + 195 with people + 264 at base.
 *
 * Composition of the 264 at base, built below:
 *   yesterday (closed): 120 crates on receipts + 2 broken   = 122
 *   today (OPEN):       142 crates on receipts               = 142
 *   plus noise that must NOT count: 30 «Чешка» (not a crate), a voided
 *   receipt with 50 crates, a `sent` transfer of 40.
 *   plus transfers that DO net out to zero: accepted 10, disputed+resolved
 *   (resolved 6), disputed open (reported 4) = −20; and 20 extra crates on a
 *   closed shift receipt, so 122 + 142 + 20 − 20 = 264.
 *   A voided resolved transfer of 99 must count for nothing (voided wins).
 */
describe('CrateStandingService.forPoint (Postgres)', () => {
  let ds: DataSource;
  let service: CrateStandingService;
  let balances: CrateBalancesService;
  let run: string;
  let userId: string;
  let point: string;
  let bare: string;
  let crateTare: string;
  let boxTare: string;
  let grade: string;
  let yesterday: string;
  let today: string;

  const owner = () =>
    ({ sub: userId, role: UserRole.NetworkOwner, collection_point_id: null }) as AuthenticatedUser;
  const operatorAt = (pointId: string) =>
    ({ sub: userId, role: UserRole.PointOperator, collection_point_id: pointId }) as AuthenticatedUser;

  const newPoint = async (target: number | null): Promise<string> => {
    const tag = randomUUID().slice(0, 8);
    const [row] = await ds.query(
      `INSERT INTO collection_points (name, code, kind, target_crates)
       VALUES ($1, $2, 'reception', $3) RETURNING id`,
      [`Стан ${tag}`, `ST${tag.slice(0, 6).toUpperCase()}`, target],
    );
    return row.id;
  };

  const shift = async (
    pointId: string,
    date: string,
    closed: { broken: number | null } | null,
  ): Promise<string> => {
    const [row] = await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date,
                           status, closed_at, closed_by_user_id, broken_crates)
       VALUES ($1, $2, $3::date, $4::shift_status, $5, $6, $7) RETURNING id`,
      closed
        ? [pointId, userId, date, 'closed', new Date().toISOString(), userId, closed.broken]
        : [pointId, userId, date, 'open', null, null, null],
    );
    return row.id;
  };

  const supplier = async (pointId: string): Promise<string> => {
    const [row] = await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name)
       VALUES ($1, 'Стан', $2) RETURNING id`,
      [pointId, `Людина-${randomUUID().slice(0, 8)}`],
    );
    return row.id;
  };

  /** A receipt carrying `crates` crate-tare units and `boxes` non-crate units. */
  const receipt = async (
    shiftId: string,
    supplierId: string,
    crates: number,
    opts: { boxes?: number; voided?: boolean } = {},
  ): Promise<void> => {
    const [intake] = await ds.query(
      `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id,
                            voided_at, voided_by_user_id, void_reason)
       VALUES ($1, $2, $3, '100.00', $4, $5, $6, $7) RETURNING id`,
      [
        `ST-${randomUUID().slice(0, 8)}`,
        shiftId,
        supplierId,
        userId,
        opts.voided ? new Date().toISOString() : null,
        opts.voided ? userId : null,
        opts.voided ? 'фікстура' : null,
      ],
    );
    const [item] = await ds.query(
      `INSERT INTO intake_items
         (intake_id, item_order, product_grade_id, gross_kg, tare_weight_kg, net_kg, price, amount)
       VALUES ($1, 1, $2, '10.00', '0.00', '10.00', '10.00', '100.00') RETURNING id`,
      [intake.id, grade],
    );
    await ds.query(
      `INSERT INTO intake_item_tare_types (item_id, tare_type_id, units) VALUES ($1, $2, $3)`,
      [item.id, crateTare, crates],
    );
    if (opts.boxes) {
      await ds.query(
        `INSERT INTO intake_item_tare_types (item_id, tare_type_id, units) VALUES ($1, $2, $3)`,
        [item.id, boxTare, opts.boxes],
      );
    }
  };

  const transfer = async (pointId: string, over: Record<string, unknown>): Promise<void> => {
    const row: Record<string, unknown> = {
      collection_point_id: pointId,
      cash: '0.00',
      crates: 1,
      carrier: 'Іван, Ducato',
      sent_by_user_id: userId,
      sent_at: new Date('2026-09-01T18:00:00Z'),
      status: 'sent',
      ...over,
    };
    const keys = Object.keys(row);
    await ds.query(
      `INSERT INTO transfers (${keys.map((k) => `"${k}"`).join(', ')})
       VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`,
      keys.map((k) => row[k]),
    );
  };

  const issue = async (
    shiftId: string,
    supplierId: string,
    units: number,
    mode: 'deposit' | 'receipt',
    taken: string,
  ): Promise<void> => {
    await ds.query(
      `INSERT INTO crate_issuances
         (code, shift_id, supplier_id, units, mode, deposit_per_unit, deposit_taken, issued_by_user_id)
       VALUES ($1, $2, $3, $4, $5::crate_issuance_mode, $6, $7, $8)`,
      [
        `STI-${randomUUID().slice(0, 8)}`,
        shiftId,
        supplierId,
        units,
        mode,
        mode === 'deposit' ? '120.00' : '0.00',
        taken,
        userId,
      ],
    );
  };

  beforeAll(async () => {
    ds = await openTestDataSource();
    run = randomUUID().slice(0, 8);
    service = new CrateStandingService(ds);
    balances = new CrateBalancesService(ds);

    const [user] = await ds.query(
      `INSERT INTO users (first_name, last_name, role) VALUES ('Власник', $1, 'network_owner') RETURNING id`,
      [`Стан-${run}`],
    );
    userId = user.id;

    // THE crate tare is a singleton (UQ_tare_types_single_crate) shared by
    // every db-spec — reuse it if one exists, create it only if none does.
    const existing = await ds.query(`SELECT id FROM tare_types WHERE is_crate LIMIT 1`);
    if (existing.length) {
      crateTare = existing[0].id;
    } else {
      const [t] = await ds.query(
        `INSERT INTO tare_types (name, weight_kg, deposit_price, is_crate)
         VALUES ($1, '1.20', '120.00', true) RETURNING id`,
        [`Ящик-${run}`],
      );
      crateTare = t.id;
    }
    const [box] = await ds.query(
      `INSERT INTO tare_types (name, weight_kg, deposit_price) VALUES ($1, '0.40', '0.00') RETURNING id`,
      [`Чешка-${run}`],
    );
    boxTare = box.id;
    const [product] = await ds.query(`INSERT INTO products (name) VALUES ($1) RETURNING id`, [`Малина-${run}`]);
    const [g] = await ds.query(
      `INSERT INTO product_grades (product_id, name) VALUES ($1, 'Перший') RETURNING id`,
      [product.id],
    );
    grade = g.id;

    point = await newPoint(800);
    bare = await newPoint(null);
    yesterday = await shift(point, '2026-09-09', { broken: 2 });
    const older = await shift(point, '2026-09-08', { broken: null });
    today = await shift(point, '2026-09-10', null);

    const s = await supplier(point);
    await receipt(yesterday, s, 120, { boxes: 30 });
    await receipt(yesterday, s, 50, { voided: true });
    await receipt(older, s, 20);
    await receipt(today, s, 142);

    await transfer(point, { status: 'sent', crates: 40 });
    await transfer(point, {
      status: 'accepted', crates: 10,
      accepted_by_user_id: userId, accepted_date: '2026-09-10', accepted_at: new Date(),
    });
    await transfer(point, {
      status: 'disputed', crates: 9, reported_crates: 7, resolved_crates: 6,
      accepted_by_user_id: userId, accepted_date: '2026-09-10', accepted_at: new Date(),
      resolved_by_user_id: userId, resolved_at: new Date(),
    });
    await transfer(point, {
      status: 'disputed', crates: 8, reported_crates: 4,
      accepted_by_user_id: userId, accepted_date: '2026-09-10', accepted_at: new Date(),
    });
    await transfer(point, {
      status: 'disputed', crates: 99, reported_crates: 99, resolved_crates: 99,
      accepted_by_user_id: userId, accepted_date: '2026-09-10', accepted_at: new Date(),
      resolved_by_user_id: userId, resolved_at: new Date(),
      voided_at: new Date(), voided_by_user_id: userId, void_reason: 'фікстура',
    });

    // 195 out: 115 on deposit (13 800,00 ₴) + 80 on a розписка.
    const a = await supplier(point);
    const b = await supplier(point);
    await issue(today, a, 115, 'deposit', '13800.00');
    await issue(today, b, 80, 'receipt', '0.00');
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it('reproduces §6.8: 800 = 341 + 195 + 264', async () => {
    const got = await service.forPoint(owner(), { collection_point_id: point });
    expect(got).toEqual({
      collection_point_id: point,
      allotment: 800,
      in_field: 195,
      deposit_units: 115,
      deposit_held: '13800.00',
      at_base: 264,
      on_hand: 341,
      shortfall: 459,
    });
  });

  it('agrees with the sum of /crate-balances for the same point', async () => {
    const page = await balances.list(owner(), {
      collection_point_id: point, page: 1, limit: 200, include_zero: false,
    } as never);
    const sum = page.data.reduce((n, r) => n + r.outstanding_units, 0);
    const got = await service.forPoint(owner(), { collection_point_id: point });
    expect(got.in_field).toBe(sum);
  });

  it('pins an operator to their own point', async () => {
    const got = await service.forPoint(operatorAt(point), { collection_point_id: bare });
    expect(got.collection_point_id).toBe(point);
  });

  /** §6.9 — «—», not 0, and no on-hand without an allotment. */
  it('reports a point without an allotment as null, not zero', async () => {
    const got = await service.forPoint(owner(), { collection_point_id: bare });
    expect(got).toMatchObject({ allotment: null, on_hand: null, in_field: 0, at_base: 0, shortfall: 0 });
    expect(got.deposit_held).toBe('0.00');
  });

  it('lets on_hand go negative when the allotment is overdrawn', async () => {
    const small = await newPoint(10);
    const open = await shift(small, '2026-09-10', null);
    await receipt(open, await supplier(small), 25);
    const got = await service.forPoint(owner(), { collection_point_id: small });
    expect(got.on_hand).toBe(-15);
  });
});
```

If `collection_points` has other NOT NULL columns without defaults, copy the `INSERT` shape from `point-cash.db-spec.ts`'s `newPoint` (it inserts `name, code, kind, target_cash, is_active`).

- [ ] **Step 10: Run the db-spec**

Run: `cd backend && npm run test:db -- src/crates/crate-standing.db-spec.ts`
Expected: PASS (5 tests). If `deposit_held` comes back as a number-like string without decimals, the `::text` cast on `crateBookSql` is missing — `crateBookSql` already yields `numeric` with `0.00` fallbacks, so `'13800.00'` is expected.

- [ ] **Step 11: Correct the spec's `in_field` row** — in `docs/superpowers/specs/2026-09-23-yagoda-crates-standing.md` §3 change the `in_field` definition to «open units of live tranches at `P` (the `/crate-balances` tranche definition; equal to Σ issued − Σ returned because a return may not exceed what is out)».

- [ ] **Step 12: Lint and commit**

Run: `cd backend && npx eslint src/crates`
Expected: no errors.

```bash
git add backend/src/crates backend/eslint.config.mjs docs/superpowers/specs/2026-09-23-yagoda-crates-standing.md
git commit -m "feat(crates): serve the point crate standing at GET /crate-standing

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `/crate-balances` rows carry `deposit_units` and `receipt_units`

**Files:**
- Modify: `backend/src/crates/crate-balances.service.ts` (interface ~line 10-30, `rolled` CTE and outer `SELECT`)
- Test: `backend/src/crates/crate-balances.db-spec.ts`

**Interfaces:**
- Produces: `CrateBalanceRowResponse` gains `deposit_units: number; receipt_units: number;` with `deposit_units + receipt_units === outstanding_units`.

- [ ] **Step 1: Extend the db-spec assertions** (failing first). In `crate-balances.db-spec.ts`:
  - in «sums a supplier open tranches across issuances» add `expect(row!.deposit_units).toBe(40); expect(row!.receipt_units).toBe(0);`
  - in «reports a receipt holder…» add `expect(row!.deposit_units).toBe(0); expect(row!.receipt_units).toBe(200);`
  - in «lists that same supplier at zero…» add `expect(row!.deposit_units).toBe(0); expect(row!.receipt_units).toBe(0);`
  - add a new test:

```ts
  /** A person can hold BOTH kinds at once — the mock's «за кошти 20 · розписка 70». */
  it('splits a mixed holder into deposit and receipt units', async () => {
    const mixed = await supplier(pointA, 'Змішано');
    await issue(shiftA, mixed, 20, 'deposit', '120.00');
    await issue(shiftA, mixed, 70, 'receipt', '0.00');
    const row = await rowFor(mixed);
    expect(row).toMatchObject({ outstanding_units: 90, deposit_units: 20, receipt_units: 70 });
  });
```

- [ ] **Step 2: Run to see it fail**

Run: `cd backend && npm run test:db -- src/crates/crate-balances.db-spec.ts`
Expected: FAIL — `deposit_units` is `undefined`.

- [ ] **Step 3: Implement.** Add to `CrateBalanceRowResponse`:

```ts
  /** Of `outstanding_units`, those out on a deposit. */
  deposit_units: number;
  /** Of `outstanding_units`, those out on a paper розписка — no cash cover. */
  receipt_units: number;
```

In the `rolled` CTE add (after `has_receipt`):

```sql
               , (SUM(o.remaining_units) FILTER (WHERE o.mode <> $1::crate_issuance_mode))::int AS deposit_units
               , (SUM(o.remaining_units) FILTER (WHERE o.mode = $1::crate_issuance_mode))::int AS receipt_units
```

and in the outer `SELECT` (after `has_receipt`):

```sql
             , COALESCE(r.deposit_units, 0) AS deposit_units
             , COALESCE(r.receipt_units, 0) AS receipt_units
```

(`$1` is already bound to `CrateIssuanceMode.Receipt`.)

- [ ] **Step 4: Run the db-spec and the unit spec**

Run: `cd backend && npm run test:db -- src/crates/crate-balances.db-spec.ts && npx jest src/crates/crate-balances.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/crates/crate-balances.service.ts backend/src/crates/crate-balances.db-spec.ts
git commit -m "feat(crates): split each holder's crates into deposit and receipt units

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Crate documents say whether they can be voided; lists accept `include_voided`

**Files:**
- Modify: `backend/src/crates/crate-issuance.mapper.ts`
- Modify: `backend/src/crates/crate-return.mapper.ts`
- Modify: `backend/src/crates/crate-balance.service.ts` (`listIssuances`, `listReturns`)
- Modify: `backend/src/crates/crates.service.ts:147,265,448,535`
- Modify: `backend/src/crates/dto/list-crate-issuances.query.ts`, `dto/list-crate-returns.query.ts`
- Test: `backend/src/crates/crates.db-spec.ts` (HTTP-level, already has issue → return → void flow); unit specs `crates.service.spec.ts`, `crate-balance.service.spec.ts`

**Interfaces:**
- Produces:
  - `CrateIssuanceResponse` gains `shift_closed: boolean; has_live_returns: boolean;`
  - `CrateReturnResponse` gains `shift_closed: boolean;`
  - `toCrateIssuanceResponse(issuance: CrateIssuance, shift: Shift, hasLiveReturns: boolean)` — third param REQUIRED (no default).
  - List DTOs gain `include_voided?: boolean`. Semantics: `voided=true` → only voided (unchanged, wins); else `include_voided=true` → live and voided; else live only (unchanged default).

- [ ] **Step 1: Write failing HTTP assertions** in `crates.db-spec.ts`. Find the test that issues a deposit and then returns against it (the flow before test «9. voids the first issuance…»). After the return is recorded, add a new test (number it in sequence, before the void of the return):

```ts
  it('flags an issuance a live return rests on, and says the shift is open', async () => {
    const res = await request(app.getHttpServer())
      .get('/crate-issuances')
      .query({ supplier_id: supplierId })
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);
    const row = (res.body.data as Array<{ id: string; has_live_returns: boolean; shift_closed: boolean }>)
      .find((r) => r.id === depositIssuanceId);
    expect(row).toMatchObject({ has_live_returns: true, shift_closed: false });

    const rets = await request(app.getHttpServer())
      .get('/crate-returns')
      .query({ supplier_id: supplierId })
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);
    expect(rets.body.data[0].shift_closed).toBe(false);
  });
```

And after the return is voided (the test that voids it), add:

```ts
  it('clears has_live_returns once the return is void, and include_voided lists the voided return', async () => {
    const res = await request(app.getHttpServer())
      .get('/crate-issuances')
      .query({ supplier_id: supplierId })
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);
    const row = (res.body.data as Array<{ id: string; has_live_returns: boolean }>)
      .find((r) => r.id === depositIssuanceId);
    expect(row?.has_live_returns).toBe(false);

    const live = await request(app.getHttpServer())
      .get('/crate-returns')
      .query({ supplier_id: supplierId })
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);
    const all = await request(app.getHttpServer())
      .get('/crate-returns')
      .query({ supplier_id: supplierId, include_voided: true })
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);
    expect(all.body.total).toBe(live.body.total + 1);
  });
```

Use the variable names that file actually uses for the supplier, token and issuance id (read the file's `let` block first; `supplierId`, `operatorToken`, `depositIssuanceId` exist per test 9).

- [ ] **Step 2: Run to see it fail**

Run: `cd backend && npm run test:db -- src/crates/crates.db-spec.ts`
Expected: FAIL — `has_live_returns` undefined; `include_voided` → 400 (`forbidNonWhitelisted`).

- [ ] **Step 3: Mappers.** In `crate-issuance.mapper.ts` add to the interface:

```ts
  /** The shift is closed — voiding is then the owner's alone (§9.4 as amended). */
  shift_closed: boolean;
  /** A live return is allocated against this issuance — `voidIssuance` refuses it (§9.3). */
  has_live_returns: boolean;
```

change the signature to `export function toCrateIssuanceResponse(issuance: CrateIssuance, shift: Shift, hasLiveReturns: boolean): CrateIssuanceResponse` and add `shift_closed: shift.closed_at !== null, has_live_returns: hasLiveReturns,` to the returned object (before `created_at`). In `crate-return.mapper.ts` add `shift_closed: boolean;` to `CrateReturnResponse` and `shift_closed: shift.closed_at !== null,` in `toCrateReturnResponse`'s returned object. (Check `Shift.closed_at`'s type in `shifts/shift.entity.ts`; it is `Date | null`.)

- [ ] **Step 4: Call sites in `crates.service.ts`.**
  - line ~147 (create issuance): `toCrateIssuanceResponse(issuance, shift, false)` — a fresh issuance has nothing allocated.
  - line ~448 (void issuance): `toCrateIssuanceResponse(saved, shift, false)` — the void was refused if a live allocation existed.

- [ ] **Step 5: `listIssuances`** in `crate-balance.service.ts`. Replace the `voided` branch and the mapping:

```ts
    if (query.voided === true) qb.andWhere('i.voided_at IS NOT NULL');
    else if (!query.include_voided) qb.andWhere('i.voided_at IS NULL');
```

```ts
    // ONE query for the page, never one per row.
    const ids = data.map((issuance) => issuance.id);
    const liveRows: Array<{ issuance_id: string }> = ids.length
      ? await this.dataSource.query(
          `SELECT DISTINCT a.issuance_id
             FROM crate_return_allocations a
             JOIN crate_returns cr ON cr.id = a.return_id
            WHERE a.issuance_id = ANY($1)
              AND cr.voided_at IS NULL`,
          [ids],
        )
      : [];
    const live = new Set(liveRows.map((row) => row.issuance_id));

    return {
      data: data.map((issuance) =>
        toCrateIssuanceResponse(issuance, issuance.shift as Shift, live.has(issuance.id)),
      ),
      total,
      page: query.page,
      limit: query.limit,
    };
```

In `listReturns` apply the same `voided` / `include_voided` branch with alias `r`.

- [ ] **Step 6: DTOs.** In both `list-crate-issuances.query.ts` and `list-crate-returns.query.ts` add:

```ts
  /**
   * Live AND voided together — the per-person document list on «Ящики», where
   * a voided line stays visible, struck through (§9.3). The same name every
   * other document list uses. `voided=true` still wins: it means ONLY voided.
   */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  include_voided?: boolean;
```

(Add `Transform` import to the returns DTO if missing.) Update the class doc: «`voided` IS THREE-VALUED» paragraph gains «`include_voided=true` shows both».

- [ ] **Step 7: Fix unit specs** that call `toCrateIssuanceResponse` or mock `listIssuances`' `dataSource.query` (`crate-balance.service.spec.ts`: the list test now makes one extra `dataSource.query` call when the page is non-empty — mock it to resolve `[]`).

Run: `cd backend && npx jest src/crates`
Expected: PASS.

- [ ] **Step 8: Run the db-spec**

Run: `cd backend && npm run test:db -- src/crates/crates.db-spec.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/src/crates
git commit -m "feat(crates): tell the client which crate documents can be voided

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `entities/crate` — standing query and new fields

**Files:**
- Modify: `frontend/src/entities/crate/model/crate.ts`
- Modify: `frontend/src/entities/crate/api/useCrates.ts`
- Modify: `frontend/src/entities/crate/index.ts`
- Create: `frontend/src/entities/crate/api/useCrates.test.tsx`

**Interfaces:**
- Produces:
  - `export interface CrateStanding { collection_point_id: string; allotment: number | null; in_field: number; deposit_units: number; deposit_held: string; at_base: number; on_hand: number | null; shortfall: number; }`
  - `CrateBalanceRow` gains `deposit_units: number; receipt_units: number;`
  - `CrateIssuance` gains `shift_closed: boolean; has_live_returns: boolean;`; `CrateReturn` gains `shift_closed: boolean;`
  - `useCrateStandingQuery({ pointId, isOwner }: { pointId: string | null; isOwner: boolean })` → `UseQueryResult<CrateStanding>`; key `[...queryKeys.crateBalances, 'standing', pointId]`.
  - `CrateDocumentFilter.includeVoided` now reaches the server as `include_voided` (unchanged wire name — the backend accepts it after Task 4).

- [ ] **Step 1: Write the failing test** `useCrates.test.tsx`. Copy the wrapper/mock-adapter setup from `frontend/src/entities/transfer/api/useTransfers.test.tsx` (same `axios-mock-adapter` on `httpClient`, same `QueryClientProvider` wrapper), then:

```tsx
describe('useCrateStandingQuery', () => {
  it('asks for the chosen point', async () => {
    mock.onGet('/crate-standing', { params: { collection_point_id: 'p1' } }).reply(200, STANDING);
    const { result } = renderHook(() => useCrateStandingQuery({ pointId: 'p1', isOwner: true }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(STANDING);
  });

  /** An owner with no point would get a 400 — the request must not leave. */
  it('does not fire for an owner who has not chosen a point', () => {
    renderHook(() => useCrateStandingQuery({ pointId: null, isOwner: true }), { wrapper });
    expect(mock.history.get).toHaveLength(0);
  });

  it('fires for an operator without a point — the server pins them', async () => {
    mock.onGet('/crate-standing').reply(200, STANDING);
    renderHook(() => useCrateStandingQuery({ pointId: null, isOwner: false }), { wrapper });
    await waitFor(() => expect(mock.history.get).toHaveLength(1));
    expect(mock.history.get[0].params).toEqual({});
  });
});

describe('useCrateIssuancesQuery', () => {
  it('sends include_voided when asked', async () => {
    mock.onGet('/crate-issuances').reply(200, { data: [], total: 0, page: 1, limit: 100 });
    renderHook(() => useCrateIssuancesQuery({ supplierId: 's1', includeVoided: true }), { wrapper });
    await waitFor(() => expect(mock.history.get).toHaveLength(1));
    expect(mock.history.get[0].params).toEqual({ supplier_id: 's1', include_voided: true, limit: 100 });
  });
});
```

with `const STANDING = { collection_point_id: 'p1', allotment: 800, in_field: 195, deposit_units: 115, deposit_held: '13800.00', at_base: 264, on_hand: 341, shortfall: 459 };`

- [ ] **Step 2: Run to see it fail**

Run: `cd frontend && npx vitest run src/entities/crate`
Expected: FAIL — `useCrateStandingQuery` is not exported.

- [ ] **Step 3: Implement.** Types in `crate.ts` as in Interfaces (with a one-line doc on `CrateStanding`: «§6.8's 20:40 block for one point — every figure server-computed; `null` allotment/on_hand is «не задано», never 0»). In `useCrates.ts`:

```ts
/**
 * The allotment bar — one point's standing, computed by the server. The page
 * never re-derives it from `/crate-balances`, which is PAGINATED: summing a
 * page is wrong the moment a point has more holders than fit on it.
 *
 * UNDER THE `crateBalances` PREFIX on purpose: every issue, return and void
 * already invalidates that prefix, so this refreshes with them for free.
 * Movements made elsewhere (receipts, transfers, a shift close) arrive through
 * normal staleness.
 */
export function useCrateStandingQuery({ pointId, isOwner }: { pointId: string | null; isOwner: boolean }) {
  return useQuery({
    queryKey: [...queryKeys.crateBalances, 'standing', pointId] as const,
    enabled: !isOwner || pointId !== null,
    queryFn: async (): Promise<CrateStanding> => {
      const { data } = await httpClient.get<CrateStanding>('/crate-standing', {
        params: pointId ? { collection_point_id: pointId } : {},
      });
      return data;
    },
    staleTime: STALE.list,
  });
}
```

Export `useCrateStandingQuery` and `type CrateStanding` from `index.ts`.

- [ ] **Step 4: Run tests and typecheck**

Run: `cd frontend && npx vitest run src/entities/crate && npx tsc -b`
Expected: PASS; `tsc` reports errors ONLY in files that build `CrateBalanceRow`/`CrateIssuance` literals (e.g. `CratesPage.test.tsx`'s `row()` helper, return-crates tests). Fix each by adding the new fields with neutral values (`deposit_units: 40, receipt_units: 0`, `shift_closed: false, has_live_returns: false`) and re-run until `tsc -b` is clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/entities/crate frontend/src
git commit -m "feat(crates): read the point standing and the new crate fields on the client

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `CrateStandingBar`

**Files:**
- Create: `frontend/src/pages/crates/ui/CrateStandingBar.tsx`
- Create: `frontend/src/pages/crates/ui/CrateStandingBar.test.tsx`
- Modify: `frontend/src/shared/lib/i18n/locales/en.json`, `uk.json` (`crates.standing.*`)

**Interfaces:**
- Consumes: `CrateStanding` (Task 5).
- Produces: `export function CrateStandingBar({ standing }: { standing: CrateStanding })`.

- [ ] **Step 1: i18n keys.** Replace `crates.standing` in `en.json` with:

```json
"standing": {
  "allotment": "Allotment",
  "onHand": "Empty at the point",
  "inField": "Out with people",
  "atBase": "With us, with berries",
  "unset": "No allotment has been set for this point yet",
  "shortfall": "Short of the allotment:",
  "shortfallParts": "(with people {{inField}} + with us {{atBase}})",
  "overdrawn": "The allotment does not cover this day: fewer than zero empty crates at the point. There is nowhere to take them from until people return them or the base brings some."
}
```

and in `uk.json`:

```json
"standing": {
  "allotment": "Наділ",
  "onHand": "Пустих на точці",
  "inField": "У людей",
  "atBase": "У нас з ягодою",
  "unset": "Наділу цій точці ще не призначали",
  "shortfall": "Не хватає до наділу:",
  "shortfallParts": "(у людей {{inField}} + у нас {{atBase}})",
  "overdrawn": "Наділ не покриває цього дня: пустих на точці менше, ніж нуль. Взяти їх нема звідки, поки не повернуть люди або не привезе база."
}
```

(`overAllotment` is removed — negative `on_hand` replaces it. Task 9 removes its last consumer.)

- [ ] **Step 2: Write the failing test** `CrateStandingBar.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { CrateStandingBar } from './CrateStandingBar';
import type { CrateStanding } from '@/entities/crate';

const base: CrateStanding = {
  collection_point_id: 'p1', allotment: 800, in_field: 195, deposit_units: 115,
  deposit_held: '13800.00', at_base: 264, on_hand: 341, shortfall: 459,
};

describe('CrateStandingBar', () => {
  it('prints the three figures and the identity line', () => {
    render(<CrateStandingBar standing={base} />);
    expect(screen.getByText('800 = 341 + 195 + 264')).toBeInTheDocument();
    expect(screen.getByText('Empty at the point').parentElement).toHaveTextContent('341');
    expect(screen.getByText('Out with people').parentElement).toHaveTextContent('195');
    expect(screen.getByText('With us, with berries').parentElement).toHaveTextContent('264');
    expect(screen.getByText('459')).toBeInTheDocument();
  });

  /** §6.9 — «—», never 0; and no identity to state without an allotment. */
  it('shows «—» and no identity line when the allotment is unset', () => {
    render(<CrateStandingBar standing={{ ...base, allotment: null, on_hand: null }} />);
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/=/)).not.toBeInTheDocument();
    expect(screen.getByText(/no allotment has been set/i)).toBeInTheDocument();
  });

  it('turns a negative on-hand red and says why, without blocking anything', () => {
    render(<CrateStandingBar standing={{ ...base, allotment: 800, on_hand: -15, at_base: 620 }} />);
    expect(screen.getByText('−15')).toHaveClass('text-destructive');
    expect(screen.getByText(/does not cover this day/i)).toBeInTheDocument();
  });

  it('draws no segment wider than its share and never a negative width', () => {
    const { container } = render(
      <CrateStandingBar standing={{ ...base, on_hand: -15, in_field: 0, at_base: 0 }} />,
    );
    const widths = [...container.querySelectorAll<HTMLElement>('[data-segment]')].map((el) => el.style.width);
    expect(widths.every((w) => !w.startsWith('-') && w !== 'NaN%')).toBe(true);
  });
});
```

- [ ] **Step 3: Run to see it fail**

Run: `cd frontend && npx vitest run src/pages/crates/ui/CrateStandingBar.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement** `CrateStandingBar.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { Card } from '@/shared/ui/card';
import { cn } from '@/shared/lib/cn';
import type { CrateStanding } from '@/entities/crate';

/**
 * The allotment, split into where the crates physically are — §6.8's 20:40
 * block, which the client asked to SEE rather than check in her head
 * («щоб вони візуально це бачили»). The identity line
 * `800 = 341 + 195 + 264` adds nothing to the data and is exactly why it is
 * here.
 *
 * NOTHING IS COMPUTED HERE. Every number comes from `GET /crate-standing`;
 * only the bar's widths are derived, and a negative on-hand draws no fill
 * (there is no negative width) — the red figure and the warning below say it.
 */
export function CrateStandingBar({ standing }: { standing: CrateStanding }) {
  const { t, i18n } = useTranslation();
  const n = (value: number) => value.toLocaleString(i18n.language).replace('-', '−');
  const { allotment, on_hand: onHand, in_field: inField, at_base: atBase, shortfall } = standing;
  const known = allotment !== null && onHand !== null;
  const overdrawn = onHand !== null && onHand < 0;

  const segments = [
    { key: 'onHand', value: Math.max(0, onHand ?? 0), className: 'bg-[var(--leaf)]' },
    { key: 'inField', value: Math.max(0, inField), className: 'bg-[var(--amber)]' },
    { key: 'atBase', value: Math.max(0, atBase), className: 'bg-primary' },
  ];
  const total = segments.reduce((sum, s) => sum + s.value, 0);

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {t('crates.standing.allotment')}
          </span>
          <span className={cn('font-mono text-3xl leading-none font-semibold', known ? undefined : 'text-muted-foreground')}>
            {/* «—» is «не задано», NOT zero (§6.9). */}
            {allotment === null ? '—' : n(allotment)}
          </span>
        </div>
        {allotment === null ? (
          <span className="text-xs text-muted-foreground">{t('crates.standing.unset')}</span>
        ) : null}
      </div>

      <div className="mt-4 flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full bg-muted">
        {total > 0
          ? segments.map((s) => (
              <div
                key={s.key}
                data-segment={s.key}
                className={cn('h-full first:rounded-l-full last:rounded-r-full', s.className)}
                style={{ width: `${(s.value / total) * 100}%` }}
              />
            ))
          : null}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Figure label={t('crates.standing.onHand')} dot="bg-[var(--leaf)]"
          value={onHand === null ? '—' : n(onHand)} tone={overdrawn ? 'text-destructive' : undefined} />
        <Figure label={t('crates.standing.inField')} dot="bg-[var(--amber)]" value={n(inField)} />
        <Figure label={t('crates.standing.atBase')} dot="bg-primary" value={n(atBase)} />
      </div>

      {known ? (
        <p className="mt-3 font-mono text-xs text-muted-foreground">
          {`${n(allotment)} = ${n(onHand)} + ${n(inField)} + ${n(atBase)}`}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-line2 pt-3">
        <span className="text-sm font-medium">{t('crates.standing.shortfall')}</span>
        <span className="font-mono text-lg font-semibold">{n(shortfall)}</span>
        <span className="text-xs text-muted-foreground">
          {t('crates.standing.shortfallParts', { inField: n(inField), atBase: n(atBase) })}
        </span>
      </div>

      {overdrawn ? (
        <p className="mt-2 text-sm font-medium text-destructive">{t('crates.standing.overdrawn')}</p>
      ) : null}
    </Card>
  );
}

function Figure({ label, value, dot, tone }: { label: string; value: string; dot: string; tone?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={cn('size-2.5 shrink-0 rounded-[3px]', dot)} aria-hidden="true" />
      <div className="min-w-0">
        <p className="truncate text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
        <p className={cn('mt-0.5 font-mono text-xl leading-none font-semibold', tone)}>{value}</p>
      </div>
    </div>
  );
}
```

Note: the shortfall is shown even with an unset allotment — it is `in_field + at_base`, which is known regardless. If `cn` lives elsewhere, use the import other pages use (`grep -rn "from '@/shared/lib/cn'" frontend/src | head -1`).

- [ ] **Step 5: Run the test**

Run: `cd frontend && npx vitest run src/pages/crates/ui/CrateStandingBar.test.tsx`
Expected: PASS (4 tests). If the «Empty at the point» `parentElement` assertion fails because of nesting, assert on `screen.getByText('Empty at the point').closest('div')` instead — keep the value check.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/crates/ui/CrateStandingBar.tsx frontend/src/pages/crates/ui/CrateStandingBar.test.tsx frontend/src/shared/lib/i18n/locales
git commit -m "feat(crates): draw the allotment split into on hand, with people and at base

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `InFieldTable`

**Files:**
- Create: `frontend/src/pages/crates/ui/InFieldTable.tsx`
- Create: `frontend/src/pages/crates/ui/InFieldTable.test.tsx`
- Modify: `en.json`, `uk.json` (`crates.mode.split`, `crates.inField.*`)

**Interfaces:**
- Consumes: `CrateBalanceRow`, `CrateStanding` (Task 5).
- Produces: `export function InFieldTable({ rows, holders, standing, truncated, renderDocs }: { rows: CrateBalanceRow[]; holders: number; standing: CrateStanding; truncated: boolean; renderDocs: (supplierId: string) => React.ReactNode })`. `renderDocs` is how Task 9 plugs in `PersonCrateDocs` without this component knowing about voiding.

- [ ] **Step 1: i18n.** In `en.json` `crates.mode` add `"split": "Deposit {{deposit}} · receipt {{receipt}}"` and remove `"mixed"`. In `crates.inField` add:

```json
"summary_one": "{{units}} cr. · {{count}} person",
"summary_other": "{{units}} cr. · {{count}} people",
"ofWhichDeposit": "of which {{count}} on a deposit",
"expand": "Show {{name}}'s crate documents",
"truncated": "Showing the first {{shown}} of {{total}} people — the totals below count everyone."
```

In `uk.json`: `"split": "за кошти {{deposit}} · розписка {{receipt}}"` (remove `mixed`), and

```json
"summary_one": "{{units}} ящ. · {{count}} особа",
"summary_few": "{{units}} ящ. · {{count}} особи",
"summary_many": "{{units}} ящ. · {{count}} осіб",
"summary_other": "{{units}} ящ. · {{count}} осіб",
"ofWhichDeposit": "із них {{count}} за кошти",
"expand": "Показати ящикові документи: {{name}}",
"truncated": "Показано перших {{shown}} з {{total}} осіб — підсумки нижче рахують усіх."
```

- [ ] **Step 2: Write the failing test** `InFieldTable.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from 'i18next';
import { InFieldTable } from './InFieldTable';
import type { CrateBalanceRow, CrateStanding } from '@/entities/crate';

const standing: CrateStanding = {
  collection_point_id: 'p1', allotment: 800, in_field: 195, deposit_units: 115,
  deposit_held: '13800.00', at_base: 264, on_hand: 341, shortfall: 459,
};
const row = (over: Partial<CrateBalanceRow> & Pick<CrateBalanceRow, 'supplier_id'>): CrateBalanceRow => ({
  first_name: 'Василь', last_name: 'Яремчук', is_active: true, collection_point_id: 'p1',
  outstanding_units: 90, deposit_held: '2400.00', has_receipt: true,
  deposit_units: 20, receipt_units: 70, ...over,
});
const props = (rows: CrateBalanceRow[], over = {}) => ({
  rows, holders: rows.length, standing, truncated: false,
  renderDocs: (id: string) => <div data-testid={`docs-${id}`} />, ...over,
});

describe('InFieldTable', () => {
  it('shows both counts for a person holding both kinds', () => {
    render(<InFieldTable {...props([row({ supplier_id: 's1' })])} />);
    expect(screen.getByText('Deposit 20 · receipt 70')).toBeInTheDocument();
  });

  it('prints «—» in the deposit column for a receipt-only holder, never a zero', () => {
    render(<InFieldTable {...props([row({ supplier_id: 's2', deposit_units: 0, receipt_units: 90, deposit_held: '0.00' })])} />);
    const cells = within(screen.getByRole('row', { name: /Яремчук/ })).getAllByRole('cell');
    expect(cells.at(-1)).toHaveTextContent('—');
  });

  /** The TOTAL row reads the server, never the (paginated) page. */
  it('takes the totals from the standing, not from the rows', () => {
    render(<InFieldTable {...props([row({ supplier_id: 's1' })], { holders: 11, truncated: true })} />);
    const total = screen.getByRole('row', { name: /total/i });
    expect(total).toHaveTextContent('195');
    expect(total).toHaveTextContent('of which 115 on a deposit');
    expect(total).toHaveTextContent('13,800.00');
    expect(screen.getByText(/showing the first 1 of 11/i)).toBeInTheDocument();
  });

  it('expands a row to show that person\'s documents', async () => {
    render(<InFieldTable {...props([row({ supplier_id: 's1' })])} />);
    const toggle = screen.getByRole('button', { name: /Василь Яремчук/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('docs-s1')).toBeInTheDocument();
  });

  it('declines «особа» in Ukrainian', async () => {
    await i18n.changeLanguage('uk');
    render(<InFieldTable {...props([row({ supplier_id: 's1' })], { holders: 11 })} />);
    expect(screen.getByText('195 ящ. · 11 осіб')).toBeInTheDocument();
    await i18n.changeLanguage('en');
  });
});
```

(Match the money-format assertion to what `formatUah('13800.00', 'en')` actually prints — check `shared/lib/money` tests for the exact English output and use it.)

- [ ] **Step 3: Run to see it fail**

Run: `cd frontend && npx vitest run src/pages/crates/ui/InFieldTable.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement** `InFieldTable.tsx`:

```tsx
import { Fragment, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/shared/ui/card';
import { Badge } from '@/shared/ui/badge';
import { cn } from '@/shared/lib/cn';
import { formatUah } from '@/shared/lib/money';
import type { CrateBalanceRow, CrateStanding } from '@/entities/crate';

/**
 * «У людей» — who holds this point's crates, and on what terms.
 *
 * THE TOTAL ROW READS THE SERVER. `/crate-balances` is paginated, so summing
 * `rows` would undercount the moment a point has more holders than one page;
 * `standing` (from `GET /crate-standing`) counts everyone.
 *
 * «—» IN THE DEPOSIT COLUMN MEANS NO CASH COVER AT ALL — a person holding only
 * розписка crates. A zero would read as «the deposit came back».
 */
export function InFieldTable({
  rows,
  holders,
  standing,
  truncated,
  renderDocs,
}: {
  rows: CrateBalanceRow[];
  holders: number;
  standing: CrateStanding;
  truncated: boolean;
  renderDocs: (supplierId: string) => ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const [openId, setOpenId] = useState<string | null>(null);

  const how = (row: CrateBalanceRow) =>
    row.receipt_units === 0
      ? t('crates.mode.deposit')
      : row.deposit_units === 0
        ? t('crates.mode.receipt')
        : t('crates.mode.split', { deposit: row.deposit_units, receipt: row.receipt_units });

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line2 px-4 py-3">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          {t('crates.inField.title')}
        </h2>
        <span className="font-mono text-xs text-muted-foreground">
          {t('crates.inField.summary', { units: standing.in_field, count: holders })}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{t('crates.inField.title')}</caption>
          <thead>
            <tr className="border-b border-line2">
              <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">{t('crates.inField.col.person')}</th>
              <th scope="col" className="px-4 py-3 text-right font-medium text-muted-foreground">{t('crates.inField.col.units')}</th>
              <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">{t('crates.inField.col.how')}</th>
              <th scope="col" className="px-4 py-3 text-right font-medium text-muted-foreground">{t('crates.inField.col.deposit')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const expanded = openId === row.supplier_id;
              const name = `${row.first_name} ${row.last_name}`;
              return (
                <Fragment key={row.supplier_id}>
                  <tr className={cn('border-b border-line2/60', expanded ? 'bg-muted/40' : undefined)}>
                    <th scope="row" className="px-4 py-2.5 text-left font-medium">
                      <button
                        type="button"
                        aria-expanded={expanded}
                        onClick={() => setOpenId(expanded ? null : row.supplier_id)}
                        className="flex items-center gap-1.5 text-left hover:text-primary"
                      >
                        <ChevronDown
                          aria-hidden="true"
                          className={cn('size-4 shrink-0 text-muted-foreground transition-transform', expanded ? undefined : '-rotate-90')}
                        />
                        {name}
                      </button>
                      {row.is_active ? null : (
                        <Badge variant="outline" className="ml-2">{t('crates.inField.inactive')}</Badge>
                      )}
                    </th>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">{row.outstanding_units}</td>
                    <td className="px-4 py-2.5 text-left text-muted-foreground">{how(row)}</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                      {row.deposit_units === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        formatUah(row.deposit_held, i18n.language)
                      )}
                    </td>
                  </tr>
                  {expanded ? (
                    <tr className="bg-muted/40">
                      <td colSpan={4} className="p-0">{renderDocs(row.supplier_id)}</td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-foreground/15 font-medium">
              <th scope="row" className="px-4 py-2.5 text-left">{t('crates.inField.total')}</th>
              <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums">{standing.in_field}</td>
              <td className="px-4 py-2.5 text-left text-muted-foreground">
                {t('crates.inField.ofWhichDeposit', { count: standing.deposit_units })}
              </td>
              <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums">
                {standing.deposit_units === 0 ? '—' : formatUah(standing.deposit_held, i18n.language)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {truncated ? (
        <p className="border-t border-line2 px-4 py-3 text-xs text-muted-foreground">
          {t('crates.inField.truncated', { shown: rows.length, total: holders })}
        </p>
      ) : null}
    </Card>
  );
}
```

The expand button's accessible name is the person's name (the test finds it by name); `crates.inField.expand` is for an `aria-label` only if a reviewer asks — drop the key if unused (knip/i18n sweeps flag unused keys; check with `npm run verify`).

- [ ] **Step 5: Run the test**

Run: `cd frontend && npx vitest run src/pages/crates/ui/InFieldTable.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/crates/ui/InFieldTable.tsx frontend/src/pages/crates/ui/InFieldTable.test.tsx frontend/src/shared/lib/i18n/locales
git commit -m "feat(crates): the in-field table at mock parity, totals from the server

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `PersonCrateDocs`

**Files:**
- Create: `frontend/src/pages/crates/ui/PersonCrateDocs.tsx`
- Create: `frontend/src/pages/crates/ui/PersonCrateDocs.test.tsx`
- Modify: `en.json`, `uk.json` (`crates.docs.*`)

**Interfaces:**
- Consumes: `useCrateIssuancesQuery`, `useCrateReturnsQuery`, `CrateIssuance`, `CrateReturn` (Task 5); `VoidDocumentDialog` from `@/features/void-document` (props `{ kind, id, code, open, onClose, onVoided? }`).
- Produces: `export function PersonCrateDocs({ supplierId, isOwner }: { supplierId: string; isOwner: boolean })`.

- [ ] **Step 1: i18n.** `en.json` `crates.docs`:

```json
"docs": {
  "title": "This person's crate documents",
  "empty": "No crate documents for this person.",
  "failed": "Could not load the documents",
  "issued_one": "issued {{count}} crate",
  "issued_other": "issued {{count}} crates",
  "returned_one": "accepted {{count}} crate",
  "returned_other": "accepted {{count}} crates",
  "onDeposit": "on a deposit · {{amount}}",
  "onReceipt": "on receipt {{code}} · no deposit",
  "refunded": "deposit refunded {{amount}}",
  "noRefund": "no deposit — taken on a receipt",
  "voidedLine": "voided {{date}} · {{reason}}",
  "blockedByReturn": "a return rests on this issuance — void the return first",
  "void": "Void",
  "returnLabel": "return of {{units}} · {{date}}"
}
```

`uk.json`:

```json
"docs": {
  "title": "Документи цієї людини",
  "empty": "Ящикових документів за цією людиною немає.",
  "failed": "Не вдалося завантажити документи",
  "issued_one": "видали {{count}} ящик",
  "issued_few": "видали {{count}} ящики",
  "issued_many": "видали {{count}} ящиків",
  "issued_other": "видали {{count}} ящиків",
  "returned_one": "прийняли {{count}} ящик",
  "returned_few": "прийняли {{count}} ящики",
  "returned_many": "прийняли {{count}} ящиків",
  "returned_other": "прийняли {{count}} ящиків",
  "onDeposit": "за кошти · завдаток {{amount}}",
  "onReceipt": "за розписку {{code}} · завдатку не брали",
  "refunded": "віддали завдаток {{amount}}",
  "noRefund": "завдатку не було — брала за розписку",
  "voidedLine": "сторновано {{date}} · {{reason}}",
  "blockedByReturn": "на цю видачу вже лягло повернення — спершу сторнуйте його",
  "void": "Сторнувати",
  "returnLabel": "повернення {{units}} · {{date}}"
}
```

- [ ] **Step 2: Write the failing test** `PersonCrateDocs.test.tsx` — mock the entity hooks and the dialog exactly the way `CratesPage.test.tsx` mocks `@/entities/crate` and `@/features/issue-crates` (`vi.hoisted` + `vi.mock`):

```tsx
const { issuancesMock, returnsMock, voidDialogMock } = vi.hoisted(() => ({
  issuancesMock: vi.fn(), returnsMock: vi.fn(), voidDialogMock: vi.fn(),
}));
vi.mock('@/entities/crate', () => ({
  useCrateIssuancesQuery: (f: unknown) => issuancesMock(f),
  useCrateReturnsQuery: (f: unknown) => returnsMock(f),
}));
vi.mock('@/features/void-document', () => ({
  VoidDocumentDialog: (props: Record<string, unknown>) => {
    voidDialogMock(props);
    return props.open ? <div data-testid="void-dialog" /> : null;
  },
}));

const issuance = (over: Partial<CrateIssuance> = {}): CrateIssuance => ({
  id: 'i1', code: 'ЯЩ-0001', shift_id: 'sh1', collection_point_id: 'p1', business_date: '2026-09-10',
  supplier_id: 's1', units: 20, mode: 'deposit', deposit_per_unit: '120.00', deposit_taken: '2400.00',
  issued_by_user_id: 'u1', voided_at: null, voided_by_user_id: null, void_reason: null,
  created_at: '2026-09-10T08:00:00Z', shift_closed: false, has_live_returns: false, ...over,
});
const ret = (over: Partial<CrateReturn> = {}): CrateReturn => ({
  id: 'r1', shift_id: 'sh1', collection_point_id: 'p1', business_date: '2026-09-10', supplier_id: 's1',
  units: 5, deposit_refund: '600.00', allocations: [], accepted_by_user_id: 'u1',
  voided_at: null, voided_by_user_id: null, void_reason: null,
  created_at: '2026-09-10T09:00:00Z', shift_closed: false, ...over,
});
const ok = <T,>(data: T[]) => ({ data: { data, total: data.length, page: 1, limit: 100 }, isPending: false, isError: false });

beforeEach(() => {
  vi.clearAllMocks();
  issuancesMock.mockReturnValue(ok([issuance()]));
  returnsMock.mockReturnValue(ok([ret()]));
});

describe('PersonCrateDocs', () => {
  it('asks for live AND voided documents of this person', () => {
    render(<PersonCrateDocs supplierId="s1" isOwner={false} />);
    expect(issuancesMock).toHaveBeenCalledWith({ supplierId: 's1', includeVoided: true, limit: 100 });
    expect(returnsMock).toHaveBeenCalledWith({ supplierId: 's1', includeVoided: true, limit: 100 });
  });

  it('lists newest first', () => {
    render(<PersonCrateDocs supplierId="s1" isOwner={false} />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent(/accepted 5 crates/);
    expect(items[1]).toHaveTextContent(/issued 20 crates/);
  });

  it.each([
    // role, shift_closed, has_live_returns, voided, expect button
    ['operator', false, false, false, true],
    ['operator', true, false, false, false],
    ['owner', true, false, false, true],
    ['owner', false, true, false, false],
    ['owner', false, false, true, false],
  ] as const)('%s · closed=%s · underReturn=%s · voided=%s → button %s',
    (role, closed, under, voided, shown) => {
      returnsMock.mockReturnValue(ok([]));
      issuancesMock.mockReturnValue(ok([issuance({
        shift_closed: closed, has_live_returns: under,
        ...(voided ? { voided_at: '2026-09-10T10:00:00Z', void_reason: 'дубль', voided_by_user_id: 'u1' } : {}),
      })]));
      render(<PersonCrateDocs supplierId="s1" isOwner={role === 'owner'} />);
      expect(screen.queryByRole('button', { name: /void/i }) !== null).toBe(shown);
    });

  it('says why an issuance under a live return cannot be voided', () => {
    returnsMock.mockReturnValue(ok([]));
    issuancesMock.mockReturnValue(ok([issuance({ has_live_returns: true })]));
    render(<PersonCrateDocs supplierId="s1" isOwner />);
    expect(screen.getByText(/void the return first/i)).toBeInTheDocument();
  });

  it('strikes a voided line through and shows the reason', () => {
    returnsMock.mockReturnValue(ok([]));
    issuancesMock.mockReturnValue(ok([issuance({ voided_at: '2026-09-11T10:00:00Z', void_reason: 'дубль', voided_by_user_id: 'u1' })]));
    render(<PersonCrateDocs supplierId="s1" isOwner />);
    expect(screen.getByText(/issued 20 crates/)).toHaveClass('line-through');
    expect(screen.getByText(/дубль/)).toBeInTheDocument();
  });

  it('opens the void dialog with the right kind and id', async () => {
    returnsMock.mockReturnValue(ok([]));
    render(<PersonCrateDocs supplierId="s1" isOwner={false} />);
    await userEvent.click(screen.getByRole('button', { name: /void/i }));
    expect(voidDialogMock).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: 'crateIssuance', id: 'i1', code: 'ЯЩ-0001', open: true,
    }));
  });
});
```

- [ ] **Step 3: Run to see it fail**

Run: `cd frontend && npx vitest run src/pages/crates/ui/PersonCrateDocs.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement** `PersonCrateDocs.tsx`:

```tsx
import { useState } from 'react';
import { Ban } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { Spinner } from '@/shared/ui/spinner';
import { cn } from '@/shared/lib/cn';
import { formatUah } from '@/shared/lib/money';
import { formatShortDate, formatTime } from '@/shared/lib/date';
import { useCrateIssuancesQuery, useCrateReturnsQuery } from '@/entities/crate';
import type { CrateIssuance, CrateReturn } from '@/entities/crate';
import { VoidDocumentDialog } from '@/features/void-document';

type Doc = { kind: 'crateIssuance'; doc: CrateIssuance } | { kind: 'crateReturn'; doc: CrateReturn };

/**
 * One person's crate documents, newest first, voided ones kept and struck
 * through (§9.3: a correction is a void plus a new document).
 *
 * THE VOID BUTTON FOLLOWS THE SERVER'S RULE, NOT THE MOCK'S. The client
 * relaxed §9.4 on 2026-09-15: an operator may void ANY crate document at their
 * point while the shift is OPEN; a closed shift's document is the owner's.
 * The server says which via `shift_closed`, and `has_live_returns` marks the
 * one void it would refuse outright — an issuance a live return rests on —
 * so a button is never offered that is known to fail.
 */
export function PersonCrateDocs({ supplierId, isOwner }: { supplierId: string; isOwner: boolean }) {
  const { t, i18n } = useTranslation();
  const filter = { supplierId, includeVoided: true, limit: 100 };
  const issuances = useCrateIssuancesQuery(filter);
  const returns = useCrateReturnsQuery(filter);
  const [voiding, setVoiding] = useState<Doc | null>(null);

  if (issuances.isPending || returns.isPending) {
    return <div className="flex justify-center py-4"><Spinner /></div>;
  }
  if (issuances.isError || returns.isError) {
    return <p role="alert" className="px-4 py-3 text-sm text-destructive">{t('crates.docs.failed')}</p>;
  }

  const docs: Doc[] = [
    ...(issuances.data?.data ?? []).map((doc): Doc => ({ kind: 'crateIssuance', doc })),
    ...(returns.data?.data ?? []).map((doc): Doc => ({ kind: 'crateReturn', doc })),
  ].sort((a, b) => b.doc.created_at.localeCompare(a.doc.created_at));

  const mayVoid = (d: Doc) => d.doc.voided_at === null && (isOwner || !d.doc.shift_closed);
  const blocked = (d: Doc) => d.kind === 'crateIssuance' && d.doc.has_live_returns;

  const terms = (d: Doc) =>
    d.kind === 'crateIssuance'
      ? d.doc.mode === 'deposit'
        ? t('crates.docs.onDeposit', { amount: formatUah(d.doc.deposit_taken, i18n.language) })
        : t('crates.docs.onReceipt', { code: d.doc.code })
      : d.doc.allocations.some((a) => a.mode === 'deposit')
        ? t('crates.docs.refunded', { amount: formatUah(d.doc.deposit_refund, i18n.language) })
        : t('crates.docs.noRefund');

  const label = (d: Doc) =>
    d.kind === 'crateIssuance'
      ? d.doc.code
      : t('crates.docs.returnLabel', { units: d.doc.units, date: formatShortDate(d.doc.business_date, i18n.language) });

  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{t('crates.docs.title')}</p>
      {docs.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('crates.docs.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {docs.map((d) => {
            const voided = d.doc.voided_at !== null;
            return (
              <li key={`${d.kind}-${d.doc.id}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-background px-3 py-2 text-sm ring-1 ring-foreground/10">
                <span className="font-mono text-xs text-muted-foreground">
                  {formatShortDate(d.doc.business_date, i18n.language)} · {formatTime(d.doc.created_at, i18n.language)}
                </span>
                <span className={cn(voided ? 'text-muted-foreground line-through' : undefined)}>
                  {t(d.kind === 'crateIssuance' ? 'crates.docs.issued' : 'crates.docs.returned', { count: d.doc.units })}
                </span>
                <span className="text-xs text-muted-foreground">{terms(d)}</span>
                {voided ? (
                  <span className="ml-auto text-xs text-muted-foreground">
                    {t('crates.docs.voidedLine', {
                      date: formatShortDate(d.doc.voided_at!.slice(0, 10), i18n.language),
                      reason: d.doc.void_reason ?? '',
                    })}
                  </span>
                ) : blocked(d) ? (
                  <span className="ml-auto text-xs text-muted-foreground">{t('crates.docs.blockedByReturn')}</span>
                ) : mayVoid(d) ? (
                  <Button variant="ghost" size="sm" className="ml-auto h-7 px-2 text-destructive" onClick={() => setVoiding(d)}>
                    <Ban className="size-3.5" aria-hidden="true" />
                    {t('crates.docs.void')}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {voiding ? (
        <VoidDocumentDialog
          kind={voiding.kind}
          id={voiding.doc.id}
          code={label(voiding)}
          open
          onClose={() => setVoiding(null)}
        />
      ) : null}
    </div>
  );
}
```

Notes for the implementer:
- `formatShortDate`/`formatTime` signatures are `(iso: string, locale: string)` — confirm in `shared/lib/date/iso.ts`.
- `d.doc.has_live_returns` narrows only when `d.kind === 'crateIssuance'`; TypeScript accepts the `blocked` expression because the discriminant is checked first.
- `voided_at.slice(0, 10)` takes the UTC date — acceptable for a display of the void date; the local-date helpers are for business dates.

- [ ] **Step 5: Run the test and typecheck**

Run: `cd frontend && npx vitest run src/pages/crates/ui/PersonCrateDocs.test.tsx && npx tsc -b`
Expected: PASS (10 tests incl. the 5 table rows); `tsc` clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/crates/ui/PersonCrateDocs.tsx frontend/src/pages/crates/ui/PersonCrateDocs.test.tsx frontend/src/shared/lib/i18n/locales
git commit -m "feat(crates): per-person crate documents with server-hinted voids

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Wire the page; docs; follow-up

**Files:**
- Modify: `frontend/src/pages/crates/ui/CratesPage.tsx`
- Modify: `frontend/src/pages/crates/ui/CratesPage.test.tsx`
- Modify: `en.json`, `uk.json` (`crates.note`)
- Modify: `frontend/CLAUDE.md`
- Modify: `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md`

**Interfaces:**
- Consumes: `useCrateStandingQuery` (Task 5), `CrateStandingBar` (Task 6), `InFieldTable` (Task 7), `PersonCrateDocs` (Task 8), `isTruncated` from `@/shared/api`.

- [ ] **Step 1: i18n.** In `crates.note`, delete `notTracked` and add `shipmentsDeferred`:
  - en: `"shipmentsDeferred": "The «Shipments today» window is not built yet: a shipment is not recorded as a document, so «with us, with berries» is counted live from receipts, breakage and transfers."`
  - uk: `"shipmentsDeferred": "Вікна «Відправлення за сьогодні» ще немає: відправлення не записується окремим документом, тому «у нас з ягодою» рахується наживо — з квитанцій, бою і переказів."`

- [ ] **Step 2: Rewrite the page test** `CratesPage.test.tsx`. Keep the existing hoisted mocks; add `standingMock` to the `@/entities/crate` mock (`useCrateStandingQuery: (a: unknown) => standingMock(a)`), and mock the three page-local components so this test is about wiring only:

```tsx
vi.mock('./CrateStandingBar', () => ({
  CrateStandingBar: ({ standing }: { standing: { in_field: number } }) => <div data-testid="bar">{standing.in_field}</div>,
}));
vi.mock('./InFieldTable', () => ({
  InFieldTable: (p: { holders: number; truncated: boolean }) => (
    <div data-testid="table" data-holders={p.holders} data-truncated={String(p.truncated)} />
  ),
}));
```

Replace the old figure/warning tests (their behaviour now lives in `CrateStandingBar.test.tsx` / `InFieldTable.test.tsx`) with:

```tsx
  it('passes the server standing to the bar and the page total to the table', () => {
    standingMock.mockReturnValue({ data: STANDING, isPending: false, isError: false });
    balancesMock.mockReturnValue({ data: { data: [row({ supplier_id: 's1' })], total: 11, page: 1, limit: 100 }, isPending: false, isError: false });
    render(<CratesPage />);
    expect(screen.getByTestId('bar')).toHaveTextContent('195');
    expect(screen.getByTestId('table')).toHaveAttribute('data-holders', '11');
    expect(screen.getByTestId('table')).toHaveAttribute('data-truncated', 'true');
  });

  it('asks the owner to pick a point and fires nothing until they do', () => {
    meMock.mockReturnValue({ data: OWNER });
    scopeMock.mockReturnValue({ pointId: null, canPick: true, setPointId: vi.fn() });
    render(<CratesPage />);
    expect(screen.getByText(/no point selected/i)).toBeInTheDocument();
    expect(standingMock).toHaveBeenCalledWith({ pointId: null, isOwner: true });
  });

  it('keeps both gestures live', () => {
    render(<CratesPage />);
    expect(screen.getByRole('button', { name: /issue crates/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /accept crates/i })).toBeEnabled();
  });

  it('shows the empty state, not a table, when nobody holds crates', () => {
    balancesMock.mockReturnValue(page([]));
    render(<CratesPage />);
    expect(screen.getByText(/nobody is holding crates/i)).toBeInTheDocument();
    expect(screen.queryByTestId('table')).not.toBeInTheDocument();
  });
```

with `STANDING` as in Task 6 and `standingMock.mockReturnValue({ data: STANDING, isPending: false, isError: false })` added to `beforeEach`. Keep the existing dialog-opening tests.

- [ ] **Step 3: Run to see it fail**

Run: `cd frontend && npx vitest run src/pages/crates/ui/CratesPage.test.tsx`
Expected: FAIL — `bar` test id not found.

- [ ] **Step 4: Rewrite the page body.** In `CratesPage.tsx`:
  - Imports: drop `Boxes`, `Badge`, `formatUah`, `isZero`, `usePointOptionsQuery`; add `useCrateStandingQuery` from `@/entities/crate`, `isTruncated` from `@/shared/api`, `CrateStandingBar`, `InFieldTable`, `PersonCrateDocs` from `./…`. Keep `usePointOptionsQuery` only for the owner's point picker (it is still needed there — keep the import).
  - Replace the `inField`/`allotment`/`overAllotment` block with `const standing = useCrateStandingQuery({ pointId, isOwner: Boolean(isOwner) });`.
  - Loading/error gates: `balances.isPending || standing.isPending` → spinner; `balances.isError || standing.isError` → the existing alert.
  - Replace the `<Card>` standing block with `<CrateStandingBar standing={standing.data} />` (inside the success branch `standing.data` is defined; guard with `standing.data ? … : null` to satisfy TypeScript).
  - Replace the inline `<table>` with:

```tsx
            {rows.length === 0 ? (
              <EmptyState title={t('crates.inField.empty.title')} hint={t('crates.inField.empty.hint')} />
            ) : (
              <InFieldTable
                rows={rows}
                holders={balances.data?.total ?? rows.length}
                standing={standing.data}
                truncated={isTruncated(balances.data)}
                renderDocs={(supplierId) => <PersonCrateDocs supplierId={supplierId} isOwner={Boolean(isOwner)} />}
              />
            )}
```

  - Notes: keep `crates.note.receiptVsDeposit`; replace the `notTracked` paragraph with `{t('crates.note.shipmentsDeferred')}` (no icon).
  - Rewrite the file's header comment: drop «WHAT THIS SCREEN DELIBERATELY DOES NOT SHOW… two figures are real»; say instead that the four figures come from `GET /crate-standing`, that only the shipments dialog is absent (`crate_shipments` deferred), and keep the «ALLOTMENT IS A GUIDE» and «BOTH ROLES ISSUE AND ACCEPT» paragraphs. Add: «VOIDING FROM THIS SCREEN — each holder's row expands to `PersonCrateDocs`, whose buttons follow the server's §9.4-as-amended rule.»

- [ ] **Step 5: Run the page suite, the whole frontend suite, typecheck, lint**

Run: `cd frontend && npx vitest run src/pages/crates && npx tsc -b && npm run lint`
Expected: PASS / clean. Then `grep -rn "overAllotment\|mode.mixed\|notTracked" frontend/src` → no matches.

- [ ] **Step 6: Docs.**
  - `frontend/CLAUDE.md` Structure block: add after the `entities/cash-count/` line
    `  entities/crate/                 # useCrateBalancesQuery / useCrateStandingQuery / useCrateIssuancesQuery / useCrateReturnsQuery — who holds a point's crates, the server-computed allotment split (on hand / with people / at base), and the crate documents; read by pages/crates and reception's PointStatePanel`
    and after the `pages/transfers/` line
    `  pages/crates/                   # «Ящики» — the allotment bar (CrateStandingBar), holders (InFieldTable) and each holder's documents with server-hinted voids (PersonCrateDocs) — both roles; the «Відправлення» dialog is deferred with crate_shipments`
  - `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md`: append an item — «**Reception's «Стан точки» sums a paginated list.** `pages/reception/ui/PointStatePanel.tsx` totals «у людей» from `useCrateBalancesQuery` rows (limit 100), which undercounts past one page. `GET /crate-standing` (crates-standing slice, 2026-09-23) now serves the exact figure; switching the panel to `useCrateStandingQuery` was left out of that slice as an adjacent change.»

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/crates frontend/src/shared/lib/i18n/locales frontend/CLAUDE.md docs/superpowers/2026-09-05-foundation-slice-follow-ups.md
git commit -m "feat(crates): the «Ящики» screen reads the standing and expands each holder

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Gate

- [ ] **Step 1: Fast tier**

Run: `npm run verify`
Expected: the verdict line reports green. Quote it. Any `SKIPPED` row is named in the report.

- [ ] **Step 2: Full tier** (SQL against real Postgres is this slice's proof)

Run: `npm run verify:full`
Expected: green verdict line; quote it, name every `SKIPPED` row and why. If `coverage` is reported, quote its own percentages, never a floor.

- [ ] **Step 3: Fix, never widen.** A red row is fixed in code or measurement — no baseline widening, no suppression. Commit each fix separately with a message naming the row.

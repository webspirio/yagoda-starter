# «Каса точки» backend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** The three reads/writes the mock's point-cash screen needs and production lacks: a midday recount (`POST /cash-counts`), display names on shift and cash-count responses, and the deposit-covered crate unit count on the point-cash row.

**Architecture:** No schema change. The recount is a `CashCount` row of kind `midday` written by a new service method that reads the drawer under the same transaction; names come from one `loadDisplayNames(manager, ids)` helper applied in the mappers' callers (never N+1); the unit count is a sibling of `crateBookSql`.

**Tech Stack:** NestJS 12, TypeORM, Postgres, Jest (unit needs `NODE_OPTIONS=--experimental-vm-modules` — use `npm test`; db tier `npm run test:db` or `NODE_OPTIONS=--experimental-vm-modules npx jest --config jest.db.config.js <path>`; `app_test` persists — per-run uuids).

**Spec:** `docs/superpowers/specs/2026-09-22-yagoda-point-cash-parity.md` (§2, rulings R2, R3, R8).

## Global Constraints
- Money as strings through `backend/src/common/money.ts` only (`add`, `sub`, `cmp`, `isZero`…); ESLint bans `*`, `/`, `Number()`, `parseFloat`, `toFixed` in the money modules — `cash-counts`, `point-cash`, `crates`, `shifts` are among them.
- Every write that changes something records an audit entry in the same transaction (`AuditService.record(entry, manager)`); new action names go into `AUDIT_ACTIONS` (`backend/src/audit/audit-log.entity.ts`).
- Business refusals are 400 with a machine `code` (see `payouts.service.ts`'s `BadRequestException({ code, message })` shape); role refusals come from `@Auth(...)`.
- Commit per task with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; no push.
- `npm run verify` after each task; `npm run verify:full` at the end (money code and SQL are only proven against real Postgres).

---

### Task 1: `POST /cash-counts` — the midday recount (R2)

**Files:**
- Create: `backend/src/cash-counts/dto/create-cash-count.dto.ts`
- Modify: `backend/src/cash-counts/cash-counts.service.ts` (+ `.spec.ts`), `cash-counts.controller.ts`, `cash-counts.module.ts` (import `ShiftsModule`? — no: import `PointCashModule` for `cashFor`, and reuse `ShiftsService.findOpenAtPoint` by importing `ShiftsModule`; check for a circular import first — if `ShiftsModule` imports `CashCountsModule`, query the open shift directly with `manager.findOne(Shift, { where: { collection_point_id, closed_at: IsNull() } })` inside the service instead and say so)
- Modify: `backend/src/audit/audit-log.entity.ts` (`'cash_count.recorded'`)
- Create: `backend/src/cash-counts/cash-count-recount.db-spec.ts`
- Modify: `backend/src/cash-counts/cash-counts.db-spec.ts` only if a shared fixture helper is extracted

**Interfaces:**
- Produces `CreateCashCountDto { book: CashBook.Berry; counted_amount: string }` — `@IsIn([CashBook.Berry])` (the crates book is never counted, crates spec §4.3), `@Matches(/^\d{1,10}(\.\d{1,2})?$/)` + the repo's `@CanonicalDecimal()` transformer (as `create-intake.dto.ts` does for `paid_amount`).
- Produces `CashCountsService.recount(actor: AuthenticatedUser, dto): Promise<CashCountRow>`:
  1. `actor.role !== PointOperator` never reaches here (`@Auth(UserRole.PointOperator)`); `pointId = actor.collection_point_id` (an operator without a point → 400 `OPERATOR_WITHOUT_POINT`, reuse the existing code if one exists).
  2. In `dataSource.transaction`: open shift at `pointId` (`closed_at IS NULL`) → else 400 `SHIFT_NOT_OPEN` («Перерахунок чіпляється лише до відкритої зміни»).
  3. `expected = await pointCash.cashFor(pointId, undefined, m)` — the drawer at this instant, berry book.
  4. `m.save(CashCount, { shift_id, collection_point_id, business_date: shift.business_date, book: Berry, kind: Midday, counted_amount, expected_amount: expected, counted_by_user_id: actor.id, counted_at: now })` — check the entity for exact column names and whether `collection_point_id`/`business_date` are columns or derived; write what the entity has.
  5. `audit.record({ action: 'cash_count.recorded', actor_user_id, entity: 'cash_count', entity_id, after: { kind, book, counted_amount, expected_amount } }, m)`.
  6. Return `toCashCountRow(saved)` (the mapper computes `discrepancy` and `is_open`; `is_open` stays false for midday — unchanged rule).
- Controller: `@Post() @Auth(UserRole.PointOperator) create(@CurrentUser() actor, @Body() dto)` → 201 with the row. Replace the controller's «NO WRITE ROUTE EXISTS, deliberately» comment with the R2 text: a recount is a witness (§7.6); midday never opens an incident (`is_open`/`only_discrepancies` unchanged), the closing count carries the day; the 10.09 note's «midday = перекрито» reading is now false and this comment is where that is recorded.

- [ ] **Step 1: Failing unit tests** (`cash-counts.service.spec.ts`, mocked `DataSource`/manager like `payouts.service.spec.ts`): refuses when no open shift (`SHIFT_NOT_OPEN`); saves `kind: 'midday'`, `book: 'berry'`, `expected_amount` = what `cashFor` returned, `counted_by_user_id` = actor; records the audit entry with the manager.
- [ ] **Step 2: Failing db-spec** (`cash-count-recount.db-spec.ts`, boot like `cash-counts.db-spec.ts` through `openTestDataSource` + the Nest app if that spec uses HTTP — mirror whichever it does; if it is service-level, test the service with a real `DataSource` and a real `PointCashService`): fixture = point, operator (with `collection_point_id`), catalog, supplier, open shift with `counted_amount: '1500.00'`, one unpaid intake worth 1000 and one standalone payout of 400 (drawer 1100). Tests: (a) a recount of `'1100.00'` lands with `expected_amount '1100.00'`, `discrepancy '0.00'`, `is_open false`; (b) a second recount of `'1000.00'` on the same shift also lands (no unique clash — `midday` is outside the unique index) with `discrepancy '-100.00'` and `is_open false`; (c) `GET /point-cash?collection_point_id=` is unchanged by the recount (a witness moves nothing); (d) after `POST /shifts/:id/close` a recount refuses with `SHIFT_NOT_OPEN`; (e) the owner token gets 403; (f) an operator of another point recounting cannot touch this point (their own point has no open shift → `SHIFT_NOT_OPEN`, and no row lands at this point).
- [ ] **Step 3: Implement** DTO, service, controller, module wiring, audit action. Run unit + db specs green. `npm run lint` in `backend/`.
- [ ] **Step 4: Commit** `feat(cash-counts): a midday recount is a witness — POST /cash-counts (§7.6, D-6)`.

### Task 2: Display names on shift and cash-count responses (R3)

**Files:**
- Create: `backend/src/users/display-names.ts` — `loadDisplayNames(manager: EntityManager, ids: Iterable<string>): Promise<Map<string, string>>` (one `IN (...)` query over `users`, `displayNameOf` per row, empty map for no ids) + `display-names.spec.ts`
- Modify: `backend/src/shifts/shift.mapper.ts` (`ShiftResponse` + `opened_by_name: string | null`, `closed_by_name: string | null`; `toShiftResponse(shift, names: ReadonlyMap<string,string>)` — `names.get(id) ?? null`), `shifts.service.ts` (every `toShiftResponse` call site loads the map first; `list` loads one map for the page), `shift.mapper.spec.ts` if present
- Modify: `backend/src/cash-counts/cash-count.mapper.ts` (`counted_by_name: string | null`, `toCashCountRow(row, names)`), `cash-counts.service.ts` (`list` and `recount` load the map)
- Modify: the db-specs that assert response shapes (`shifts.db-spec.ts`? `cash-counts.db-spec.ts`) — add assertions that the names are the fixture users' `first last`.

**Interfaces:** Produces the two response fields above; `displayNameOf` stays the ONE definition (`backend/src/users/display-name.ts`).

- [ ] **Step 1: Failing tests**: `display-names.spec.ts` (two ids → two names, unknown id absent, empty input → empty map, ONE query); mapper specs assert the new fields, `null` when the id is not in the map; a db-spec case per response.
- [ ] **Step 2: Implement**; grep for every `toShiftResponse(`/`toCashCountRow(` caller (6 + list/recount) and pass the map; never call `loadDisplayNames` inside a per-row loop.
- [ ] **Step 3: Run** unit + db tiers; `npm run lint`. **Step 4: Commit** `feat(shifts,cash-counts): who opened, closed and counted — display names on the two responses (D-8)`.

### Task 3: `crate_deposit_units` on the point-cash row (R8)

**Files:**
- Modify: `backend/src/crates/crate-balance.service.ts` — export `crateUnitsSql(pointExpr)` next to `crateBookSql`:
  ```sql
  (COALESCE((SELECT SUM(ci.units) FROM crate_issuances ci JOIN shifts cs ON cs.id = ci.shift_id
             WHERE cs.collection_point_id = ${pointExpr} AND ci.mode = 'deposit' AND ci.voided_at IS NULL), 0)
   - COALESCE((SELECT SUM(a.units) FROM crate_return_allocations a
             JOIN crate_issuances ci ON ci.id = a.issuance_id
             JOIN crate_returns cr ON cr.id = a.return_id
             JOIN shifts cs ON cs.id = ci.shift_id
             WHERE cs.collection_point_id = ${pointExpr} AND ci.mode = 'deposit'
               AND ci.voided_at IS NULL AND cr.voided_at IS NULL), 0))::int
  ```
  (check the enum value for the deposit mode in `crate-issuance-mode.enum.ts` and the allocation table/column names in `crate-return-allocation.entity.ts`; adjust the literal to what the entity declares).
- Modify: `backend/src/point-cash/point-cash.service.ts` (`list` SQL adds `${crateUnitsSql('cp.id')} AS crate_deposit_units`; `findOne`/`crateDepositsFor` path adds the same as a second column), `point-cash.mapper.ts` (`crate_deposit_units: number` on `PointCashRowResponse` and on the `findOne` response), the existing point-cash db-spec (a seeded deposit issuance of 20 units + a return allocating 7 → `13`; a receipt-mode issuance counts 0; a voided issuance counts 0).
- Modify: `backend/CLAUDE.md` `cash-counts/`, `shifts/`, `point-cash/` lines (Task 1–3 facts); `28-db-schema.dbml` needs no change (say so in the commit).

- [ ] **Step 1: Failing db-spec** cases as above. **Step 2: Implement.** **Step 3: `npm test`, `npm run test:db`, `npm run lint`; from the worktree root `npm run verify:full` — paste the verdict.** **Step 4: Commit** `feat(point-cash): deposit-covered crate units on the row (R8)`.

# Crates standing — the «Ящики» screen at parity with the mock

**Date:** 2026-09-23 · **Branch:** `feat/crates-standing` · **Status:** approved design

## 1. Why

The mock's «Ящики» screen (`yagoda-crm/src/pages/CratesPage.tsx`) answers two
questions ours cannot: **where every crate of the point's allotment physically
is** (§6.8's 20:40 block: `800 = 341 порожніх + 195 у людей + 264 на базі`) and
**what documents stand behind one person's balance**, with a void per document.
Ours shows only the allotment and «у людей», and it gets «у людей» by summing a
**paginated** list client-side — wrong the moment a point has more holders than
one page.

Success: an owner or operator opens `/crates` and sees the allotment split into
on hand / with people / at base, the identity line, the shortfall, and can
expand any holder to see and (where the server allows) void their crate
documents.

## 2. Scope

In:

- A server-computed point standing (`GET /crate-standing`).
- The standing bar, the in-field table at mock parity, the per-person drill-down.
- Three response-contract additions (§4.2, §4.3).

Out, deliberately:

- **«Відправлення за сьогодні» dialog.** Needs `crate_shipments` (§6.8's
  snapshot), which stays deferred — see `crate-dispatch.service.ts`.
- **«Змінити наділ» on this screen.** The allotment control stays on `/points`.
- **Village under the name.** `suppliers` has no such column.
- **Reception's «Стан точки» panel.** Stays without the proportion bar (D-3 of
  the reception-parity spec); no adjacent change.
- **The mock's «сума по людях ≠ склад наділу» warning.** A crate return is
  refused unless `supplier.collection_point_id` is the point, and a supplier
  belongs to one point, so the two counts cannot diverge here.
- **Voider name on a voided line.** Responses carry `voided_by_user_id` only;
  the line shows date and reason.

## 3. The figures

For point `P`, point-lifetime (no date floor — the same shape as the crates
book, §7.5), voided documents excluded everywhere:

| Field | Definition |
|---|---|
| `allotment` | `collection_points.target_crates` — `null` = «не задано» |
| `in_field` | Σ `crate_issuances.units` − Σ `crate_returns.units` at `P` |
| `deposit_units` | open units of `mode = 'deposit'` tranches (the tranche logic `/crate-balances` already uses) |
| `deposit_held` | `crateBookSql(P)` — reused, not re-derived (money string) |
| `at_base` | Σ crate units on live intakes of ALL `P`'s shifts, open one included + Σ non-null `shifts.broken_crates` − Σ transfer crates |
| `on_hand` | `allotment − in_field − at_base`; `null` when `allotment` is; MAY be negative (§6.9) |
| `shortfall` | `in_field + at_base` |

**Transfer crates** use point-cash's three-way reading of the same rows
(09.09.2026 client ruling): `accepted → crates`, `disputed ∧ resolved →
resolved_crates`, `disputed → reported_crates`; `sent` contributes nothing;
voided excluded in the outer `WHERE` (voided wins over resolved).

**Why the open shift counts.** §6.8's 20:40 block counts today's 142 as gone
before the 20:55 close; «з ягодою» is computed from the day's receipts, not
entered.

**Known imprecision, named not fixed.** Voiding an intake on a closed day moves
`at_base` silently — the same `crate_shipments` gap the dispatch line already
documents. A closed shift with `broken_crates IS NULL` (history older than the
column) contributes 0 breakage.

**The `is_crate` selector** (`intake_item_tare_types ⋈ tare_types WHERE
tt.is_crate`) moves into a shared SQL fragment beside `crateBookSql` and
`CrateDispatchService` reads it from there, so dispatch and standing cannot drift.

## 4. Backend

### 4.1 `GET /crate-standing?collection_point_id=`

New `CrateStandingController` + `CrateStandingService` in `crates/`.
`@Auth()`, both roles (§6.10: the operator sees their own point's standing).
Point scope via `resolvePointFilter`: an operator is pinned to their point; an
owner MUST pass one (400 otherwise — a standing is one point's). Unknown point
→ 404. One SQL query; integers cast `::int` (an uncast `SUM` is int8 → string).

```ts
interface CrateStandingResponse {
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

### 4.2 `/crate-balances` rows

Gain `deposit_units: number` and `receipt_units: number` (open units per mode;
`deposit_units + receipt_units = outstanding_units`). `has_receipt` stays.

### 4.3 Issuance / return responses

Both gain `shift_closed: boolean` (from the shift the mappers already receive).
Issuances gain `has_live_returns: boolean` — a live allocation from a live
return exists (the exact condition `voidIssuance` refuses on). Filled for a page
in one batched query, never per row.

No new table, no migration.

## 5. Frontend

- `entities/crate`: `useCrateStandingQuery(pointId)`, key
  `[...queryKeys.crateBalances, 'standing', pointId]` — under the balances
  prefix, so every existing issue/return/void invalidation refreshes it.
  Movements made on other screens (intakes, transfers, shift close) reach it
  through the default 30 s staleness on mount. New types as in §4.
- `pages/crates/ui/CrateStandingBar` — mock layout: «Наділ» headline, a
  three-segment bar (leaf = on hand, amber = with people, primary = at base;
  negative widths clamp to 0), three dotted figures, the identity line, the
  shortfall line. «—» for unknown allotment (never 0); negative on-hand red with
  the §6.9 warning.
- `pages/crates/ui/InFieldTable` — header «У людей · N ящ. · M осіб»; «Як
  брала» shows both counts for a mixed row; РАЗОМ row (units, «із них N за
  кошти», deposit held) from the standing endpoint; truncation hint when the page
  is truncated; rows expandable for both roles.
- `pages/crates/ui/PersonCrateDocs` — the supplier's issuances and returns
  (live and voided) merged newest-first; voided lines struck through with date
  and reason. «Сторнувати» shown iff not voided AND (owner OR `!shift_closed`)
  AND NOT (`issuance ∧ has_live_returns`); the last case shows «спершу
  сторнуйте повернення» instead. Voids go through the existing
  `features/void-document` (`crateIssuance` / `crateReturn` kinds already exist).
- `CratesPage` drops the client-side sum and the «not tracked» caption; the
  receipt-vs-deposit note stays; the deferral note narrows to the shipments
  dialog.
- i18n keys in `uk.json` and `en.json`, Ukrainian plurals for ящик/особа.

## 6. Testing

- Backend unit specs: standing service + controller scope (operator pinned,
  owner without point → 400, foreign point → 404).
- `crate-standing.db-spec.ts` (real Postgres): the §6.8 day
  (`800 = 341 + 195 + 264`); a sent, an accepted, a disputed, a resolved and a
  voided transfer; a closed shift with null breakage; open-shift berry crates;
  a point without allotment; negative on-hand.
- Balances + list db-specs extended for §4.2 / §4.3.
- Vitest: bar (identity, «—», red negative), table (mixed column, server
  totals), drill-down button matrix (role × `shift_closed` ×
  `has_live_returns` × voided). `tsc -b` explicitly.
- Gate: `npm run verify:full` (real-database SQL).

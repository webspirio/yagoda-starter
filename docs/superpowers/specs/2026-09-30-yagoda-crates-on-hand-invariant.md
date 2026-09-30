# Yagoda CRM — Crates On-Hand Invariant Spec

**Date:** 2026-09-30
**Source:** the manual test report `docs/manual-testing/2026-09-30-crates-negative-on-hand.md`
(seven reproduced ways to drive «Пустих на точці» below zero, via API and via the browser),
and the `/grilling` + brainstorming session of 2026-09-30 that settled every decision below.

**Position in the schema:** no table and no column changes. This slice adds a write-time
guard over figures the schema already stores, and amends one rule (§6.9).

---

## 1. Goal

`on_hand` — «Пустих на точці» on `/crates`, `CrateStandingService` — must not be driven
below zero by a new document. Today nothing checks it: every one of the seven cases in the
report records a negative on the first try, and the screen can only paint it red afterwards.

`on_hand = received − Σ issued + Σ returned − Σ crate tare on all live receipts − Σ broken`

Under this formula a negative is never «the allotment is exceeded» (the reading §6.9 was
written for). It is always a missing or contradicting document: crates handed out that the
documents say never arrived. The correct response is to make the operator enter that
document first, not to record the contradiction.

## 2. Decisions (settled in grilling)

1. **Hard block, for operator and owner alike.** §6.9's «показує факт, а не спиняє» is
   amended (§7).
2. **Check the state after the write, and only on operations that decrease `on_hand`.**
   Operations that increase it are always allowed, even at a point that is already
   negative — otherwise a negative point could never be healed. A point that is already
   negative therefore refuses every decreasing operation until the missing document is
   entered.
3. **Minimal UI:** the refusal is translated in all six forms. Only «Видати ящики» gets an
   up-front hint and a ceiling.
4. **`tare_types.is_crate` toggling is out of scope** (follow-up, §9), although it is an
   eighth path to a negative.
5. **The refusal names the transfer in transit:** when a `sent` transfer with crates exists
   at the point, the message tells the operator to press «Прийняв» first.

## 3. Write paths

The guard runs **only when the operation's own delta is negative**. Every path knows its
delta without SQL.

| Path | Method | Δ `on_hand` | Guard runs when |
|---|---|---|---|
| Issue crates | `CratesService.issue` | −`units` | always |
| Void a crate return | `CratesService.voidReturn` | −`units` | always |
| Close shift | `ShiftsService.close` | −`broken_crates` | `broken_crates > 0` |
| Create receipt | `CreateIntakeCommand.create` | −(crate tare − `returned_crates`) | crate tare > `returned_crates` |
| Void transfer | `TransfersService.void` | −counted crates¹ | counted crates > 0 |
| Resolve dispute | `TransfersService.resolve` | `resolved_crates − reported_crates` | `resolved_crates < reported_crates` |

¹ What `transferCratesSql` counts for that transfer: `crates` if `accepted`,
`resolved_crates` if disputed and resolved, `reported_crates` if disputed and open, 0 if `sent`.

**Never guarded** (Δ ≥ 0 by construction): `TransfersService.accept` and `dispute` (both
only from `sent`, which counts 0), `CratesService.writeReturn`, `CratesService.voidIssuance`,
`ShiftsService.reopen` (sets `broken_crates` back to NULL), voiding a receipt and the
`voidReturnForIntake` inside it (`+tare − returned ≥ 0`, because `RETURNED_EXCEEDS_TARE`
already caps `returned_crates` at the receipt's crate tare).

**Order inside the transaction:** write the document (and its audit entry) first, then call
the guard as the **last** step. A refusal rolls back the whole transaction. In
`CreateIntakeCommand.create` the guard runs **before the payout**, next to the existing
§8.3 crates check, so a refused receipt never hands cash over.

## 4. The guard

### 4.1 One formula

`onHandSql(pointExpr)` is extracted into `backend/src/crates/crate-balance.service.ts`,
next to `crateTareUnitsSql`, `transferCratesSql` and `crateBookSql`, with the same
point-expression contract. `CrateStandingService` switches to it. The screen and the guard
then read one formula and cannot drift.

`inTransitCratesSql(pointExpr)` joins it there: Σ `crates` of non-voided `sent` transfers
at the point.

### 4.2 `CrateStockGuard`

A new leaf module `backend/src/crate-stock/` that imports no domain module, only the SQL
fragments from the crates file, the same way `point-cash` already reads `crateBookSql`. The
leaf is required: `CratesModule` imports `ShiftsModule`, so `ShiftsModule` cannot import
`CratesModule`. `ShiftsModule`, `TransfersModule`, `IntakesModule` and `CratesModule`
import the leaf.

```ts
assertOnHand(m: EntityManager, pointId: string, required: number): Promise<void>
```

1. `SELECT id FROM collection_points WHERE id = $1 FOR UPDATE`.
2. One query: `onHandSql($1) AS after`, `inTransitCratesSql($1) AS in_transit`.
3. If `after < 0`, throw (§5).

**Concurrency.** Under READ COMMITTED every statement takes a fresh snapshot. A second
transaction blocked on the point row reads the first one's committed document after the lock
is released, so two parallel issuances cannot both pass. The point lock is always taken
**last**, after whatever supplier or document locks the path already takes, so it adds no
new lock-order inversion. Nothing locks `collection_points` earlier in any path today.

## 5. Error contract

```
409 Conflict
{
  "code": "CRATES_ON_HAND_INSUFFICIENT",
  "message": "The point has 5 empty crates, this takes 15",
  "available": 5,     // after + required: the figure before this operation; may be negative
  "required": 15,
  "in_transit": 20
}
```

The English `message` follows the backend convention (`RETURN_EXCEEDS_OUTSTANDING`). The
Ukrainian sentence is built by the frontend.

## 6. Frontend

### 6.1 Error mapping (`shared/lib/api-error`)

- New `apiErrorParams(error)`: the numeric fields of the error body, for `t(key, params)`.
  `apiErrorToBanner`'s signature does not change.
- `apiErrorToBanner` picks the key for this code itself:
  `crates.errors.onHandInsufficientInTransit` when `in_transit > 0`, otherwise
  `crates.errors.onHandInsufficient`. It is one explicit branch, not a general mechanism.
- The same code goes into `pages/reception/lib/apiErrorToFields.ts`.

Copy (uk; en mirrors it):

- `onHandInsufficient`: «На точці {{available}} пустих ящиків, а ця операція забирає {{required}}.»
- `onHandInsufficientInTransit`: «На точці {{available}} пустих ящиків, а ця операція забирає
  {{required}}. У дорозі ще {{in_transit}} ящ. — спершу натисніть «Прийняв» у Касі точки.»

### 6.2 The six forms

The banner line changes from `t(key)` to `t(key, apiErrorParams(error))` in: issue crates
(`features/issue-crates`), close shift (`features/count-shift`), reception
(`pages/reception`), void transfer and void return (`features/void-document`), and resolve
dispute (`features/resolve-transfer`).

### 6.3 «Видати ящики» up-front

- `GET /crate-standing` gains `in_transit` (same fragment as the guard), and
  `CrateStandingResponse` / the frontend type gain it too.
- Under the «Ящиків» field: «На точці {{on_hand}} пустих», from `useCrateStandingQuery`
  (`entities/crate`, already warm from the page). The hint adds «спершу прийміть переказ»
  when `in_transit > 0`.
- Validation: `units ≤ on_hand`, message «На точці лише {{on_hand}} пустих». When
  `on_hand ≤ 0`, the submit button is disabled and the hint is red.
- The server 409 stays the final word: the figure can change between opening the dialog and
  submitting it.

`/crates` keeps its red «Пустих менше нуля…» warning, for data written before this slice.

## 7. Seed and rules

- **`dev-seed.history.ts` gains property 4, «non-negative empties».** The generator tracks
  each point's empties through the season and raises a transfer's `crates` ahead of any day
  whose issuances, receipt crate tare and breakage would take the point below zero. It stays
  deterministic (no `Math.random`), mirroring the existing rule that every generated payout
  is funded by a transfer of exactly its amount.
- `dev-seed.data.ts` gets a targeted fix only if a curated point is negative without the
  history.
- `dev-seed.db-spec.ts` asserts `on_hand ≥ 0` for **every** seeded point, via `onHandSql`.
  The seed writes raw SQL past the services, so this assertion is its only guard. The curated
  cash figures (Шипинки 20 910.00 etc.) are unaffected, because crates move no cash.
- `26-rules-by-example.md` §6.9 gains «→ **Правка (2026-09-30):**». A negative «пустих» is
  forbidden: an operation taking more empties than the point has is refused. The old text
  was written for the allotment-based formula; empties are now counted from transfers. The
  red warning remains only for data recorded before the amendment.
- `28-db-schema.dbml`: no structural change. One sentence stating the invariant goes into
  the `crate_issuances` Note.

## 8. Testing and verification

**Real Postgres (`*.db-spec.ts`, `verify:full`):**

- `crate-stock.db-spec.ts`:
  - **The seven report cases as seven refusals.** Each one builds its point state, runs the
    operation through the real service, expects 409 `CRATES_ON_HAND_INSUFFICIENT` with the
    right `available` / `required` / `in_transit`, and asserts the document was **not**
    written.
  - **Boundary:** an operation for exactly `available` passes and leaves 0.
  - **Increasing paths on a negative point** (state seeded by SQL): accept transfer, crate
    return, void issuance, reopen shift, void a receipt carrying a linked return. All pass.
  - **Races,** after `crates-race.db-spec.ts`: 10 empties and two concurrent issuances of 10
    for different suppliers — exactly one passes and `on_hand` ends at 0. Also a concurrent
    issuance plus a close with breakage.
- `crate-standing.db-spec.ts` stays green and unchanged, proving the `onHandSql` extraction
  kept the formula. It also covers the new `in_transit` field.
- `dev-seed.db-spec.ts`: `on_hand ≥ 0` for every seeded point.

**Unit (`*.spec.ts`):** for each of the six paths, the guard is called with the right
`required`, and is **not** called when Δ ≥ 0 (breakage 0, resolved ≥ reported, tare ≤
returned, voiding a `sent` transfer).

**Frontend:** Vitest for the issue dialog's hint and ceiling, `apiErrorToBanner`'s key
choice, and `apiErrorParams`. Plus `tsc -b`, because Vitest does not typecheck.

**Done when:**

1. `npm run verify:full` is green, with its verdict line quoted and every skipped row named.
2. The seven browser cases, re-run on fresh points, each end in the Ukrainian refusal with
   «Пустих на точці» ≥ 0. The report gains an «Після виправлення» section with screenshots.
   The throwaway scripts and the `NEG*` / `BR*` test points are then removed.

## 9. Out of scope → follow-ups

Appended to `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md`:

- **`tare_types.is_crate` toggle.** Moving the single crate flag onto a tare type already on
  receipts reclassifies history at every point at once, and can drive many points negative in
  one PATCH. Candidate fix: refuse the toggle once the type is on any live receipt.
- **Up-front hints** in the void-transfer, resolve-dispute and close-shift dialogs, e.g.
  «з цього переказу вже видано 15».

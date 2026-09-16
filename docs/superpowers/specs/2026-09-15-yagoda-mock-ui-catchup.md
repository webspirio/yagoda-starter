# Mock UI catch-up: season seed, the price sheet, and the top-up card

**Date:** 2026-09-15
**Issues:** #89 (price sheet), #61/#81 (intake top-ups UI)
**Reference mock:** `webspirio/yagoda-crm` — `src/pages/PricesPage.tsx`, `src/components/common/bits.tsx`

## 0. Why this document exists

Three strands arrived as one request: "build UI for #81, port the UI from the
mock, e.g. #89", plus "seed more test data so the UI can actually be tested".
They are three independent subsystems and ship as three PRs, in this order,
because each later one reads better on the data the earlier one seeds:

| PR | Slice | Touches |
|----|-------|---------|
| A | Season seed | `backend/src/seed/` only |
| B | #89 price sheet | `grade-prices` (two new routes) + `pages/prices` |
| C | Top-up UI | `pages/supplier-card` + a new `features/top-up-intake` |

A fourth deliverable is not code: a screen-by-screen audit of the starter
against the mock, filed as one issue per divergence, so that "port the whole
UI" becomes a list instead of a mood.

## 1. What the mock has that the starter does not

Mock screens with no starter counterpart: `crates` (Ящики), `cost`
(Собівартість дня), `reweigh` (Переважування), `network` (Середня ціна по
мережі), `sheet` (Аркуш керівника).

`crates` is blocked on a backend slice that does not exist — `crate_issuances`,
`crate_returns`, `crate_return_allocations` are the three tables still
outstanding from the DBML's original seventeen. The other four are analytical
reads over tables that DO exist, so they are unblocked but out of scope here.
None of the five is built in this effort; all five get an issue.

## 2. PR A — the season seed

### 2.1 The problem

The seeded history is one closed shift yesterday plus three open shifts today:
ten receipts, four payouts, one top-up. Every screen that plots or paginates —
the journal, the supplier card timeline, the dashboard sparklines — renders
either empty or on a single point of data, so a UI regression in any of them is
invisible.

### 2.2 The decision: grow the base seed, no second profile

The owner's call, taken with the cost stated: growing the ONE seed (rather than
adding a `--big` profile) makes every `*.db-spec.ts` run carry the larger
dataset, and `app_test` is never truncated between runs. That cost is accepted.
The mitigation is that nothing about the existing dataset moves.

### 2.3 The mechanism: widen `SeedDay`, generate the backfill

`dev-seed.ts:351` is the single seam:

```ts
const dateOf = (day: SeedDay) => (day === 'today' ? days!.today : days!.yesterday);
```

`SeedDay` becomes `'today' | 'yesterday' | number`, where a number is "N days
before today". `dateOf` gains one branch. Nothing else in the runner changes.

**The curated day is frozen.** Every hand-written row in `SEED_SHIFTS`,
`SEED_INTAKES`, `SEED_PAYOUTS`, `SEED_CASH_COUNTS` and `SEED_TRANSFERS` keeps
its exact values, because they carry the seeded incidents the screens are read
against — above all Шипинки closing 90 UAH short, which is the only thing that
makes the owner's working list non-empty. The history is ADDITIVE and lives in
a new module, `dev-seed.history.ts`, so a reader can tell curated data from
generated data by which file it is in.

### 2.4 Determinism

The generator takes no randomness from the environment: it is seeded by a
constant and produces the same dataset on every run. A seed whose output
changes per run cannot be asserted against, and idempotency (the seed's
existing contract — every row looked up by natural key, inserted only when
missing) requires stable natural keys. Receipt codes are the natural key, so
the generator's numbering must be a pure function of (point, day, index).

### 2.5 Shape of the generated history

- 30 business days before yesterday, at the five working points.
- Every generated shift is CLOSED with a cash count — an open shift in the past
  would be a bug the screens would faithfully render.
- Receipts per point per day vary (roughly 3 to 8) so the journal paginates and
  the sparklines have shape; suppliers are drawn from that point's own roster.
- Prices: the generated days write no `grade_prices` rows. Prices carry over
  (spec `2026-09-07` section 8.1), so the historical price IS the current one,
  and writing a row per day would silently re-introduce the daily scheme that
  slice removed.
- Top-ups: three more, on receipts from the generated history, so the supplier
  card in PR C has a timeline with more than one entry.

### 2.6 Divergent prices, for PR B

The current dataset prices every active grade at every working point from one
number, so a sheet built on it shows one uniform column and the "різні · 145–150"
rendering is never exercised. `SEED_PRICE_CHANGES` gains per-point divergence on
at least two grades, and the warehouse keeps its own higher price (it already
does — that is section 4.8's rule and the reason the sheet excludes it from
"встановити всім").

## 3. PR B — issue #89, the price sheet

### 3.1 What the issue asks

Rows are grades, columns are points, plus a leading column "Ціна дня загальна"
carrying a "встановити всім" button. When the points disagree the column reads
"різні · 145–150". The warehouse is never touched by that button.

### 3.2 The rule this rests on

DBML `collection_points`, section 4.8: «склад це звичайний пункт прийому зі
своєю, вищою ціною, якого жест "поставити всім" НЕ чіпає». The exclusion is the
schema's rule, not the mock's styling. `point_kind` already exists, so the
"common" set is `kind = 'reception' AND is_active`.

### 3.3 The day question, settled

Issue #89 restates the DBML's key as the trio (day, point, grade). The
implementation deliberately removed `business_date` (owner's decision
2026-09-07, cost recorded in spec section 8.1: prices carry over until
changed). **This slice does not restore it.** The sheet shows CURRENT prices —
the newest row per (point, grade) — and carries no date picker. Restoring the
daily key is a separate slice that would have to re-plumb reception and reverse
a recorded owner decision; it is filed as an issue, not smuggled in here.

Consequence for copy: the column is labelled as the issue labels it, but the
screen must not promise a date it cannot honour. No "ціни на 15.09" heading.

### 3.4 Why the backend is touched

Two gaps, both real:

- **Read.** `CurrentGradePricesQueryDto` caps at 100 rows and its own header
  says «the owner's price screen must therefore fetch one point at a time».
  5 points x 14 grades already exceeds it once the grade list grows.
- **Write.** There is no bulk route. A client-side loop of N POSTs can fail
  half-way, and a half-applied row renders as "різні · 145–150" — which is
  indistinguishable from prices the owner set differently on purpose. The
  screen would be lying about the state of the network.

Spec `2026-09-07` section 8.1 anticipated exactly this: «Carry this into
section 4.8's bulk route when it is built — that route must be ONE
transaction».

### 3.5 New routes

```
GET  /grade-prices/sheet   @Auth()                    -> SheetResponse
POST /grade-prices/bulk    @Auth(UserRole.NetworkOwner) -> { created: number }
```

`GET /grade-prices/sheet` returns one row per grade with a price per point.
It is scoped by `resolvePointFilter`, so an OPERATOR receives a sheet with a
single column — their own point — and no new access rule is written. Owner
receives every active point.

`POST /grade-prices/bulk` takes one grade, one set of three numbers, an
optional reason, and an explicit list of point ids; it writes all of them in
ONE transaction. The route does NOT compute "all reception points" server-side:
the client names the points, and the server validates each through
`assertOwnsPoint`. That keeps the section 4.8 exclusion visible on the screen
that performs the gesture rather than hidden in a service.

### 3.6 The sheet is a second read path, and that is named

`/sheet` and `/current` now both answer "what does this grade cost here".
They are kept separate because their consumers differ — `/current` is the
operator's intake picker (one point, paginated, `include_inactive`), `/sheet`
is the owner's grid (all points, unpaginated, active grades only). They share
one SQL helper so the "newest row wins" rule has exactly one implementation.

### 3.7 The cell

A cell shows `base_price`. Clicking it opens the existing `SetPriceDialog`,
which already edits all three numbers plus a reason. "Встановити всім" opens the
same dialog with no point preselected and posts to `/bulk`.
`max_markup` and `max_discount` are NOT NULL with no default and nothing to
inherit, so the bulk write sends all three — the dialog's values, applied
identically to every named point.

### 3.8 The operator

Unchanged in substance: one column, no edit affordance, a lock icon with a
caption. Mock section 5.4 is explicit that a price read-only THROUGH ROLE stays
on screen as «значення + іконка замка + підпис», because «приховане поле
породжує підозру й дзвінки; заблоковане з підписом вчить правилу».

## 4. PR C — the top-up UI

### 4.1 Where it lives

The supplier card, and only there. PR #81's own body names it: «the one filter
the follow-up supplier card depends on». The journal stays a register of
receipts and payouts in this PR; extending it to a third document type is filed
as an issue.

### 4.2 What the screen must say

`GET /supplier-balance` returns a single `debt` string with no breakdown, so the
card's timeline is the ONLY place the owner can learn why the balance is what it
is. The timeline therefore gains top-up entries showing amount, reason, the
parent receipt's code, and author.

`counts_toward_balance` is returned per row and is false when either the top-up
or its PARENT INTAKE is voided. A row whose parent was voided is still live and
must still be listed — hiding it is the silence the mapper's flag exists to
prevent — so it renders present but struck, captioned with which of the two was
voided.

### 4.3 Actions

- «Додати залишок» on a receipt row in the timeline, owner only. Amount and a
  NON-BLANK reason are both required (`@Length(1,500)` plus `\S`); the reason is
  the point of the feature per #61 («щоб при перегляді історії було ясно
  зрозуміло, чому ми маємо викладати дві тисячі цьому постачальнику»).
- Void a top-up, owner only, with a reason. There is no edit path: section 9.3
  makes a correction a void plus a new document.
- The operator sees top-ups and creates none. Both create and void are
  `@Auth(UserRole.NetworkOwner)`, so the buttons are ABSENT for an operator, not
  disabled — section 10.2's rule, «заблокована кнопка вчить шукати обхід,
  відсутня не вчить нічого».

### 4.4 Errors worth surfacing by name

`SUPPLIER_INACTIVE` — a top-up against a deactivated supplier is refused at the
source, and the screen says so rather than showing a generic failure.

## 5. Out of scope, each filed as an issue

- The five missing mock screens (crates, cost, reweigh, network, sheet).
- Restoring `business_date` to `grade_prices`.
- Top-ups in the journal.
- A `breakdown` on `GET /supplier-balance` so the card need not infer the three
  terms from a timeline.

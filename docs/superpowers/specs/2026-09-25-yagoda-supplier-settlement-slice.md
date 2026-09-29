# Yagoda CRM — Supplier Settlement Slice Spec (§3.3, §3.10)

**Date:** 2026-09-25
**Source:** `26-rules-by-example.md` §3.3 (Гасіння — найстаріший борг першим), §3.10 (Картка
людини), §9.3 (Виправлення — новою подією), the `suppliers` and `payouts` Notes in
`28-db-schema.dbml`, GitHub issue #125 (Анулювання квитанції та виплати), the reference
implementation `.reference/yagoda-crm/src/pages/SupplierPage.tsx` («Відкриті залишки — за що
саме винні»), and the `/grilling` + brainstorming session of 2026-09-25 that produced the
decisions in §3.

**Position in the schema:** twenty-two tables, unchanged. This slice adds **no table, no
column and no migration**. It adds a read model.

**THIS SLICE IS READ-ONLY.** It changes nothing about how documents are written or voided.
Voiding stays two independent actions on two independent documents (§3.11). The void dialog
that #125 asks for is slice 2 (§7).

---

## 1. Goal

Answer «за що саме винні» without storing the answer.

Today a supplier's debt is one number — `Σ intakes + Σ intake_top_ups − Σ payouts`, voided
rows excluded — and the card shows three separate document lists under it. The card cannot
say which receipts are still open, how old the oldest open debt is, or which berries a payout
paid for. §3.10 asked for exactly that; the 04.09.2026 edit removed it together with the
stored `payout_allocations` table, because a stored breakdown is where the client's own
workbook broke (124 breaks in 1 473 rows).

This slice brings the answer back as a **projection computed at read time** from the same
three histories and the same four `voided_at` filters the debt formula already uses. Nothing
is stored, so nothing can drift from the documents, and a void of any document re-derives the
breakdown by itself.

## 2. The problem, restated

The discussion that led here started from a proposal to reintroduce an `allocations` table
with a mutable status. That proposal was examined and not taken. The actual problems are
three, and they are distinct:

- **P1 — no per-receipt answer.** «Відкриті залишки», «найстаріший борг з 12.07 — 23 дні» and
  «закрито ягоду за …» cannot be produced from two sums. They need an allocation rule.
- **P2 — #125: voiding a receipt does not see its payout.** The issue's stated consequence
  («каса не сходиться при закритті зміни») does NOT follow from a forgotten payout void:
  voiding a payout does not move cash (§9.3, `payouts` Note). Cash diverges from the drawer
  only when money physically came back and nobody recorded `return_settled_*`. P2 is a
  dialog-and-cash-return problem, not a linkage problem, and it is deferred (§7).
- **P3 — a payout «for this berry» must land on this receipt.** Pure oldest-first FIFO would
  put a payout made at the counter for today's receipt onto older debt. Not a problem on its
  own; a constraint on how P1 is answered.

The audit question the proposal raised («why did an allocation become unallocated?») exists
only when allocations are stored state. Under a projection there is no state to explain.

## 3. Decisions

### 3.1 Allocation exists, but is not stored

The breakdown is computed on every read from `intakes`, `intake_top_ups` and `payouts`.
There is no `payout_allocations` table and none may be added. This is the 04.09.2026 decision
kept, not reversed: what was removed was the *stored* breakdown.

### 3.2 The rule: bound first, then oldest-first

Two queues per supplier, both excluding voided rows, both in the same total order (§3.4):

- **debt queue** — receipts and top-ups, each its own line;
- **payout queue** — payouts.

Pass 1 — **bound.** A payout with `intake_id` whose receipt is live covers that receipt, up
to the smaller of the payout's remainder and the receipt's remaining open amount.

Pass 2 — **FIFO.** Every remaining amount — payouts without `intake_id`, the excess of a
bound payout, a payout whose receipt is voided — is applied to the debt queue from its head,
line by line, until the money or the open lines run out.

What is left after pass 2 is `unallocated`. It equals `−debt` when debt is negative and is
`0.00` otherwise. There is no separate «переплата» number and no «аванс» line.

This **changes the client's written rule.** §3.3 says «найстаріший борг першим» and shows
8 000 paid against 6 900 of old debt plus 5 460 today: the client's worked example closes the
three old dates first. Under this slice the same payout, if bound to today's receipt, closes
today's 5 460 first and puts 2 540 on 12.07. The change is recorded as a dated edit in §3.3
(§6) and must be confirmed with the client; it was chosen because it matches what the
operator did («видав за цю ягоду») and uses `payouts.intake_id`, which already exists.

### 3.3 Leftover money may land on a line younger than the payout

Pass 2 applies to the oldest **open** line regardless of the payout's own date. Example: R1
1000, R2 300, P1 1300 bound to R2; R2 is voided and R2' 250 is written later. Pass 1 no
longer finds R2; P1 goes whole into pass 2: 1000 to R1, 250 to R2', 50 unallocated. That 50
is the negative debt that §3.5 says «гаситься сам наступною здачею» — the next receipt will
absorb it. Forbidding «money into the future» would make the breakdown disagree with `debt`
after the next receipt, which is the one thing it must never do.

### 3.4 Queue order is `(business_date, created_at, id)`

For receipts and payouts, `business_date` is their shift's. The clock alone would misplace a
document written into a shift the owner reopened days later — by `created_at` it is the
youngest, by the day of the berries it is old debt. `id` last makes the order total, for the
same reason `SupplierBalanceService.list` orders totally: two rows with equal stamps must not
swap between two reads.

### 3.5 A top-up is its own line, dated by its parent receipt

A top-up has neither `shift_id` nor `business_date` (it is written from the owner's desk
against a closed shift) — only `created_at` and a parent. It enters the debt queue as a
separate line with **its parent receipt's `business_date`** and its own `created_at`, so it
sits right behind the receipt it tops up. §4.6 is why: a top-up is money for the berries of
that day, and «найстаріший борг з 12.07» must say 12.07 even when the top-up was written on
20.07. It is not merged into the receipt's line — the 11.09.2026 note in the `suppliers` Note
forbids showing a number bigger than the printed «Разом» on the receipt's own row.

A bound payout covers only its receipt's `amount` in pass 1; the receipt's top-ups are
ordinary FIFO lines.

### 3.6 The projection lives in TypeScript, for one supplier

`settle()` is a pure function over already-loaded documents, built on `money.ts`. Not SQL:
«bound first, then FIFO» is two passes with a self-join in SQL and would be unreadable where
the rule has to be readable; and it is one person's season (tens of rows), which is where the
question is asked. A future «найстаріший борг» column on the «Залишки» list is a separate
slice with its own SQL — it needs only plain FIFO by date and must not re-implement this.

### 3.7 One new endpoint; `/balance` is untouched

`GET /suppliers/:id/settlement` (§4.3). `GET /suppliers/:id/balance` stays a single number:
the payout ceiling and several small readers need only that, and must not pay for a
breakdown. The name is `settlement`, not `allocations`: no table by that name exists, and the
name must not suggest stored state.

### 3.8 The card keeps its three history lists and adds the settlement

`settlement` carries only live documents and only settlement fields. The history needs voided
rows, reasons and authors (for the void button), so it stays on its three queries. The card
adds a fourth query and joins by id on the client. Duplicating every document field into
`settlement` was considered and rejected: `settlement` is about arithmetic, not documents.

### 3.9 No pagination on `settlement`

A breakdown over a page of documents is a lie. The ceiling is one supplier's season.

### 3.10 The UI follows the reference

`.reference/yagoda-crm/src/pages/SupplierPage.tsx` shows the section «Відкриті залишки — за що
саме винні» above the history, the «найстаріший з … — N днів» hint on the balance tile, and
per-row captions in the history. This slice reproduces that **shape**; the reference's
**data** came from stored `p.allocations` and is not followed.

### 3.11 Voiding is unchanged

Two documents, two voids, no cascade, no prompt. A cascade in either direction was rejected:
in the common case («сторно і нова правильна квитанція», the money stays with the person and
covers the corrected receipt) voiding the payout would be wrong.

### 3.12 Rule documents are edited in this slice

§3.3, §3.10, §9.3 of `26-rules-by-example.md` and the `suppliers` / `payouts` Notes of
`28-db-schema.dbml` get dated edits (§6). Without them the DBML says «розподілу не існує» and
the next reader rebuilds the prohibition — the same trap the `collection_points` Note
describes for `target_crates`.

## 4. Design

### 4.1 `backend/src/supplier-balance/settlement.ts` — the rule

Pure. No Nest, no database. Already inside the money `files` array of
`backend/eslint.config.mjs` via `src/supplier-balance/**/*.ts`, so every operation goes
through `money.ts` (`add`, `sub`, `cmp`, `sum`, `isZero`, `isNegative`); `min` is `cmp`, not a
new helper.

```ts
interface DebtLine {
  id: string;
  kind: 'intake' | 'top_up';
  code: string;            // a top-up borrows its parent's code, as the card already does
  intake_id: string;       // own id for an intake, the parent's for a top-up
  business_date: string;   // the parent's for a top-up (§3.5)
  created_at: string;
  amount: string;
}
interface PayoutLine {
  id: string;
  code: string;
  business_date: string;
  created_at: string;
  amount: string;
  intake_id: string | null;
}
interface Settlement {
  unallocated: string;
  lines: (DebtLine & { paid: string; open: string;
                       covered_by: { payout_id: string; amount: string }[] })[];
  payouts: (PayoutLine & { covers: { line_id: string; kind: 'intake' | 'top_up'; amount: string }[];
                           unallocated: string })[];
}
function settle(lines: DebtLine[], payouts: PayoutLine[]): Settlement;
```

Both inputs arrive **already ordered** by `(business_date, created_at, id)` from SQL;
`settle` does not sort. Pass 1 walks payouts in order and, for each with an `intake_id` that
matches a line of kind `intake`, takes `min(left, open)`. Pass 2 walks payouts in order and,
for each with `left > 0`, walks the debt queue from a cursor at the first open line. The
cursor only advances (a line, once closed, stays closed), so pass 2 is O(lines + payouts).

Invariants, each a test:

- `Σ open − Σ unallocated = Σ lines.amount − Σ payouts.amount`;
- `paid + open = amount` on every line; `Σ covers + unallocated = amount` on every payout;
- `covered_by` and `covers` are the same set of triples seen from both sides;
- with no `intake_id` at all, `open` on every line equals `clamp(cum − paid_total, 0, amount)`.

### 4.2 `SupplierBalanceService.settlementFor(supplierId)`

Three reads in one transaction, each carrying the filters `debtSql` carries:

- receipts — `i.voided_at IS NULL`, joined to `shifts` for `business_date`;
- top-ups — `t.voided_at IS NULL AND ti.voided_at IS NULL`, joined to the parent and to the
  parent's shift for `business_date`;
- payouts — `p.voided_at IS NULL`, joined to `shifts` for `business_date`.

Each ordered by `(business_date, created_at, id)`; receipts and top-ups are merged by that key
in TypeScript (stable merge, same key) before `settle`. Amounts leave Postgres as `::text`.
`debt` is read by `debtFor` in the same transaction, and the response asserts nothing — the
`db-spec` asserts `debt === Σ open − unallocated`.

### 4.3 `GET /suppliers/:id/settlement`

In `SupplierBalanceController`, `@Auth()`, same depth as `/balance`. Visibility through
`SuppliersService.findOne(actor, id)` — another point's supplier is 404, not 403. Response
through `toSettlementResponse`, field by field:

```text
{
  supplier_id, debt, unallocated,
  lines:   [{ kind, id, code, intake_id, business_date, created_at,
              amount, paid, open, covered_by: [{ payout_id, payout_code, amount }] }],
  payouts: [{ id, code, business_date, created_at, amount, intake_id,
              covers: [{ line_id, kind, amount }], unallocated }]
}
```

All amounts are scale-2 strings. `lines` is in queue order, oldest first. A supplier with no
documents gets empty arrays and `debt: "0.00"`. The only error is `findOne`'s 404.

### 4.4 Frontend

**`entities/supplier`** — `useSupplierSettlementQuery(id)` and the `SupplierSettlement` type,
beside `useSupplierBalanceQuery`. Its query key is invalidated everywhere the balance key is
(payout create/void, receipt create/void, top-up create/void); a stale breakdown under a
fresh tile is the one visible bug this slice can introduce.

**`pages/supplier-card`** — read-only, no new feature slice:

1. `OpenBalances.tsx` — section above the history, rendered only when some line has
   `open > 0`. Row: code · long date · for an intake, the grades and kg from the already
   loaded `Intake` found by `intake_id` (absent from the loaded page → no sub-caption, never
   an error) · for a top-up, «Доплата до Ч-0412» · `open` right-aligned, amber. Below the list,
   only when `unallocated > 0`: one leaf-toned row «Переплата — не розподілено N ₴». Order as
   received.
2. The «Залишок» tile gets `hint`: «найстаріший з 12.07 — 23 дні» (days from the first open
   line's `business_date` to today, `shared/lib/date`) or «усе розраховано».
3. `SupplierTimeline` — two captions under the amount: on an intake / top-up row «у залишок
   N ₴» when `open > 0`; on a payout row «закрито ягоду за 12.07, 15.07» from the distinct
   `business_date`s of the lines in `covers`, plus «не розподілено N ₴» when its `unallocated
   > 0`. Voided rows get no caption. The page builds two `Map`s once (`openByLineId`,
   `coversByPayoutId`) and passes them down.

Loading and error states join the existing ones: spinner while any query pends, the shared
banner if any fails. i18n keys in `uk` and `en`; tests assert English (`frontend-tests-pin-english`).

## 5. Tests and verification

- `settlement.spec.ts` (fast tier) — the cases of §3.2, §3.3, §3.5 by example, the four
  invariants of §4.1, and a `fast-check` property over random queues (amounts, bindings,
  voids) asserting the balance identity and non-negativity of every `open`, `paid`,
  `unallocated`. The property is the test that matters: a rounding slip is not guessable by
  example.
- `settlement.db-spec.ts` (`verify:full`) — `settlementFor` against Postgres: the four
  `voided_at` filters, the `(business_date, created_at, id)` order across all three sources,
  the parent date on a top-up, and `debt === Σ open − unallocated`. Per-run uuid fixtures as in
  `supplier-balance-list.db-spec.ts`.
- `supplier-balance.controller.spec.ts` — 404 through `findOne`; mapper shape.
- Frontend — `OpenBalances.test.tsx` (order, top-up row, overpayment row, hidden when nothing
  is open), `SupplierCardPage.test.tsx` (tile hint, captions, settlement error → banner);
  `tsc -b` separately (`vitest-does-not-typecheck`).

The verdict for the slice is `npm run verify:full` — money code and real SQL are involved —
with any `SKIPPED` row named. Frontend-only steps may use `npm run verify` in between.

## 6. Rule and schema edits (dated 2026-09-25)

`26-rules-by-example.md`:

- **§3.3** — after «Цього правила більше немає»: the breakdown returns as a computed
  projection; the rule is §3.2 of this spec in the client's words; the 8 000 / 6 900 / 5 460
  example re-worked under it; the divergence from «найстаріший першим» named and marked for
  client confirmation; the caption under the payout field («з них … закриють попередні
  залишки») explicitly NOT restored.
- **§3.10** — the section «Відкриті залишки — за що саме винні» and «найстаріший борг з …»
  return; a top-up is its own row; «яку ягоду закрила виплата» is a history caption; the list
  is a projection, so it re-derives after a void and the paper does not know.
- **§9.3** — «сторно розкручує розподіл НАЗАД» now holds mechanically: there is no stored
  breakdown to unwind.

`28-db-schema.dbml`:

- `suppliers` Note, new subsection after «Чого більше немає»: **«Розподіл є, але не
  зберігається»** — no `payout_allocations`, none may be added; the rule and its module;
  `debt` from `/balance` and `Σ open − unallocated` from `/settlement` are one number, held by
  a test. The «Розподілу і FIFO (§3.3)» bullet points here.
- `payouts` Note: «розподілу немає» → «збереженого розподілу немає»; `intake_id` is now read by
  the projection as «спершу ця квитанція».

`docs/superpowers/2026-09-05-foundation-slice-follow-ups.md`: the two items of §7.

## 7. Out of scope → follow-ups

- **Slice 2 — the void dialog for a receipt with a bound payout (#125).** When the receipt
  being voided has a live payout with `intake_id` pointing at it, the dialog shows it and
  requires one of three explicit choices, none preselected: leave the payout (the common
  case — a corrected receipt follows); void both, money already back in the drawer
  (`return_settled_*` set in the same transaction); void both, return expected. Both voids in
  one transaction with one reason; rights are the intersection of §9.4 for both documents.
  #125 should be annotated that its cash mismatch comes from an unrecorded `return_settled`,
  not from a forgotten payout void.
- **«Найстаріший борг» on the «Залишки» list** — separate slice, plain FIFO by date in SQL.
- **Client confirmation of the §3.3 change** — the projection is built on «bound first»; if
  the client insists on strict oldest-first, pass 1 is removed and nothing else changes.

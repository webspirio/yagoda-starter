# Yagoda CRM — Counting the Crate Deposits at Open and Close

**Date:** 2026-10-14
**Ticket:** #178 (continues #114)
**Source:** the `/grilling` and brainstorming sessions of 2026-10-14; the client's answers
recorded in the issue body («завдатки лежать окремо — так»; «з чого починати — порахувати,
та/або встановити 0»).

**Position in the schema:** no migration. `cash_counts.book` already has `crates`, and
`UQ_cash_counts_shift_book_kind` already keys on the book. Until now nothing wrote a
`crates` row; this slice is the first writer.

---

## 1. Goal

When a shift opens and when it closes, the operator types two figures — **Каса** (berry
money) and **Завдатки** (crate deposits) — and the system compares each with what it should
be and shows each discrepancy on its own:

|          | Порахували | Має бути  | Розбіжність |
|----------|-----------:|----------:|------------:|
| Каса     | 32 016,10  | 32 016,10 | 0,00        |
| Завдатки | 14 400,00  | 14 760,00 | **−360,00** |

A discrepancy never blocks. The owner sees it and explains it exactly as for the berry book.

### Success (the issue's checklist)

- The open and close dialogs have two fields, «Каса» and «Завдатки».
- The discrepancy is visible separately per book.
- The count history shows two rows for every opening and every closing.

## 2. Decisions (grilling, 2026-10-14)

| # | Question | Decision |
|---|----------|----------|
| D1 | What is «має бути» for deposits? | **Anchored on the previous count**, like the berry book. Opening expects the last non-midday crates count; closing expects this shift's opening crates count plus this shift's crate movements. A −360 shortfall shows once, on the count that found it, and does not repeat. |
| D2 | First count at a point | Becomes the anchor: `expected = counted`, discrepancy 0. Zero is a valid figure. |
| D3 | How is the owner told? | **As for the berry book**: a red ⚠ row in the count history, «Пояснити» for the owner, an operator note for the counter. Real notifications (Telegram/push) are a separate ticket for both books. |
| D4 | Void of a crate document in an OPEN shift | **The deposit went back over the counter** — a voided issuance/return is out of the closing expectation, the existing rule (crates slice decision 7) unchanged. Same reading as a payout voided in an open shift (`returned_on_void`). A void in a closed shift cannot move an already-snapshotted expectation; no «expected return» triple is introduced. **Accepted edge, not handled:** the owner voids a crate document in a CLOSED shift and then reopens that shift — the re-close expects without that deposit although the money never left the drawer, so a phantom + discrepancy appears once. |
| D5 | The «Завдатки» card on «Каса точки» | Headline: **in the drawer should be** (anchored, D1). Muted beneath it: «завдатків за N ящиків — X» (the supplier liability, today's `crate_deposits`), and the discrepancy when non-zero. |
| D6 | Midday recount | **Berry only**, unchanged. |

## 3. Backend

### 3.1 API

`OpenShiftDto` and `CloseShiftDto` gain a required `counted_deposits` — same validation as
`counted_amount` (`^\d{1,10}(\.\d{1,2})?$`, `@CanonicalDecimal()`), zero allowed, no default.
A missing field is a 400: a figure that can be skipped gets skipped (same reasoning as
`broken_crates`).

### 3.2 Writes

`ShiftsService.open` and `close` each write **two** `cash_counts` rows in their existing
transaction — `book = 'berry'` and `book = 'crates'` — with one `cash-count.recorded` audit
entry per row, now carrying `book`.

`reopen` is unchanged: its `UPDATE … WHERE shift_id AND kind = 'closing'` already demotes
both books' closing rows to `midday`, and the re-close writes both again.

### 3.3 The crates expectation (`PointCashService`)

- `anchorSql(point, asOf, book)` — the book becomes a parameter (an SQL literal chosen by the
  caller from the `CashBook` enum, never a request value).
- `crateMovementsSql(shift)` — the crate book's movements of ONE shift:
  `Σ crate_issuances.deposit_taken − Σ crate_returns.deposit_refund`, both
  `shift_id = shift AND voided_at IS NULL` (D4). Receipt-mode issuances carry 0 by
  `CHK_crate_issuances_receipt_no_money`, so no mode filter is needed.
- `expectedForOpening(point, book)` — the last non-midday count of that book, or `null`.
- `expectedForClosing(shift, book)` — that shift's opening count of that book plus that
  book's movements, or `null`.
- `null` → `expected = counted` (D2). This also covers the transition: a shift opened before
  the release has no crates opening row, so its close anchors the book.

### 3.4 Reads

`GET /point-cash` rows gain:

- `crate_cash` — the anchored crates figure as of `as_of` (anchor + movements when the anchor
  is an opening), `null` when the point has never counted its deposits.
- `crate_unexplained_difference` — `Σ (counted − expected)` over the point's non-midday crates
  counts up to `as_of`, mirroring `unexplained_difference`.

`crate_deposits` and `crate_deposit_units` keep their meaning (lifetime liability, no
`as_of`).

### 3.5 Notes and explanations

`count-notes.ts` drops the `book !== berry` refusal: `explanation` and `operator_note` apply
to any opening/closing count with a non-zero discrepancy, either book. `is_open`, the
`only_discrepancies` filter and the cash-count list already ignore the book, so crates rows
appear there with no further change. The list orders `berry` before `crates` within one
`counted_at`.

### 3.6 Docs

DBML `cash_counts` Note (the «trigger to revisit» paragraph is resolved by D4),
`cash-book.enum.ts` header, `point-cash.service.ts` comments.

## 4. Frontend

- **`CountDrawerDialog`** (used by «Прийомка», «Каса за день», «Каса точки»): two money
  inputs, «Каса» and «Завдатки», both required, empty by default — prefilling the expected
  figure would defeat the count. `useOpenShiftMutation` / `useCloseShiftMutation` send
  `counted_deposits`.
- **`ShiftCountResult` / `CountResultView`**: two rows, Каса and Завдатки — counted,
  expected, discrepancy; a non-zero discrepancy is highlighted. The operator-note form is
  offered for each book with a discrepancy, berry first.
- **`CashCountHistory`**: a «Книга» column (Каса / Завдатки). ⚠ and «Пояснити» work for
  crates rows unchanged.
- **`CratesBookCard`**: headline `crate_cash` («в шухляді має бути»), or «ще не
  перераховували» when `null`; muted «завдатків за N ящиків — X»; discrepancy line when
  `crate_unexplained_difference` is non-zero.
- i18n keys in uk (and en where the project keeps them).

## 5. Testing

- **db-specs:** open writes two rows; first crates count anchors; closing expectation =
  opening + issuances − refunds; a voided issuance in an open shift is excluded; a shift
  opened with only a berry row closes and anchors crates; reopen demotes both and re-close
  writes both; explanation/operator note accepted on a crates row; `crate_cash` /
  `crate_unexplained_difference` in `GET /point-cash`.
- **unit/frontend:** DTO validation; dialog sends both figures and refuses an empty field;
  result shows both rows; history shows the book; card states.
- **Gate:** `npm run verify:full` (money code, real Postgres). Playwright screenshots of the
  dialog, the result and the history for the issue and the PR.

## 6. Out of scope

Notifications (D3), midday recount of deposits (D6), an «expected return» for voided crate
deposits (D4), reports/exports.

# Point cash breakdown from the server (#73)

**Date:** 2026-10-13 · **Issue:** #73 (closes #75, #176 with it; related #20)
**Branch:** `feat/73-point-cash-breakdown`

## Problem

«Каса точки» shows «Звідки взялося це число» — rows above the point's berry
cash. The total is the server's `cash`; the rows are a client reconstruction
(`pages/point-cash/lib/buildLedger.ts`) from `intakes`/`payouts`/`transfers`.

The server's formula is `cash = anchor.counted + (anchor.kind = 'opening' ?
movements(anchor shift) : 0)`. Once a shift is closed the anchor is the
**closing count**, and the movements no longer enter the figure. The rows stay
on screen and stop adding up: Шипинки 22.09 reads 21 820 − 13 000 + 0 + 35 000
= 43 820 above a total of 43 730. The 90 ₴ is the recorded discrepancy
(`counted − expected` on the closing count); the screen never says so.

The client also duplicates three SQL terms of `movementsSql` (its own date
bucketing of returns, #75/#176; a browser time zone; a 100-row page cap).

## Outcome

Whoever reads the block can add the rows and land on the number under them —
and when the number is a closing count, the screen shows what was expected,
what was counted, and the difference between them, by number.

## Decisions (grilled 2026-10-13)

1. **The breakdown comes from the server**, in the same SQL statement as
   `cash`. The client stops re-deriving any term that moves cash.
2. **Closed day: «expected» is the stored snapshot** (`cash_counts.expected_amount`
   of the closing count), so the difference equals the incident the owner sees
   and explains. If the shift's movements changed after close (owner `resolve`
   or `void` of a transfer, a `settle-return` dated that day — none needs an
   open shift), the change is a separate `late_change` line, so the rows still
   add up exactly. Shown only when non-zero.
3. **A date with no shift of its own** whose anchor is an earlier day's closing
   count shows one line, «Пораховано при закритті DD.MM», not that day's
   breakdown (the date arrows reach it). No anchor at all: «касу ще не рахували».
4. **API: `GET /point-cash/:pointId` always carries `breakdown`** — no flag;
   the screen's headline tiles stay on the list read. Both live under
   `queryKeys.pointCash`, so they invalidate together.
5. **Returns are one line** (`returned_on_void` + settled returns).
6. **No explanation text in the ledger.** The difference line carries a number,
   a tone and a pointer to the closing count; texts stay in the shift panel.

Out of scope: headline tiles, crates book, shift panel, count history, the
informational rows «Нараховано сьогодні» / «Видано за минулі дні» (unchanged,
still client-side from intakes/payouts), splitting returns.

## API

`GET /point-cash/:pointId?as_of=YYYY-MM-DD`:

```json
{
  "collection_point_id": "…",
  "cash": "43730.00",
  "crate_deposits": "…",
  "crate_deposit_units": 92,
  "breakdown": {
    "kind": "closed",
    "anchor_date": "2026-09-22",
    "opening": "21820.00",
    "transfers_in": "35000.00",
    "payouts": "13000.00",
    "returns": "0.00",
    "closing": {
      "counted": "43730.00",
      "expected": "43820.00",
      "difference": "-90.00",
      "late_change": "0.00"
    }
  }
}
```

`breakdown.kind` is a discriminant the UI switches on:

| kind | when | fields present (others `null`) | invariant |
|---|---|---|---|
| `open` | anchor is an opening count (shift open — possibly from an earlier day, #114) | `anchor_date`, `opening`, `transfers_in`, `payouts`, `returns` | `opening + transfers_in − payouts + returns = cash` |
| `closed` | anchor is a closing count dated `as_of` | all | `opening + transfers_in − payouts + returns − late_change = expected`; `expected + difference = counted = cash` |
| `carried` | anchor is a closing count dated before `as_of` | `anchor_date`, `closing.counted` | `closing.counted = cash` |
| `none` | no berry count at or before `as_of` | — | `cash = 0.00` |

Amounts are decimal strings; `payouts` is a non-negative magnitude (the UI
signs it, as today). `difference = counted − expected`; `late_change =
(opening + movements now) − expected`.

`open` with `anchor_date < as_of` is a shift left open since an earlier day:
the server's `cash` already is that shift's opening plus its movements, so the
full breakdown is shown with a note «зміна відкрита з DD.MM». A reopened shift
(closing count demoted to `midday`) is `open` again — correct, since the
anchor is its opening count again.

## Backend

- **`point-cash/point-cash.sql.ts`** (new) — `asOfSql`, `anchorSql` and the
  three terms of `movementsSql` as named builders: `transfersInSql`,
  `payoutsOutSql`, `returnsSql`. `movementsSql` becomes
  `(transfersIn − payoutsOut + returns)`, the same SQL, so `cashFor`,
  `expectedForOpening/Closing`, `movementsForShift`, the list and
  `PayoutWriter` behave exactly as before. Same pattern as
  `supplier-balance/supplier-debt.sql.ts`. Covered by the existing
  `src/point-cash/**` money lint glob.
- **`PointCashService.breakdownFor(pointId, asOf?)`** — one statement: anchor
  (now also selecting `business_date`), the anchor shift's opening berry count,
  the three terms, the closing count's `expected_amount`, and `cash` via the
  same `CASE` `cashFor` uses. All arithmetic in SQL.
- **`point-cash.mapper.ts`** — `toPointCashBreakdown(row, asOf)` applies the
  `kind` table above (null-out rules only, no arithmetic).
- **Controller `findOne`** calls `breakdownFor` instead of `cashFor`; `cash` in
  the response comes from that same row.

## Frontend

- **`entities/point-cash`** — `PointCashOne.breakdown: PointCashBreakdown`
  (mirrors the API). The page reads `usePointCashForPointQuery(pointId, date)`.
- **`CashLedger`** takes `breakdown` + `cash` instead of `transfers` /
  `openingCount`, and renders by `kind`:
  - `open`: «На початок дня», «Видано сьогодні», «Повернено в касу»,
    «Прийнято переказом» → total. Note when `anchor_date ≠ date`.
  - `closed`: the same four rows; «Змінилося після закриття ±X» if non-zero;
    «Мало бути» (expected); «Пораховано при закритті» (counted);
    «Розбіжність ±X» — shortage `bad`, surplus amber, hint «див. підрахунок при
    закритті»; total labelled «У касі за ягоду — пораховано при закритті».
  - `carried`: one line «Пораховано при закритті DD.MM» + «цього дня зміни не було».
  - `none`: total 0,00 + «касу ще не рахували».
  - The informational rows (`accruedToday`, `paidPast`) stay above the dashed
    divider in every kind, from intakes/payouts as today.
- **`buildLedger`** shrinks to the two informational rows; `cashIn`,
  `paidToday`, `returnedToday`, `opening` and `localDateOf` go.
- **`PointCashPage`** drops `ledgerTransfers` and `openingCashCounts` (their
  only consumer was the ledger). A failed detail read shows
  `common.somethingWentWrong` inside the ledger card only.
- **Locales** — new keys in `uk.json`/`en.json` for the lines above; keys of
  removed rows are deleted.

## Testing

- **`point-cash.db-spec.ts`** (real Postgres): `open` (Шипинки-like day, rows
  sum to cash); `closed` with −90 (expected 43 820, counted 43 730); `closed`
  with `late_change ≠ 0` (transfer voided after close); `carried`; `none`; an
  `open` shift from an earlier day. In every case `breakdownFor(...).cash ===
  cashFor(...)`.
- **Mapper unit spec** — the `kind` null-out rules.
- **Frontend** — `CashLedger.test.tsx` per `kind`, the 23.09 case
  (43 730 − 4 000 + 0 + 15 000 = 54 730), the `late_change` line; trimmed
  `buildLedger.test.ts`; updated `PointCashPage.test.tsx` mocks.
- **Gate** — `npm run verify:full` (money SQL is exercised only against a real
  Postgres — CLAUDE.md rule 1).

## Acceptance (from #73)

- Closed day: the total is labelled as the closing count; movement rows lead to
  «Мало бути», and the difference is a number.
- Open day: rows add up to the total exactly (Шипинки 23.09 → 54 730).
- Crates book, shift card, count history unchanged; point/date switching as before.

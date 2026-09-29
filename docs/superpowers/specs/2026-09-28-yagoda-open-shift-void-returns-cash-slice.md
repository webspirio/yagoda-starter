# Yagoda CRM — A Void in an Open Shift Returns the Cash

**Date:** 2026-09-28
**Source:** the team meeting's decision (reported 2026-09-28); the `/grilling` and
brainstorming sessions of 2026-09-28 that produced §3; `26-rules-by-example.md` §9.3, §9.4 and
the #125 edit; the slice-2 spec `2026-09-25-yagoda-intake-void-payout-decision-slice.md`.

**Builds on:** `refactor/allocations-cluster` (`f00745a`, draft PR #171). This branch,
`feat/open-shift-void-returns-cash`, forks from it — it edits the commands that refactor
introduced (`VoidIntakeCommand`, `VoidPayoutCommand`, `PayoutWriter`).

**Position in the schema:** twenty-three tables, unchanged in number. One new column,
`payouts.returned_on_void`, and one migration without a backfill.

---

## 1. Goal

A void in an open shift means «it all happened in front of the supplier»: they either handed
the money back or never had it in hand. So the cash is in the drawer the moment the void is
recorded, with no owner confirmation, and it is booked to **the shift the payout was paid
in**.

A closed shift keeps today's behaviour: voiding its payout leaves an expected return that
only the owner confirms (`settle-return`).

**Success criteria:**
- After a void of a payout whose shift is open, that shift's expected cash equals what it
  would have been had the payout never been written — also when the void happens after local
  midnight, and also in a shift the owner reopened.
- A void in a closed shift and every payout voided before this slice ships produce exactly
  the cash figures they produce today.
- Nobody can void from the UI without a reason and without ticking every consequence box.

## 2. Facts from the code this design rests on

- `assertCanVoid` (`auth/access/document-access.ts`) already implements «an operator only on
  a document they recorded, only while its shift is open; the owner always». Nothing about
  who may void changes.
- `UQ_shifts_open_per_point` is partial (`WHERE closed_at IS NULL`): a point has at most one
  open shift, so «the latest unclosed shift» is simply the open one. A reopened past shift is
  that one open shift.
- `VoidIntakeCommand` already calls `allocations.release(m, { intakeId })` in the void's
  transaction. Voiding a payout releases its own allocations inside `PayoutWriter.void`.
- A bound payout (`payouts.intake_id`) is written only at reception, by the same actor, in
  the same shift as its receipt (§3.5). So the receipt's shift state is the payout's.
- The cash formula (`point-cash.service.ts`, `movementsSql`) is the only place cash reads
  payouts. It subtracts every payout of the shift, voided or not, and adds back returns by the
  **calendar date** of `return_settled_at` matched to a shift's `business_date`.
- `POST /payouts/:id/settle-return` already refuses a payout with `return_settled_at` set
  (`RETURN_ALREADY_SETTLED`).
- `IntakeResponse` and `PayoutResponse` do not say whether the shift is closed. Both mappers
  receive the `Shift`. `IntakePayoutResponse` carries `id`, `code`, `amount`, `voided_at` only.

## 3. Decisions

1. **Who may void — unchanged.** The author, in the open shift (a reopened one included); the
   owner, anything. §9.4's «квитанція минулого дня → тільки керівник» is reworded to
   «квитанція закритої зміни → тільки керівник».
2. **The shift's state decides the cash, not the role.** Open → the void returns the cash at
   once, whoever records it. Closed → an expected return, confirmed by the owner.
3. **An open-shift return is booked to the payout's own shift**, not to the calendar date of
   the void. The date rule would book a void at 00:30 into a day the open shift is not, and the
   open shift's closing count would show a shortfall for money that is in the drawer.
4. **Representation: `payouts.returned_on_void boolean`**, not a `return_shift_id` (which would
   always equal `shift_id` for this case and drag `settle-return`'s date attribution into
   scope), and not an inferred `return_settled_at = voided_at` (meaning hidden in two equal
   timestamps is too fragile for money).
5. **Voiding a receipt in an open shift always voids its live bound payout.** No `keep` choice
   there: the premise is that the supplier is at the counter. The whole payout is voided —
   there is no partial void — so older receipts it also covered reopen.
6. **A closed shift keeps #125's three choices** (`keep` / `void` / `void_returned`), owner only.
7. **No retroactive change.** Payouts voided before this slice keep `returned_on_void = false`
   and their pending or date-attributed return.
8. **Consequence checkboxes are a UI gate only.** The server cannot know a human read a
   sentence; the mandatory reason and the audit entry already record who voided and why.

## 4. Backend

### 4.1 Migration `1788600000019-PayoutReturnedOnVoid`

```sql
ALTER TABLE "payouts" ADD COLUMN "returned_on_void" boolean NOT NULL DEFAULT false;
ALTER TABLE "payouts" ADD CONSTRAINT "CHK_payouts_returned_on_void"
  CHECK (NOT "returned_on_void" OR "return_settled_at" IS NOT NULL);
```

`down` drops both. No backfill (decision 7). The `Payout` entity gains the column and the
`@Check`; its header comment's «VOIDING A PAYOUT DOES NOT RETURN THE CASH» paragraph is
rewritten to say it holds for a closed shift only.

### 4.2 `PayoutWriter.void(m, actor, payout, reason, returnToDrawer: boolean)`

When `returnToDrawer`, the same `save` also sets `return_settled_at` (the same `Date` object
as `voided_at`), `return_settled_by_user_id = actor.sub` and `returned_on_void = true`. The
`payout.voided` audit entry gains `returned_on_void`. No separate `payout.return_settled`
entry: it is one act. `settleReturn` is unchanged.

### 4.3 `POST /payouts/:id/void`

`VoidPayoutCommand` passes `returnToDrawer = shift.closed_at === null`. Request and response
shapes unchanged apart from §4.5.

### 4.4 `POST /intakes/:id/void`

`assertPayoutDecision(shiftClosed, hasLivePayout, decision)` replaces the role-based version:

| Shift | `payout` in the body | Live bound payout |
|---|---|---|
| open | must be absent — any value → `400 PAYOUT_DECISION_NOT_APPLICABLE` | always voided with `returnToDrawer = true` |
| closed | required when a live bound payout exists, as today | per decision, as today |

The `OWNER_ONLY` branch for `void_returned` goes: a closed shift is owner-only already
(`assertCanVoid`). The `intake.voided` audit entry records `payout_decision:
'void_on_open_shift'` when an open-shift void took a payout with it, so the log shows it was
automatic, not chosen. Lock order (supplier → intake → payout) and `release` are unchanged.

### 4.5 Response additions (additive only)

- `shift_closed: boolean` on `IntakeResponse` and `PayoutResponse`.
- `created_at` on `IntakePayoutResponse` — the payout card shows when it was paid. Who paid is
  the receipt's `received_by_name` (same actor, §3.5).

### 4.6 Cash formula (`movementsSql`)

```sql
  - SUM(p.amount) WHERE p.shift_id = S                            -- unchanged
  + SUM(p.amount) WHERE p.shift_id = S AND p.returned_on_void      -- new: back into its own shift
  + SUM(p.amount) ... WHERE p.return_settled_at IS NOT NULL
                      AND NOT p.returned_on_void                   -- new filter
                      AND date(return_settled_at @ tz) = s.business_date
```

The block comment above it gains a paragraph on the new term and why it is shift-attributed
(midnight and reopened shifts, decision 3).

## 5. Frontend

- **`ReceiptDialog`:** the «Сторнувати» button is hidden for an operator when
  `intake.shift_closed`. It passes `shiftClosed` to `VoidDocumentDialog`.
- **Receipt void, open shift:** a small **payout card** — code, amount, time paid
  (`created_at`), who paid (`received_by_name`), and «також закривала: …» from the existing
  `otherCovered` settlement data — then mandatory checkboxes:
  - «Клієнт повернув або не отримав {amount} — гроші в касі»;
  - «Виплату {code} буде скасовано»;
  - «Квитанції {list} знову стануть відкритими» — only when the payout covered anything else.

  With no live bound payout: one checkbox, «Квитанцію буде скасовано, борг зменшиться на
  {amount}». The request carries no `payout` field.
- **Receipt void, closed shift:** today's `PayoutDecisionField`, three choices. Its
  `canConfirmReturn` prop becomes `shiftClosed`-driven.
- **Payout void (`SupplierCardPage`), open shift:** checkboxes «Клієнт повернув {amount} —
  гроші в касі» and, when it covered anything, «Квитанції {list} знову стануть відкритими».
  Closed shift: unchanged.
- **Every dialog:** «Сторнувати» stays disabled until the reason is filled and every checkbox
  shown is ticked.
- **`useVoidDocument`:** `payout.invalidates` gains `queryKeys.pointCash`; the comment about a
  voided payout staying subtracted is rewritten.
- **i18n:** new keys in `uk.json` and `en.json`.

## 6. Documents

Dated 2026-09-28, citing the team meeting:
- **§9.3** — «Сторно виплати НЕ повертає готівку в касу автоматично» gains an edit: in an open
  shift it does, booked to that shift; in a closed shift an expected return remains.
- **§9.4** — the reworded row (decision 1); the #125 edit gains: in an open shift a receipt's
  void always voids its payout.
- **`28-db-schema.dbml`** — the `returned_on_void` column and the `payouts` Note.
- **`backend/CLAUDE.md` / root `CLAUDE.md`** — wherever they state «a void does not return the
  cash», updated.

## 7. Testing

- **Jest (unit):** `assertPayoutDecision` table; `PayoutWriter.void` with and without
  `returnToDrawer`; both void commands pick `returnToDrawer` from the shift.
- **`db-spec` (real Postgres):**
  - an open-shift payout void → that shift's expected cash as if the payout never existed;
  - the same with the void recorded after local midnight of the shift's `business_date`;
  - a reopened shift;
  - an open-shift receipt void with a bound payout covering an older receipt → payout voided,
    cash back, older receipt reopened, allocation invariants hold;
  - `payout` in the body on an open shift → 400;
  - closed shift → the three choices behave exactly as today;
  - a pre-existing voided payout with a date-attributed return → unchanged figures;
  - `settle-return` on a `returned_on_void` payout → `RETURN_ALREADY_SETTLED`;
  - the CHECK rejects `returned_on_void` without `return_settled_at`.
- **Vitest:** the checkboxes gate the button; the payout card names the right payout; a closed
  shift shows three choices; the operator's button is hidden on a closed shift. Plus `tsc -b`.
- **Gate:** `npm run verify:full` — migration, money-module SQL and `test:db`.

## 8. Out of scope

- The owner's `settle-return` screen and a shift-close reminder (already in the follow-ups).
- Any change to who may void, to crates, transfers or top-ups.
- Moving `settle-return`'s calendar-date attribution to a shift.

# Yagoda CRM — Intake Void With a Payout Decision (slice 2, #125)

**Date:** 2026-09-25
**Source:** GitHub issue #125 (Анулювання квитанції та виплати), `26-rules-by-example.md`
§9.3 (Виправлення — новою подією) and §9.4 (Хто що сторнує), the `payouts` Note in
`28-db-schema.dbml`, the slice-1 spec `2026-09-25-yagoda-supplier-settlement-slice.md`
(§7 deferred this slice), and the `/grilling` + brainstorming session of 2026-09-25 that
produced the decisions in §3.

**Builds on:** slice 1 (`feat/supplier-settlement`). This branch —
`feat/intake-void-payout-decision` — forks from it, because the dialog reads `covers` from
`GET /suppliers/:id/settlement`.

**Position in the schema:** twenty-two tables, unchanged. **No table, no column, no
migration.** The slice changes one write contract (`POST /intakes/:id/void`) and one dialog.

---

## 1. Goal

A receipt cannot be voided while its payout is silently forgotten.

Today `POST /intakes/:id/void` and `POST /payouts/:id/void` are two independent actions. An
operator voids a receipt, forgets the payout that was issued with it, and the supplier's card
shows an advance nobody meant to give (#125). After this slice, voiding a receipt that has a
live bound payout requires an explicit decision about that payout, recorded in the audit
log, and a decision to void it is carried out in the same transaction.

**Success criterion:** for every voided receipt that had a live bound payout at the moment of
voiding, either the audit entry `intake.voided` records `payout_decision: 'keep'`, or the
payout was voided in the same transaction.

## 2. Facts from the code this design rests on

- `payouts.intake_id` is set only at reception (`IntakesService.create` →
  `PayoutsService.writePayout(m, …)`, same transaction, same `actor`). So a receipt has **at
  most one** bound payout, and it has the **same author and the same shift** as the receipt.
- `writePayout` caps the payout at the supplier's whole debt («Разом», §3.1), not at the
  receipt's amount. A bound payout may therefore also cover older receipts.
- Voiding a payout does not move cash (§9.3): the money left the drawer. Cash comes back only
  when the owner records `settle-return` (`POST /payouts/:id/settle-return`, owner-only —
  anti-theft: whoever voids must not also attest that the cash came back).
- A top-up on a voided receipt already counts for nothing (the parent's `voided_at` filter).
- The frontend has no `settle-return` UI today.

## 3. Decisions

### 3.1 The decision is enforced by the API, not only by the dialog

`POST /intakes/:id/void` gains `payout: 'keep' | 'void' | 'void_returned'`.

- Required when the receipt has a live bound payout. Missing → **400
  `PAYOUT_DECISION_REQUIRED`**.
- Forbidden when it does not. Present → **400 `PAYOUT_DECISION_NOT_APPLICABLE`**. A strict
  contract, so a stale client cannot believe it voided a payout that was not there.
- A dialog-only design was rejected: two requests are two transactions, and a failure between
  them reproduces #125 exactly.

### 3.2 Three choices, no default

| Value | Receipt | Payout | Cash |
|---|---|---|---|
| `keep` | voided | stays live; the projection re-routes it FIFO or leaves it unallocated | unchanged |
| `void` | voided | voided | still out of the drawer until the owner records the return |
| `void_returned` | voided | voided **and** `return_settled_*` set | back in the drawer |

`keep` is the common case: a correction is «сторно і нова правильна квитанція», and the
payout pays for the corrected receipt through FIFO.

### 3.3 `void_returned` is the owner's alone

A non-owner sending `void_returned` → **403 `OWNER_ONLY`**, same code and same reason as
`settle-return`. The operator never gets a «гроші вже в шухляді» option. Instead the `void`
option carries the warning «Каса буде меншою на {amount} ₴, доки керівник не підтвердить
повернення».

### 3.4 One transaction, one reason, one audit entry per document

The reason typed once is written to `intakes.void_reason` and `payouts.void_reason`, and for
`void_returned` also to `payouts.return_note`. Audit entries: `intake.voided` (always, with
`after.payout_decision` when a decision was made), `payout.voided` (for `void` and
`void_returned`), `payout.return-settled` (for `void_returned`). Any failure rolls all of
them back.

### 3.5 Rights are the receipt's rights

§9.4's intersection over both documents collapses to the receipt's check (point, author, open
shift) because of §2's same-author-same-shift fact. The payout's rights are not re-checked;
the helper states why in a comment. The only extra rule is §3.3.

### 3.6 Voiding a payout larger than its receipt is allowed and shown

When the bound payout P also covers other receipts, `void`/`void_returned` reopens them. That
is correct (the supplier is giving the whole payout back) and there is no partial void
(§9.3). The dialog states it: «З них {X} ₴ покривали інші квитанції — вони знову стануть
відкритими», where X comes from the slice-1 projection.

### 3.7 The standalone payout endpoints are unchanged

`POST /payouts/:id/void` and `POST /payouts/:id/settle-return` keep their contracts,
behaviour and tests. Voiding a bound payout on its own shows no warning about the receipt.

### 3.8 Backend shape: manager-aware helpers in `PayoutsService`

The bodies of `PayoutsService.void` and `settleReturn` move into
`voidWithin(m, actor, payout, reason)` and `settleReturnWithin(m, actor, payout, note)`, which
take an already-locked row and do the write + audit. The public methods keep their
transaction and `loadForWrite`, and delegate. `IntakesService.void` calls the helpers inside
its own transaction — the pattern `writePayout(m, …)` already uses at reception.

Rejected: a separate orchestrating service (an extra module over the same helpers), and a raw
`UPDATE payouts` in `IntakesService` (duplicates the void rules and their audit).

### 3.9 Frontend shape: extend `VoidDocumentDialog`

The choice is a section of the existing `features/void-document` dialog, not a new feature, so
both entry points (`widgets/receipt/ReceiptDialog`, `pages/supplier-card`) get it and the
reason field, error banner and submit are not duplicated.

## 4. Design

### 4.1 DTO

`backend/src/intakes/dto/void-intake.dto.ts`:

```ts
export const PAYOUT_DECISIONS = ['keep', 'void', 'void_returned'] as const;
export type PayoutDecision = (typeof PAYOUT_DECISIONS)[number];

export class VoidIntakeDto extends VoidDocumentDto {
  @IsOptional()
  @IsIn(PAYOUT_DECISIONS)
  payout?: PayoutDecision;
}
```

`VoidDocumentDto` is untouched (payouts, transfers, top-ups and crates still use it).
`IntakesController.void` takes `VoidIntakeDto`.

### 4.2 `IntakesService.void(actor, id, dto: VoidIntakeDto)`

Inside the existing transaction, in this order:

1. Lock the intake (`pessimistic_write`) and run today's checks unchanged: 404 → another
   point's 404 → `NOT_YOUR_DOCUMENT` → `SHIFT_CLOSED` → `ALREADY_VOIDED`.
2. Load the live bound payout under a row lock:
   `Payout WHERE intake_id = :id AND voided_at IS NULL`, `pessimistic_write`. Zero or one row.
3. Validate the decision — all before the first write:
   - payout found, `dto.payout` undefined → 400 `PAYOUT_DECISION_REQUIRED`;
   - no payout, `dto.payout` defined → 400 `PAYOUT_DECISION_NOT_APPLICABLE`;
   - `dto.payout === 'void_returned'`, actor not owner → 403 `OWNER_ONLY`.
4. Void the intake and record `intake.voided`, as today, plus `after.payout_decision` when a
   payout was found.
5. `void` or `void_returned` → `payouts.voidWithin(m, actor, payout, dto.reason)`.
6. `void_returned` → `payouts.settleReturnWithin(m, actor, payout, dto.reason)`.
7. Return `IntakeResponse`, unchanged. The client refetches payouts via invalidation.

**Lock order** is intake → payout. The standalone payout endpoints lock only the payout, so no
path takes the two locks in the opposite order.

`IntakesService` already depends on `PayoutsService` (for `writePayout`); no module change.

### 4.3 `PayoutsService`

```ts
/** Voids an already-locked payout inside the caller's transaction. */
voidWithin(m: EntityManager, actor: AuthenticatedUser, payout: Payout, reason: string): Promise<Payout>
/** Records the return of an already-locked, already-voided payout. */
settleReturnWithin(m: EntityManager, actor: AuthenticatedUser, payout: Payout, note: string | null): Promise<Payout>
```

They do the field writes, `m.save` and the audit entry — exactly what the public methods do
after their state checks today. The state checks (`ALREADY_VOIDED`, `PAYOUT_NOT_VOIDED`,
`RETURN_ALREADY_SETTLED`) stay in the public methods; the intake path cannot hit them (it
loaded a live payout under a lock, and voids it before settling). The rights checks are not
in the helpers.

### 4.4 Frontend

**`features/void-document`:**

- `VoidDocumentInput` gains `payout?: PayoutDecision`; the body is `{ reason, payout }` for
  `intake` when set, `{ reason }` otherwise.
- `intake` invalidation adds `queryKeys.pointCash` (a `void_returned` puts cash back).
  `supplierBalances` already covers the settlement key.
- `VoidDocumentDialog` gains optional props `linkedPayout?: { id: string; code: string;
  amount: string }` and `supplierId?: string`. When `kind === 'intake' && linkedPayout`, it
  renders the choice section between the description and the reason:
  - heading «Що з виплатою {code} ({amount} ₴)?»;
  - a radio group, none selected:
    - «Залишити виплату» → `keep`;
    - «Сторнувати й виплату — постачальник поверне гроші» → `void`; when selected, the
      warning «Каса буде меншою на {amount} ₴, доки керівник не підтвердить повернення»;
    - owner only (`useMeQuery().data?.role === 'network_owner'`): «Сторнувати й виплату —
      гроші вже повернуто в касу» → `void_returned`;
  - when the settlement is loaded and `otherCovered > 0`: «З них {X} ₴ покривали інші
    квитанції — вони знову стануть відкритими»;
  - submit disabled until a choice is made.
- `features/void-document/model/otherCovered.ts` — pure:
  `otherCovered(settlement, payoutId, intakeId): string`. Sums `settlement.payouts[payoutId].covers`
  over lines that are neither the intake itself nor a top-up whose `intake_id` is that
  intake (those die with it). Returns `'0.00'` when the payout is absent. Money arithmetic
  on strings via `sum` from `@/shared/lib/money`; no floats.
- The settlement comes from `useSupplierSettlementQuery(supplierId)` (`entities/supplier`).
  While loading or on error the line is simply absent; the choice still works.

**Call sites:**

- `widgets/receipt/ReceiptDialog`: `linkedPayout` = the entry of `intake.payouts` with
  `voided_at === null`; `supplierId` = the intake's supplier.
- `pages/supplier-card/SupplierCardPage`: `linkedPayout` = the `payoutRows` entry with
  `intake_id === target.id && voided_at === null`; `supplierId` = the page's id.

**Errors:** `apiErrorToBanner` maps `PAYOUT_DECISION_REQUIRED` («Виплату до цієї квитанції
щойно змінено — закрийте й відкрийте діалог знову»), `PAYOUT_DECISION_NOT_APPLICABLE` (same
text), and `OWNER_ONLY`. i18n keys in `uk` and `en`.

## 5. Tests and verification

**Backend unit (`intakes.service.spec.ts`, `payouts.service.spec.ts`):**
- each branch of §4.2 step 3, and that none of them writes;
- `keep` / `void` / `void_returned` write the right rows and audit entries;
- `after.payout_decision` present exactly when a payout was found;
- the public payout `void` / `settleReturn` behave as before (existing tests stay green,
  unchanged).

**Backend db-spec (`intake-void-payout-decision.db-spec.ts`, real Postgres):**
- atomicity: a failure inside `voidWithin` leaves the intake live;
- the #125 fixture — old debt 1000, R 500, P 1500 bound to R:
  - `keep` → debt −500.00, P unallocated 500.00 after covering the old receipt;
  - `void` → debt 1000.00, the old receipt open again, point cash unchanged;
  - `void_returned` → debt 1000.00, point cash +1500.00;
- two concurrent voids of the same receipt: one succeeds, the other gets `ALREADY_VOIDED`;
  exactly one `payout.voided` entry.

**Frontend (Vitest):** operator sees 2 options, owner 3; submit disabled without a choice;
the body carries `payout`; the cash warning only for `void`; the «інші квитанції» line only
when `otherCovered > 0`; without `linkedPayout` the dialog is as today; `otherCovered` unit
tests including a top-up of the voided receipt.

**Verification:** money modules and SQL behaviour change, so `npm run verify:full`, verdict
line quoted, skips named. No baseline, ignore or floor changes.

## 6. Rule and schema edits (dated 2026-09-25)

- `26-rules-by-example.md` §9.3/§9.4: a dated entry — voiding a receipt with a live bound
  payout requires one of three choices, no default; one transaction, one reason;
  `void_returned` is owner-only; worked example R 500 / P 1500 / old debt 1000.
- `28-db-schema.dbml`, `payouts` Note: a dated cross-reference — a bound payout can be voided
  as part of its receipt's void. No schema change.
- `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md`: mark the slice-1 «Slice 2»
  entry done (pointing here), and add «Deferred from slice 2 (#125)» (§7).

## 7. Out of scope → follow-ups

- **The owner's `settle-return` UI.** The API exists; no screen calls it. Until it does, a
  `void`-voided payout's return is recorded through the API.
- **A shift-close reminder** listing payouts voided with no recorded return.
- Voiding a payout on its own: unchanged, no warning about its live receipt.
- Partial payout voids: §9.3 has none.
- Any change to the settlement projection.

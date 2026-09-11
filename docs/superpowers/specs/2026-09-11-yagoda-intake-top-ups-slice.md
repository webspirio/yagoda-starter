# Yagoda CRM — Intake Top-Ups Slice Spec

**Date:** 2026-09-11
**Ticket:** #61 «Фантомний залишок» (milestone «Каса точки і зміна»).
**Source:** the owner's request in #61 (quoted in §2), `26-rules-by-example.md` §§2.7, 3.1–3.9,
9.3, 9.4, `28-db-schema.dbml` (the `suppliers` Note above all), and the `/grilling` session of
2026-09-11 that settled the eleven decisions recorded here.

**Position in the schema:** the schema of record defines 17 tables and 14 are built. This slice
adds **the 18th** — `intake_top_ups` — which is **not in `28-db-schema.dbml` at all**. The three
crate tables remain unbuilt and unchanged.

**THIS SLICE EDITS THE SCHEMA OF RECORD, IT DOES NOT ONLY APPEND TO IT.** The `suppliers` Note
carries the canonical debt SQL and the sentence «Картка показує ДВА ОКРЕМІ СПИСКИ — квитанції й
виплати», and merging this slice makes **both** false. §12 lists every amendment. A reader who
treats this as purely additive will leave the schema of record describing a formula the backend
no longer runs.

---

## 1. Goal

Let the owner owe a supplier money for berries already received, at a price decided after the
receipt was printed — without touching the receipt.

Today the only way to raise a supplier's debt is an `intakes` row, and §2.7 freezes
`intakes.amount` forever («після проведення не міняється НІКОЛИ»). So an owner who renegotiates
a price after the fact has exactly two options in the current system: void a correct receipt and
retype it (destroying the correspondence with the paper in the supplier's hand), or pay outside
the system and let the balance lie. This slice adds a third source of debt so neither is
necessary.

## 2. The owner's request, verbatim in substance

> Як керівник я хочу додати конкретному постачальнику фіксовану суму боргу, до прикладу, 2000,
> які ми маємо видати цьому постачальнику пізніше.
>
> Як керівник, я хочу вказувати причину створення цього фантомного залишку, щоб при перегляді
> історії було ясно зрозуміло, чому ми маємо викладати дві тисячі цьому постачальнику.
>
> Таке стається, коли ми перераховуємо постачальнику ціну ягід за якоюсь спеціально ціною після
> того, як він уже здав, і ми зафіксували факт здачі, але ми хочемо йому доплатити за ці ягоди.
> І ми йому додаємо просто, тисячу або дві тисячі в борг, який він може потім від нас отримати.

Two requirements, and the second is not decoration: an amount with no stated reason is the thing
the owner explicitly says must not exist.

## 3. The model

Debt is still «різниця двох історій». It becomes a difference of **three**:

```
борг = Σ intakes(не сторновані)
     + Σ intake_top_ups(не сторновані, на не сторнованій квитанції)
     − Σ payouts(не сторновані)
```

Nothing else about debt changes. There is still no allocation, no FIFO, no per-receipt remainder,
no stored balance and no `paid` column. A top-up is, in the words of the request that framed this
design, **another source contributing to the outstanding balance** — not a modification of any
existing document.

### 3.1 The link is to an intake, and it is `NOT NULL`

`intake_top_ups` carries `intake_id NOT NULL` and **no** `supplier_id`, **no** `shift_id` and
**no** date column. The supplier arrives through the intake; the point arrives through the
supplier (§3.9 — «supplier_id уже означає точку»).

This is the same refusal to duplicate a fact that `intakes` and `payouts` already make: neither
stores `collection_point_id` or `business_date` because both come from the shift, and the DBML
header forbids «два примірники одного факту». The practical consequence is the same one the
`Intake` entity warns about — **scoping to a point is a JOIN**, here a two-hop one through
`intakes` to `suppliers`.

### 3.2 This is not the opening-balance mechanism, and the `NOT NULL` is why

The DBML is explicit that debt acquired before launch is out of scope by decision, not by
oversight:

> Механізму «вступний залишок» у схемі НЕМАЄ навмисно (рішення власника 04.09.2026): борг,
> набутий до запуску, у систему не заводиться взагалі й закривається по паперу поза нею.

A table that let an owner write `(supplier, 2000, reason)` **would be** that mechanism under a
different name. The mandatory intake link is what keeps the 04.09.2026 decision true by
construction: debt can only be topped up where berries were actually received and recorded. Debt
cannot be invented from nothing, because there is nothing to hang it on.

The cost is named and accepted: **a supplier with no intakes cannot be topped up.** That matches
the request — the scenario begins «після того, як він уже здав».

### 3.3 Positive only

`CHECK (amount > 0)`. A negative row is not offered, and the omission is a decision:

- It would be a way to reduce a debt **without money leaving the drawer**. §3.2 refuses a
  «Залишок» input field «для ЖОДНОЇ ролі», and the DBML's evidence for why is the client's own
  workbook, where the hand-copied balance chain breaks in «124 переходах із 1 473». A negative
  adjustment is that field wearing a reason text.
- It would add a second path to a negative balance, where the DBML names exactly one — «сторно
  КВИТАНЦІЇ ЄДИНИЙ шлях у мінус» — and leans on that uniqueness when it explains how a minus can
  arise and why it heals itself.

**The downward path already exists: §9.3's void-and-reissue.** Void the receipt, write a new one
at the right price. It costs re-entering the lines and it keeps kg, price and paper in agreement,
which a bare `−2000` does not.

### 3.4 No ceiling

Beyond `> 0` and the `numeric(12,2)` width, nothing bounds the amount. The tempting constraint is
`amount <= intakes.amount` — "you are topping up *these* berries" — and it is wrong here, because
the parent is chosen by **recency**, not by which berries the money is for. The owner's normal
motion is to attach the top-up to the latest intake; a 2 000 ₴ top-up covering a week of
deliveries would then be refused because yesterday's receipt happened to be 1 500 ₴. A constraint
that fires on correct data is worse than no constraint.

The precedent agrees: §2.9's ±30 ₴/kg network ceiling on `bonus` is documented as deliberately
unenforced — «самої межі в цій схемі поки НЕМАЄ де зберігати».

What guards a fat-fingered `20000` instead: owner-only write, an audit row, and §9.3's
void-and-rewrite. A «ви додаєте 20 000 ₴ — підтвердіть» confirmation is real and belongs to the
card follow-up (§11), not to the API.

### 3.5 The name

`intake_top_ups`, because the two obvious nouns are already spent:

- **«Залишок» / balance** — the owner's own word for the feature, and the one word the schema
  forbids as a stored thing (§3.2). A table called `phantom_balances` names the banned concept
  and invites the next reader to maintain it as a running total.
- **«Надбавка» / bonus** — already `intake_items.bonus`, the per-line price premium §2.9 caps.
  Reusing it would give one document two different things under one word.

`intake_adjustments` was the conventional alternative and was rejected for encoding both
misreadings we most need to prevent: "adjustment" implies **signed** (§3.3 forbids it) and implies
it **adjusts the intake** (§2.7 forbids it). The chosen name makes a future negative row require a
rename — exactly as much friction as that decision deserves.

## 4. Table

```
id                  uuid  pk
intake_id           uuid  not null  → intakes.id   RESTRICT
amount              numeric(12,2) not null
reason              text  not null
created_by_user_id  uuid  not null  → users.id     RESTRICT
voided_at           timestamptz
voided_by_user_id   uuid            → users.id     RESTRICT
void_reason         text
created_at          timestamptz not null
updated_at          timestamptz not null
```

- `CHK_intake_top_ups_amount` — `"amount" > 0`. Strictly greater, unlike `CHK_intakes_amount`'s
  `>= 0`: a zero top-up is a debt entry that changes no debt.
- `CHK_intake_top_ups_void_trio` — `num_nulls("voided_at", "voided_by_user_id", "void_reason") IN
  (0, 3)`, the third copy of the convention `intakes`, `payouts` and `transfers` share.
- `IDX_intake_top_ups_intake` on `(intake_id)` — every read of this table arrives through its
  parent, including the balance subquery correlated over a page of suppliers.
- `amount` is a **string** end to end (foundation §5.1), never a JS number.

**No `code` column.** `composeDocumentCode` exists because the operator types the number printed
in the paper receipt book (§6.2); a top-up has no paper twin — the owner creates it at a desk —
and a synthetic code would be a forged receipt number. `transfers` made the identical call for the
identical reason: «паперового двійника немає — перевізник підписує в зошиті», so a trip is
identified by date and carrier rather than a number. A top-up is identified by its id and its
reason.

**`reason` is `NOT NULL` free text**, not an enumerated category. Every explanation field in this
schema is free text and none is enumerated — `void_reason`, `dispute_note`, `shifts.explanation`,
`payouts.return_note`, `suppliers.note`. The one case we have («перерахували ціну після здачі») is
a sentence, not a category, and a tidy-but-wrong dropdown is how «інше: ______» gets invented in
month two.

**Multiple top-ups on one intake are allowed** — there is no unique index on `intake_id`. §9.3
makes a correction a void plus a new row, so uniqueness would make a top-up the only
uncorrectable record in the system.

## 5. Routes

| Method | Path | Role | Body / query |
|---|---|---|---|
| `POST` | `/intake-top-ups` | **owner** | `{ intake_id, amount, reason }` |
| `GET` | `/intake-top-ups` | any | `collection_point_id?`, `supplier_id?`, `intake_id?`, `include_voided?`, `page?`, `limit?` |
| `GET` | `/intake-top-ups/:id` | any | — |
| `POST` | `/intake-top-ups/:id/void` | **owner** | `{ reason }` — the shared `VoidDocumentDto` |

The shape is `transfers`' exactly: owner-only create, both roles read, owner-only void.

**Create takes no `collection_point_id` and calls no `resolveWritePoint`.** The point is implied
twice over — by the intake, and by the fact that only an owner can write, and an owner owns every
point. `@Auth(UserRole.NetworkOwner)` is the whole authorisation. The list route does use
`resolvePointFilter`, applied through the two-hop JOIN (`intake_top_ups → intakes → suppliers`),
so an operator's `collection_point_id` is ignored and replaced with their own exactly as in
`ListIntakesQueryDto`.

A flat resource rather than `POST /intakes/:id/top-ups` or `GET /suppliers/:id/top-ups`. Hanging
reads off `/suppliers/:id` would put a second module's route at the same depth as
`GET /suppliers/:id/balance`, and `supplier-balance.controller.ts` carries a standing warning
about exactly that: cross-module registration order is not ours to control and a collision there
produces no startup error. `/intake-top-ups` shares a prefix with nothing.

### 5.1 The operator reads them

Creation and voiding are the owner's — the top-up is a pricing decision and #61 says «Як
керівник». Reading is **both roles**, scoped through the supplier the way every other read already
is (`SuppliersService.findOne` 404s another point's supplier, so an operator sees only their own
point).

This is not a convenience. The operator is the one who hands over the cash, and after a top-up the
supplier's «Разом» — the single number §3.1 insists the operator sees, «приймальник не бачить
двох сум і не складає їх у голові» — is 2 000 ₴ higher than anything on the operator's screen can
explain. Hiding the row hides the **amount**, and the person at the window is the one being asked
«за що».

The trade-off is accepted with open eyes: a reason text like «домовились про 45 ₴/кг для нього»
reveals to an operator that this supplier is on better terms than others at the same point. If
that becomes a problem the answer is a second, owner-only note field — never hiding the row.

### 5.2 No shift is involved, and none is required

A top-up has no `shift_id`, so no shift rule reaches it: the owner can create one against an
intake whose shift is **closed**, with no shift open anywhere in the network. That is the primary
scenario in #61, and it is why the link is to an intake rather than to a shift of its own — a
`shift_id` would have forced an open shift onto an owner who is not at the point.

### 5.3 The read model states whether it counts

Each row carries, computed in the mapper:

```
{ id, amount, reason, counts_toward_balance,
  intake: { id, code, voided_at },
  created_by_user_id, created_at,
  voided_at, voided_by_user_id, void_reason }
```

`counts_toward_balance` is `false` when the row is voided **or its parent intake is voided** (§6).
The flag says *what*, the embedded parent says *why*.

The server computes it rather than shipping the parent's state and letting each client work it
out. The rule "a top-up on a voided receipt does not count" lives in the SQL; re-deriving it in
every client is how it drifts, and this system already centralised `voided_at IS NULL` in
`debtSql` for precisely that reason. This is not the forbidden second copy of a fact — the DBML
bans **stored** duplicates, and this is computed per response from the same join the balance runs.

### 5.4 `include_voided` defaults to `true`

Matching `ListIntakesQueryDto`. §9.3 keeps a voided document in the journal «НАЗАВЖДИ з печаткою
"СТОРНОВАНО"», and that applies to a voided top-up as much as to a voided receipt.

## 6. A voided parent neutralises its top-ups; it does not cascade

When an intake is voided, its top-ups stop counting — **through the join, with no write.**

```sql
+ COALESCE((SELECT SUM(t.amount)
              FROM intake_top_ups t
              JOIN intakes ti ON ti.id = t.intake_id
             WHERE ti.supplier_id = <supplier>
               AND ti.voided_at IS NULL
               AND t.voided_at  IS NULL), 0.00)
```

Semantically this is the rule the `suppliers` Note already states for intakes — «борг за ягоду,
якої не брали» — applied one level down: if the berries never happened, the extra money for those
berries never happened either.

The two alternatives were both rejected on role grounds:

- **Cascade write** (stamp the void trio on the children) breaks role containment.
  `IntakesService.void` lets an **operator** void their own receipt in their own open shift
  (§9.4); under a cascade that operator's click would write `voided_by_user_id` onto a row the
  **owner** created. An operator cannot void an owner's document anywhere else in this system and
  must not acquire the power by side effect.
- **Blocking the void** while live top-ups exist turns the operator's §9.4 right into a two-role
  dance: they could not correct their own receipt until the owner detached the money. Since a
  correction *is* a void plus a new document, this would make the owner a participant in every
  correction of a topped-up receipt.

Two consequences, both accepted explicitly:

1. **The row survives, excluded.** After the parent is voided, `intake_top_ups` still holds a
   live-looking 2 000 ₴ row that appears in no balance. §5.3's `counts_toward_balance` is what
   keeps that from being a silent contradiction — without it, the next person to query this table
   alone finds money the balance screen denies.
2. **A correction orphans the top-up.** §9.3 makes a correction a void plus a *new* intake; the
   top-up stays attached to the dead one and the owner must re-create it on the replacement.
   Arguably correct — the reason text referred to specific berries — but it is manual and nothing
   reminds them.

## 7. The formula, and what inherits it

### 7.1 One place changes

`debtSql` in `supplier-balance.service.ts` gains the third `COALESCE` term from §6. It is written
as a function of a supplier *expression*, so both call sites inherit it unchanged: the `$1` bind
in `debtFor`, and the correlated `s.id` in `list`. `ORDER BY b.debt DESC` keeps working, as does
`include_zero`'s `b.debt <> 0`.

That module's header comment — «THE ONLY `SUM` OVER EITHER DOCUMENT TABLE IN THE BACKEND» — is
reworded, not relocated. It stays the only place any of the three sums is written.

### 7.2 The payout ceiling inherits it for free

`PayoutsService.create` reads the ceiling through `this.balance.debtFor(dto.supplier_id, m)`
(`payouts.service.ts:123`). Because the term lands inside `debtSql`, the topped-up money becomes
payable through the ordinary payout flow with **no change in `payouts`**. There is no separate
settlement verb and no new concept: the supplier's «Разом» is 2 000 ₴ higher and a normal payout
hands it over.

`min(Разом, каса за ягоду)`'s cash half is still the unimplemented half, unchanged by this slice.

### 7.3 Cash is untouched

`point-cash.service.ts`'s `movementsSql` has exactly three terms — transfers in, payouts out,
settled returns back in. A top-up is none of them. **This is the only debt-bearing table in the
system that moves no cash**, and the cash slice needs no edit at all.

The physical consequence is ordinary: when the top-up is eventually paid out, the payout reduces
the point's cash like any other, the point runs short against `collection_points.target_cash`, and
the network replenishes it by transfer (§7.10). Nothing new.

### 7.4 No new locking — and that depends on §3.3

`PayoutsService.create` reads `debtFor` inside a transaction holding the **supplier row** lock. A
top-up insert never touches that row, so the two do not serialise, and the top-up needs no lock of
its own.

That is safe **only because top-ups are strictly positive.** A payout racing a top-up can compute
a ceiling that is stale-*low*, refusing money that is now owed — annoying, retryable, never an
overpayment. Had §3.3 gone the signed way, the same race would let a payout exceed a debt that had
just shrunk, and this table would have needed the supplier lock. Whoever revisits §3.3 must
revisit this paragraph in the same change.

## 8. Which day a top-up falls on

**The day it was created**, in `APP_TIMEZONE` — not the parent intake's business date.

Nothing reads this today: the day screen's «приріст боргу за точку» (`Σ intakes дня − Σ payouts
дня`) is promised in the `suppliers` Note but **does not exist in the backend**. So this slice
ships no code for it. The decision is recorded here and in the table Note so the person who builds
that screen inherits it instead of guessing, because no test will catch them guessing wrong.

The precedent decides it. `transfers` dates money by `accepted_date` rather than by when it was
sent, because «гроші не мають лежати в касі за день, коли їх фізично не було». The mirror
statement holds here: the debt did not exist on the intake's day — it came into being the day the
owner decided to pay more. Dating it backwards would make a reviewed, closed day silently grow by
2 000 ₴ days later.

## 9. Audit

Two new members of `AUDIT_ACTIONS`: `intake-top-up.created` and `intake-top-up.voided`, written
inside the same transaction as the row, as every other document does. `target_type` is
`'intake-top-up'`; `after` carries `amount` and the parent `intake_id` so the entry stays readable
if the target is later unreachable, and `note` carries the reason.

The union is a TS string union stored as `varchar`, so this needs no migration.

## 10. Data conventions this slice inherits without restating

Foundation §5.1 binds in full: `numeric` is a string end to end, `amount` is validated with
`@Matches(/^\d{1,10}(\.\d{1,2})?$/)` plus `@CanonicalDecimal()` as in `CreatePayoutDto`, and the
`> 0` refusal comes from the CHECK with a service pre-check translating it into a 400 carrying
`code: 'TOP_UP_AMOUNT_NOT_POSITIVE'` — the pattern `PAYOUT_AMOUNT_ZERO` set. The pre-check is not
redundant with the CHECK: there is no `QueryFailedError` mapping anywhere in this backend, so a
constraint violation no service catches reaches the client as an opaque 500.

`reason` is validated exactly as `VoidDocumentDto` validates its own: `@IsString()`,
`@Length(1, 500)`, `@Matches(/\S/)`. The `\S` matcher is load-bearing rather than defensive —
`@Length(1, …)` accepts `"   "`, and a blank reason on a 2 000 ₴ top-up defeats the second half of
#61 outright.

**This service stores `dto.reason.trim()`.** The three existing services disagree about trimming
(`TransfersService` trims; `IntakesService` and `PayoutsService` do not), and that disagreement is
already logged as a follow-up. This slice does not touch those three — it only declines to inherit
the ambiguity into a new table.

## 11. What this slice deliberately does not do

- **No supplier card.** The third list is a follow-up issue (§14). The backend ships first, per
  the project's order.
- **No negative top-up** (§3.3) — void-and-reissue is the downward path.
- **No amount ceiling and no confirmation dialog** (§3.4) — the dialog belongs to the card.
- **No `code` and no printed form** (§4). A top-up is not a receipt and produces no paper.
- **No day-screen term** (§8) — the screen does not exist; the decision is recorded, not
  implemented.
- **No change to `GET /suppliers/:id/balance`'s response.** It still returns one number. §3.1 —
  «приймальник не бачить двох сум і не складає їх у голові». The breakdown is the third list's
  job.
- **No re-attachment helper.** §6's consequence 2 (a correction orphans the top-up) stays manual.

## 12. Divergences and amendments

Four amendments, each written into the source document as a dated addition leaving superseded text
visible — the convention every previous slice used.

### 12.1 `28-db-schema.dbml` gains a table that was never in it

A new `Table intake_top_ups` block with a Note carrying: the owner's own word for it («фантомний
залишок», so #61 stays findable from the code), positive-only with void-and-reissue as the
downward path, the creation-day rule from §8, why there is no `code`, why a voided parent
neutralises without cascading, and — the paragraph that matters most to the next reader — **that
this is not the opening-balance mechanism the DBML removed on 04.09.2026**, and that the `NOT
NULL` intake link is what keeps that true.

### 12.2 The `suppliers` Note's canonical SQL is now wrong

The Note's debt query is two terms. It becomes three (§6). This is the single most-cited block in
the schema of record and code already copies it verbatim; leaving it stale would mean the DBML
documents a formula the backend does not run.

### 12.3 The `suppliers` Note's «ДВА ОКРЕМІ СПИСКИ» is now wrong

«Картка показує ДВА ОКРЕМІ СПИСКИ — квитанції й виплати — і одне число під ними» becomes three
lists and one number. The sentence described the two sources that existed when it was written; the
invariant underneath it is "the card shows the sources and one number under them", and with three
sources the honest card shows three.

The alternative — rendering the top-up nested inside its parent receipt as `5 000 (+2 000)` —
was rejected for keeping the sentence literally true at the cost of implying the frozen number
moved (§2.7), and for putting a figure on screen that contradicts the paper in the supplier's
hand at the exact moment the operator is justifying cash.

### 12.4 `CLAUDE.md`'s table inventory

«Three tables remain, all of them crates» stays true of the DBML's own 17, but the implemented list
gains `intake_top_ups` and the count of built tables goes from 14 to 15 of 18.

### 12.5 The money eslint guard covers eight modules, not seven

`src/intake-top-ups/**/*.ts` joins the `files` list in `eslint.config.mjs`, and the comment's
«seven modules» becomes eight. Prospective, like `transfers` and `point-cash` were: nothing in this
module does JavaScript arithmetic today, and the guard is what keeps a later `debt + top_up` from
being written in TypeScript where it would look perfectly reasonable in review.

## 13. Tests

**Unit (`intake-top-ups.service.spec.ts`)** — mocked repositories:

- Create is owner-only; an operator is refused.
- Create against a nonexistent intake is a 404.
- Create writes `reason.trim()`, and a whitespace-only reason is refused by the DTO.
- Zero and negative amounts are refused with a message, not a 500.
- Create against an intake in a **closed** shift succeeds (§5.2 — the primary scenario, and the
  regression test for anyone who later "adds the missing shift check").
- Void is owner-only, requires a reason, and refuses an already-voided row with `ALREADY_VOIDED`.
- Voiding takes a row lock and re-reads state inside the transaction, as `IntakesService.void`
  does.
- Audit entries are recorded with the manager, inside the transaction.

**Database (`*.db-spec.ts`)** — the formula and the constraints, against real Postgres, following
`supplier-balance-list.db-spec.ts`'s per-run-uuid fixture convention:

- `intake-top-ups-schema.db-spec.ts` — `CHK_intake_top_ups_amount` refuses `0.00` and negatives;
  the void trio CHECK refuses a partial trio; two top-ups on one intake are accepted.
- **The balance gains the third term**: a supplier with `100` intake + `30` payout + `20` top-up
  reads `90.00`.
- **A voided top-up does not count** — the `t.voided_at IS NULL` filter.
- **A top-up on a voided intake does not count** — the `ti.voided_at IS NULL` filter. These two
  are separate tests on purpose: they are separate filters, and dropping either one is invisible
  to a fixture that only exercises the other.
- **`GET /supplier-balances` agrees with `GET /suppliers/:id/balance`** for a topped-up supplier,
  and the list's `ORDER BY debt DESC` places them by the three-term total.
- **The payout ceiling rises with the top-up**: a supplier with a fully-paid receipt plus a
  `2000` top-up can be paid `2000` and not `2000.01` — the end-to-end proof that §7.2's "for
  free" is actually free.
- `include_zero=false` still hides a supplier whose intake, payout and top-up net to `0.00`.
- `counts_toward_balance` is `false` for a row whose parent is voided and `true` for the same row
  before the parent was voided.

**Pipeline (`src/testing/`)** — extend the documents pipeline: owner creates an intake, tops it
up, an operator reads the top-up at their own point and cannot read another point's, the operator
pays out the raised «Разом», the owner voids the top-up.

## 14. Follow-ups this slice creates

- **The supplier card's third list** (§11) — the only part of #61 the owner can see; this slice is
  not done in the owner's eyes until it ships.
- **A confirmation on large amounts** (§3.4) — belongs with the card.
- **Re-attaching a top-up after its parent is corrected** (§6, consequence 2) — manual today,
  nothing reminds anyone.
- **The day screen's third term** (§8) — the decision is recorded; the screen does not exist.
- **An owner-only note field** if the reason text turns out to be too revealing for operators
  (§5.1). The row stays visible either way.

# Yagoda CRM — Crates Slice Spec

**Date:** 2026-09-15
**Tickets:** #58 «Розписка за ящики», #60 «Видача ящиків за заставу», #57 «Ящики з ягодою
вираховуються з орендованих ящиків» (the ledger half only — see §9).
**Source:** the client's instructions of 2026-09-15 (quoted in §2), `26-rules-by-example.md` §6,
`28-db-schema.dbml`, and the `/grilling` session of 2026-09-15 that produced the twelve
decisions in §3. The foundation spec's §5 data conventions bind this slice in full.

**Position in the schema:** 14 of 17 tables are built. This slice implements the remaining
**three** — `crate_issuances`, `crate_returns`, `crate_return_allocations`. After it the schema
of record is complete.

**THIS SLICE OVERRULES TWO WRITTEN RULES AND CLOSES ONE OPEN QUESTION.** §6.6's «розписка й
завдаток не змішуються навіть у поверненні» and §9.4's «ящиковий документ → тільки керівник» are
both replaced by client decisions recorded here. ЗАПИТАННЯ 2 (generate or type the receipt
number) is answered: generate. A reader who works from the rules file alone will build the
wrong thing; §10 lists every document that moves.

---

## 1. Goal

Make a rented crate a thing the system can account for.

A supplier takes crates home and brings them back, sometimes days apart, sometimes at prices
that changed in between. Today none of that is recorded anywhere: the balance lives in the
operator's notebook and the deposit lives in a drawer nobody can reconcile. This slice records
the two documents that move crates — the issuance and the return — and the FIFO allocation that
connects them, so that «скільки ящиків у цієї людини» and «скільки їй повернути» are answers the
system gives rather than answers a person remembers.

## 2. The client's instructions, verbatim in substance

Recorded first because three of this slice's decisions come from them rather than from the
rules:

> Crates can be issued either against a receipt. In this case, we generate a unique receipt
> code, which is recorded in a separate log. This code is the link between the log and the
> corresponding record in the system. Alternatively, crates can be issued against a deposit. We
> still generate the code, but it will not be entered into the log.
>
> The allocation and its rules have not changed. If we have received crates multiple times, we
> need to manage them using FIFO, regardless of whether they were issued against a deposit or a
> receipt. **All crates circulate according to FIFO.**
>
> There are no hard restrictions on whether crates must be issued against a deposit or a
> receipt. The receiver decides this individually in each case.

And, on the type of crate:

> At this time, categorization by type is not necessary. We have some variability in receiving
> berries because people may bring them in different containers, but the facility itself uses a
> single standard type of crate for both distribution and returns.

And, on who may correct a mistake:

> Let's not restrict these actions through the admin panel for now… for the time being, we'll
> allow users to manage their inboxes at the point of access without strict restrictions.

The first quote overrules §6.6. The third overrules §9.4's crate line.

## 3. The twelve decisions

The design tree, resolved. Everything below this section is mechanics.

| # | Decision |
|---|---|
| 1 | **One FIFO queue per supplier**, deposit and receipt tranches interleaved by date. §6.6 is rewritten: *money* does not mix, the queue does. A receipt-mode allocation carries `per_unit = 0`, `amount = 0`. |
| 2 | A supplier row is already point-scoped (§3.9), so a balance is per (person, point). Crates taken at Шипинки cannot be returned at Гайове. |
| 3 | **Two per-(point, day) counters**, carried in the document code's kind slot: `CR` розписка, `CD` завдаток. Receipt numbers stay contiguous in the paper log; the deposit code is an internal identifier. |
| 4 | **The backend ships primitives.** Pairing a return with an intake is client composition — no `intake_id`, no combined endpoint, no shared transaction. The server owns FIFO, so it owes a **preview read**. |
| 5 | **The crates cash book is derived only**: `Σ deposit_taken − Σ deposit_refund`, point-lifetime, no date floor (§7.5). No `cash_counts` row with `book = 'crates'`. §6.7's block ships as an assertion. |
| 6 | **No tare type on the crate tables.** One standard crate, network-wide. `is_crate` is exclusive: setting it demotes every other row in the same transaction. `deposit_per_unit` snapshots that row's price. |
| 7 | **A void drops the deposit from the book immediately** — no settlement trio, unlike `payouts`. Mitigated by the open-shift bound (decision 10) and the owner's voided-deposit list. |
| 8 | `code varchar NOT NULL UNIQUE` on both modes, never client-supplied. Allocated under an advisory transaction lock plus a row count that includes voided rows. |
| 9 | Create is `@Auth()`, point-scoped, open shift required. Money is server-computed. `mode = 'receipt'` forces zeros by CHECK. §6.2's 50-crate threshold is a client default, never a server rule. |
| 10 | **Void relaxed from §9.4**: any crate document at the operator's own point while that shift is open; a closed shift is the owner's alone. |
| 11 | **Ledger only.** No `crate_shipments`, no §6.8 dispatch, no §6.9 «порожніх». |
| 12 | One `crates/` module, three tables, the surface in §6. No `PATCH`, no `DELETE`. Over-return is a 400, never a silent clamp. |

## 4. The model

One sentence: **an issuance opens a tranche, a return consumes tranches oldest-first, and the
money always comes from the tranche being consumed.**

### 4.1 Why the queue is single and the money still cannot mix

§6.6 forbade mixing modes in a return. The client's instruction replaces that with a single
queue, and the ban survives intact **as a property of the data rather than a rule in the code**:
`crate_return_allocations.per_unit` is copied from the issuance the row consumes, and a
receipt-mode issuance has `deposit_per_unit = 0` by CHECK. A return spanning both modes
therefore refunds exactly the deposit part and not one kopiyka more, with no branch on `mode`
anywhere in the allocator.

Worked example — the §6.5 case with a receipt tranche spliced into it:

```
18.07  20 ящ. завдаток по 120,00 ₴
24.07  30 ящ. розписка      (—)
28.07  20 ящ. завдаток по 130,00 ₴      на руках: 70

повертає 45 (04.08):
  20 × 120,00 = 2 400,00 ₴   ← tranche 18.07, exhausted
  25 ×   0,00 =     0,00 ₴   ← tranche 24.07, 5 left
  ------------------------------
  deposit_refund = 2 400,00 ₴,  на руках: 25
```

The screen must show that split. A single «45 ящиків повернуто» over a refund of 2 400,00 ₴
reads as a shortchange to the operator and to the supplier standing in front of them.

### 4.2 What «one crate» means

The facility rents one standard crate. `crate_issuances.units` counts crates and nothing else;
neither crate table references `tare_types`. The catalogue's variety (Чешка, Лубянка, Мішок,
Ящик) continues to serve the berry side alone, through `intake_item_tare_types` and §2.5's
weight substitution.

`is_crate` designates which catalogue row *is* the rented crate, and therefore where
`deposit_per_unit` is snapshotted from. It is exclusive: marking a row demotes the others. The
seeded data currently marks two rows and is corrected by this slice.

**§2.6 is untouched and stays literally true.** Crates as weight (a receipt line) and crates as
property (a tranche) are two ledgers that never sum. This slice adds the second one and touches
neither the first nor the arithmetic between them.

### 4.3 The crates cash book

```sql
+ Σ crate_issuances.deposit_taken   WHERE voided_at IS NULL
- Σ crate_returns.deposit_refund    WHERE voided_at IS NULL
      -- both reach the point through shifts, as payouts do
```

Point-lifetime, **no lower date bound** — §7.5 is explicit: «завдаток, узятий у липні, лежить у
шухляді в серпні», «від першої видачі». This is a different shape from the berry book, which is
anchored on the last physical count and bounded by `as_of`; the two cannot share SQL.

There is no counted figure for this book. `cash-book.enum.ts` names the reason: one physical
drawer cannot become two counted numbers without either asking the operator to distinguish
identical banknotes or deriving one book from the other, which makes it unfalsifiable. Правка 10
keeps crate money «тільки в межах точки між постачальником і точкою» — it never travels to the
base and never reconciles against anything, so it needs no count to be useful.

**§6.7's block cannot fire.** FIFO guarantees a refund never exceeds what that supplier
deposited, so the sum above is ≥ 0 under every sequence of valid documents. The check ships
anyway, as a 409 that should be unreachable: if it ever fires, the data is wrong, and a named
refusal beats a silently negative drawer. The real §6.7 risk — deposit cash spent on berries out
of the shared drawer — is physical and invisible to a system that does not count this book.

## 5. Tables

Migration `1788600000011-YagodaCrates.ts`, following the constraint conventions of
`…0007-YagodaIntakesAndPayouts`.

### 5.1 `crate_issuances`

```
id                 uuid PK
shift_id           uuid NOT NULL → shifts            -- point and business date live here (§2.3)
supplier_id        uuid NOT NULL → suppliers
units              int NOT NULL                      CHK > 0
mode               crate_issuance_mode NOT NULL      -- enum already in the DBML
deposit_per_unit   numeric(12,2) NOT NULL DEFAULT 0  CHK >= 0
deposit_taken      numeric(12,2) NOT NULL DEFAULT 0  CHK >= 0
code               varchar NOT NULL                  UQ_crate_issuances_code
issued_by_user_id  uuid NOT NULL → users
voided_at / voided_by_user_id / void_reason          CHK num_nulls(...) IN (0, 3)
created_at, updated_at

INDEX (supplier_id, created_at)   -- the FIFO scan
INDEX (shift_id, mode)            -- the code counter

CHK_crate_issuances_receipt_no_money:
  mode <> 'receipt' OR (deposit_per_unit = 0 AND deposit_taken = 0)
```

`receipt_no` from the DBML is **renamed to `code` and made NOT NULL**. Both modes carry one;
§6.4's «—» on screen is a rendering of `mode = 'receipt'`, not of a stored null, and the CHECK
is what makes that rendering safe to write.

### 5.2 `crate_returns`

Same skeleton: `shift_id`, `supplier_id`, `units` (CHK > 0), `deposit_refund numeric(12,2)`
(CHK >= 0), `accepted_by_user_id`, the void trio with the same CHECK, timestamps,
`INDEX (supplier_id, created_at)`.

**No `code`.** A return has no paper twin: the log of §6.4 is a log of розписки, and nothing in
the rules or the tickets gives a return a number.

### 5.3 `crate_return_allocations`

```
return_id    uuid NOT NULL → crate_returns    ON DELETE CASCADE
issuance_id  uuid NOT NULL → crate_issuances  ON DELETE RESTRICT
units        int NOT NULL            CHK > 0
per_unit     numeric(12,2) NOT NULL  CHK >= 0
amount       numeric(12,2) NOT NULL  CHK >= 0
PK (return_id, issuance_id)
INDEX (issuance_id)
```

`CASCADE` on the return and `RESTRICT` on the issuance are not symmetric by accident: an
allocation is a composition child of its return (like `intake_items`), and an issuance must
never vanish from under rows that point at it.

### 5.4 On `tare_types`

```sql
CREATE UNIQUE INDEX "UQ_tare_types_single_crate" ON tare_types ("is_crate") WHERE "is_crate";
```

A unique index on a column that is `true` for every row it covers admits exactly one such row.
The column form is used rather than `((true))` because TypeORM can declare it on the entity, so
`migration:generate` does not propose dropping it on every future run.

One crate type network-wide. `TareTypesService.create`/`update` demote every other row in the
same transaction when `is_crate` is set, so the owner switches the network's crate in one
action and the index is a backstop rather than the error they meet.

This also closes the TODO at `tare-types.service.ts:99`: deactivating a crate type with
outstanding deposits is a **warning, never a refusal** (§6.1, правка 14). Frozen
`deposit_per_unit` means returns keep working against a retired type; only new issuances are
refused, with a message naming the catalogue.

### 5.5 What is deliberately absent

**No `remaining_units` on the issuance.** It is derived —
`units − Σ allocations from non-voided returns` — for the reason `intakes` has no stored
`remaining` (§3.2): a stored balance is a second copy of a fact, and this schema forbids those.
The price is a `LEFT JOIN` on every FIFO read, which is what `INDEX (issuance_id)` is for.

## 6. Module and surface

```
backend/src/crates/
  crate-issuance.entity.ts · crate-return.entity.ts · crate-return-allocation.entity.ts
  crate-allocation.ts        ← pure FIFO, the whole computation      + crate-allocation.spec.ts
  crate-code.ts              ← the per-(shift, mode) counter
  crates.service.ts          ← issue · return · void × 2             + crates.service.spec.ts
  crate-balance.service.ts   ← tranches · balance · preview
  crate-issuances.controller.ts · crate-returns.controller.ts · crate-balance.controller.ts
  dto/ · crate-issuance.mapper.ts · crate-return.mapper.ts · crates.module.ts
```

Two services because the write path and the read path share only the allocator; three
controllers because `/suppliers/:id/crate-balance` cannot live on a `/crate-issuances` prefix.

No `crate-balance/` module of its own: `supplier-balance/` and `point-cash/` exist as separate
modules because their queries span tables owned by others. This one reads only crate tables.

| Route | Role | Body / query | Notes |
|---|---|---|---|
| `POST /crate-issuances` | `@Auth()` | `{ supplier_id, units, mode }` | Server generates `code`, snapshots `deposit_per_unit`, computes `deposit_taken`. Open shift required. |
| `POST /crate-issuances/:id/void` | `@Auth()` | `{ reason }` | 409 if any allocation references it (§9.3). |
| `POST /crate-returns` | `@Auth()` | `{ supplier_id, units }` | FIFO, allocations, `deposit_refund`. Open shift required. |
| `POST /crate-returns/:id/void` | `@Auth()` | `{ reason }` | Allocations are released by the void filter; no rows are deleted. |
| `POST /crate-returns/preview` | `@Auth()` | same as create | Create minus the write. Same snapshots, same refusals. |
| `GET /suppliers/:id/crate-balance` | `@Auth()` | — | Outstanding units, deposit held, open tranches. §6.3's header. |
| `GET /crate-issuances` | `@Auth()` | `?supplier_id & mode & voided & point_id`, paginated | Journal; #58's «усі розписки постачальника»; the owner's voided-deposit list. |
| `GET /crate-returns` | `@Auth()` | same shape | |

**No `PATCH`** (§2.7, §9.3 — a correction is a void plus a new document) and **no `DELETE`**
(nothing in this codebase has one, and §7.2's numbering depends on that staying true).

**Authority is an `assert` on the row, not a guard**, following the repo's rule that a decision
needing data is a named service method: the owner voids anything; an operator voids any crate
document **at their own point while that shift is open**; a closed shift is owner-only.

**The preview exists because the server owns FIFO.** If the only way to learn a refund were to
POST the return, the reception screen would reimplement the allocator to fill a label, and the
two would disagree the first time a void landed. Same seam as `POST /intakes/preview`.

## 7. Mechanics

### 7.1 The allocator

`crates/crate-allocation.ts`, pure, no Nest and no database:

```
allocate(tranches, requestedUnits) → { allocations[], deposit_refund, shortfall }
```

A tranche is `{ issuance_id, remaining_units, per_unit, mode, created_at }`, ordered oldest
first. The walk consumes `min(remaining, left)` per tranche, computes `amount` through
`money.ts`, and stops when satisfied. **Rounding is per row, then summed** — the repo's rule,
and here the rows are literally what the screen prints above the total.

`mode` is carried for display only: the money follows `per_unit`, which is `0` for a receipt
tranche by CHECK. The allocator has no branch on mode at all.

`shortfall > 0` is the caller's 400.

**Ordering is `created_at`, then `id`** — the `intakes` tiebreaker, because two documents in one
millisecond are ordinary rather than exceptional.

### 7.2 The code

`DocumentKind` in `common/document-code.ts` gains `'CR' | 'CD'`, joining `'IN' | 'PO'`:

```
SHP-CR-20260915-007     розписка #7 at Шипинки that day
SHP-CD-20260915-014     завдаток #14
```

`crates/crate-code.ts` allocates the number inside the write transaction:

```
pg_advisory_xact_lock(hashtext(shift_id || ':' || mode))
SELECT count(*) FROM crate_issuances WHERE shift_id = $1 AND mode = $2
→ pad3(count + 1)
```

Four properties, each load-bearing:

1. **Two counters, not one.** The paper log receives receipt-mode documents only. A shared
   counter would fill it with gaps — and since §6.2's threshold makes deposits the common case,
   most numbers would be missing, so contiguity would stop meaning anything. A log exists so a
   human can see that nothing was torn out.
2. **The count includes voided rows.** A number is never reissued; a voided receipt burns its
   number permanently, which is one explainable gap carrying a `void_reason` (§9.3 keeps the
   document «НАЗАВЖДИ з печаткою»).
3. **`pad3` must not truncate above 999.** `lpad('1000', 3, '0')` is `'100'`, which collides
   with document 100. Migration `…0007` shipped this bug once already.
4. **The row count assumes nothing ever hard-deletes an issuance.** True today — there is no
   `DELETE` anywhere — and stated in the migration comment as well as here, because the day
   someone adds a cleanup script the numbering silently starts reusing codes.

The shift id is the counter key because `UQ_shifts_point_business_date` makes a shift exactly one
(point, day). No counters table.

The typed-code seam **inverts** relative to intakes: there the operator reads a number off the
paper and the server prefixes it; here the server generates and the human copies it onto the
paper. `CreateCrateIssuanceDto` therefore has no `code` field, and a client-supplied one is
rejected rather than honoured.

### 7.3 Locking a return

The write takes `SELECT … FOR UPDATE` on the **supplier row** before reading tranches — the
precedent `payouts` set for §3.6's ceiling. Two returns for one supplier then serialize, and the
second reads the tranches the first consumed. Without it both read `remaining = 20` and both
allocate it.

### 7.4 Voids

- Voiding an **issuance** is refused while any allocation references it (§9.3). The return must
  be voided first.
- Voiding a **return** restores tranche capacity, because `remaining` is derived through
  `voided_at IS NULL` on the return. No allocation row is touched, and the evidence survives.
- Voiding either document moves the crates book immediately (decision 7). Money physically
  changing hands afterwards is an out-of-system act, as правка 11 has it for every other
  shortfall: «система підказує, а керівник вирішує… за межами системи».

### 7.5 Refusals

| Condition | Response |
|---|---|
| No open shift at the point | 409 |
| Supplier belongs to another point | 404 (scope leak prevention, as elsewhere) |
| No active `is_crate` tare type | 409 naming the catalogue |
| `units` exceeds outstanding | 400 — «помилка вводу, а не подія» (§6.5) |
| Issuance has allocations | 409 |
| Operator voiding at a closed shift | 403 |
| Crates book would go negative | 409 — the §6.7 assertion |

**Over-return is never clamped.** Правка 15's case (25 arrive against 20 issued) is resolved at
the counter: 20 enter the system, 5 are the supplier's own, swapped for empties, and «в системі
це не записується». The clamp belongs in the client's prefill where a human sees it; a server
that quietly wrote 20 when asked for 25 would be editing a document.

## 8. Testing

**Unit — `crate-allocation.spec.ts` carries the weight.** §6.5's literal case (20 @ 120 then
20 @ 130, return 7 → 840,00 ₴ off the older tranche, 33 left); §4.1's mixed-mode case; exact
boundary consumption; a return spanning three tranches; one-unit returns; and a request exceeding
outstanding.

**No `round(Σ) ≠ Σ round(each)` case exists here, unlike in `intakes`.** A scale-2 price times an
integer unit count is exact, so the two can never disagree for crates. The per-row discipline is
kept in the implementation anyway — the rows are what the supplier checks — but the test asserts
exactness rather than inventing a divergence the domain cannot produce.

**Unit — `crates.service.spec.ts`:** every row in §7.5, plus receipt mode carrying money and an
operator voiding a closed shift's document.

**DB — `migrations/crates-schema.db-spec.ts`:** each CHECK and unique index actually rejects —
two `is_crate` rows, a receipt-mode row with a deposit, a broken void trio, a duplicate `code`,
`units = 0`. These are Postgres semantics a mocked spec cannot reach.

**DB — `crates.db-spec.ts`:** the document lifecycle end to end, including that voiding a return
restores tranche capacity and that a voided issuance leaves the crates book through the same
query the API serves.

**DB — `crates-race.db-spec.ts`:** two concurrent returns for one supplier (the supplier lock
must serialize them), and two concurrent issuances in one (shift, mode) (the advisory lock must
not produce a duplicate code). Modelled on `payout-race.db-spec.ts` and
`shift-close-race.db-spec.ts`.

**Dev seed:** crates at the seeded points — a supplier holding two tranches at different prices
with a partial return against the older one, plus one receipt-mode issuance — so §6.3's header
and #58's list are non-empty on a fresh database. The seed asks the service for its numbers
rather than computing them, so the demo cannot drift from the rule. `Ящик` is corrected to
`is_crate = false`.

## 9. Out of scope

- **`crate_shipments` and §6.8's evening dispatch.** A fourth table with its own lifecycle, its
  own snapshot rule («кількість "з ягодою" запамʼятовується на момент відправлення»), its own
  void semantics and a second-shipment-per-day case. None of the three tickets ask for it.
- **§6.9's «порожніх» and the `target_crates` comparison.** Two of its three terms become
  computable with this slice — «у людей» from the ledger, «з ягодою» from `intake_item_tare_types`
  filtered to `is_crate` — but «порожніх» needs the dispatch above. The screen shows «—» until
  then.
- **A `cash_counts` row with `book = 'crates'`,** and with it the settlement trio for voided
  crate money. Both arrive together or not at all (§4.3, §11.1).
- **The intake↔return pairing of ticket #57.** The ledger half is this slice; composing it with
  the reception screen is client work built on the preview endpoint.
- **All frontend.**

Each goes to `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md`.

## 10. Documents this slice edits

Four records of truth go stale the moment this ships, and a reader who trusts any one of them
will re-derive a decision already made.

- **`28-db-schema.dbml`** — `receipt_no` → `code`, NOT NULL; ЗАПИТАННЯ 2 closed (generated);
  the `crate_return_allocations` Note reversed from «розписка й завдаток не змішуються» to
  "money does not mix, the queue is single"; the `tare_types` Note split — ticket #12's counting
  answer stands, its money half now requires the exclusive `is_crate`, and the two no longer
  «закриються разом»; the «Відкрите, і не полагоджене» block replaced by decision 7 with its
  reasoning and its trigger for revisiting.
- **`26-rules-by-example.md`** — §6.6 and §9.4's «ящиковий документ → тільки керівник».
- **`docs/26-правки-і-запитання.md`** — ЗАПИТАННЯ 2 and пропозиція 2 both still read «ввід
  руками, без генерації».
- **`backend/CLAUDE.md`** — a `crates/` line in the module map; the `cash-book` note that only
  `berry` is ever written.

Shipped code that changes behaviour: `point-cash` gains the crates figure as a **separate
field**, never summed with `cash`; `tare-types.service.ts` gains the demote-others transaction
and loses its TODO; `common/document-code.ts` gains two kinds; `cash-book.enum.ts` loses the
claim that no deposit has ever been taken.

## 11. Residual risks

Recorded as decisions, not discovered later as surprises.

1. **A taken deposit can be erased with no counterpart record** beyond the audit log and the
   voided-deposit list, by the same person who took it (decisions 7 and 10). Accepted
   knowingly. **The trigger to revisit is the day the crate drawer gets counted** — the
   settlement trio and `book = 'crates'` arrive together.
2. **§6.7's block cannot fire** under valid documents. Shipping as an assertion (§4.3).
3. **Code numbering depends on nothing ever hard-deleting an issuance** (§7.2, property 4).
4. **The crate deposit price is network-wide.** Per-point pricing would be a new table, not a
   new column.
5. **§6.2's threshold lives only in the client.** Two clients would drift; there is one.

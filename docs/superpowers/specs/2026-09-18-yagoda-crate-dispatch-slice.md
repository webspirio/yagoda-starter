# Yagoda CRM — Broken Crates at Shift Close Spec (§6.8, partial)

**Date:** 2026-09-18
**Source:** GitHub issue #110 («Закриття зміни — Ящики», milestone «Каса точки і зміна»),
`26-rules-by-example.md` §6.8–§6.10, `28-db-schema.dbml`, and the brainstorming session of
2026-09-18. The foundation spec's §5 data conventions bind this slice in full.

**Position in the schema:** this slice adds **no table.** The schema stays at twenty-two. It adds
ONE nullable integer column to `shifts` and one derived read. That is the whole of its surface,
and the narrowness is the design rather than a first instalment of something larger — §2 says
what was considered and refused.

**THIS SLICE UNBLOCKS §6.9 WITHOUT BUILDING IT.** The crates slice (2026-09-15) recorded that
§6.9's «порожніх» was uncomputable until dispatch existed. After this column it is computable —
§7 records the formula so the follow-up does not have to rediscover it — but the panel itself is
out of scope.

---

## 1. Goal

Let the operator say how many crates broke, and let the close screen show what leaves for the base.

§6.8 prints three numbers:

```
з ягодою     142 ← рахує система з квитанцій дня; поля вводу немає в ЖОДНОЇ ролі
бій            3 ← вписує приймальник окремим рядком
відправлено  145 ← назад точка отримає СУМАРНУ кількість: і з ягодою, і ламані
```

Two of the three are already derivable from tables that ship. **«Бій» is the only fact in issue
#110 that the database cannot currently hold**, and it is one non-negative integer per shift.
Everything below follows from taking that literally.

---

## 2. Decisions

| # | Decision |
|---|---|
| 1 | **«Бій» is one number per shift, typed at close.** Not a document, not a repeatable event. It has no `code`, no author of its own, no `void_*` trio. |
| 2 | **It lives on `shifts`, as a column.** Not a fourth crates table. |
| 3 | **A re-close overwrites it.** A reopen sets it back to `NULL`; the previous value survives in the audit log and nowhere else. |
| 4 | **`NULL` and `0` are different facts.** `NULL` is «не записано», `0` is «нічого не побилось». |
| 5 | **`crate_shipments` stays deferred.** §6.8's snapshot rule and its two-dispatches-a-day case are not built. |
| 6 | **The derived read lives in `crates/`, not `shifts/`.** Forced by the money-arithmetic eslint rule — §5.3. |
| 7 | **§6.9's panel is out of scope**, and its formula is recorded in §7 rather than implemented. |

### 2.1 Why not a table (decision 2)

Three homes were considered.

**`crate_issuances` with a fourth `mode`** — refused outright. Every row in the three crates
tables is **supplier-scoped**: it names a person who owes crates or is owed money. A broken crate
is the point's own loss, owed to nobody, and `supplier_id` is `NOT NULL` on both tables. Adding a
nullable supplier to carry breakage would make the FIFO allocator branch on a case that has no
money in it.

**A `crate_breakages` table, one row per close** — the serious alternative, and it has a real
precedent: `cash_counts` is exactly this shape, and it exists as a table precisely because *«a
count that can be written on its own can be skipped»*. It was refused for the reason that
precedent also carries. A reopen **demotes** the closing cash count to `midday` rather than
replacing it, and §7.6's «evidence is never destroyed» is why. That demotion is the single most
error-prone rule in the cash slice — `cash-counts`, `is_open` and `point-cash`'s
`unexplained_difference` each have to filter `midday` out, and the documented failure of getting
it wrong is *«counting both reports −180 where the drawer is −90 out»*. Reproducing that
machinery for a count of broken crates buys evidence nobody has asked to audit, and costs the
same trap a second time.

**A column on `shifts`** — chosen. The shift row already carries `explanation`, a human-entered
field written after the fact, so a typed value on this row is not a new kind of thing.

The shift entity's own doc comment argues *against* columns — *«NO cash columns of any kind …
Denormalising any of them onto this row would be «два примірники одного факту»»* — and that
argument does not reach here. It forbids a **second copy** of a fact that `cash_counts` already
owns. `broken_crates` has no other home; there is no first copy for it to duplicate.

### 2.2 Why overwrite (decision 3)

A correction is therefore **reopen + re-close**: owner-gated, audit-logged on both halves, and
refused to the operator once the shift is shut. That is §9.3's «виправлення це новий документ»
expressed with the mechanism a shift already has, which the shift entity names as absence 1 — *«a
mistaken close is undone by REOPENING (owner-only), not by voiding»*.

The cost is stated plainly: **the overwritten value exists only in the `shift.closed` audit
entry's `after`.** Nothing in the API reads it back. That is accepted because no rule in §6 asks
what the breakage figure was before it was corrected.

---

## 3. Data model

```sql
ALTER TABLE shifts ADD COLUMN broken_crates int;

ALTER TABLE shifts ADD CONSTRAINT CHK_shifts_broken_crates_non_negative
  CHECK (broken_crates >= 0);

ALTER TABLE shifts ADD CONSTRAINT CHK_shifts_broken_crates_closed
  CHECK (closed_at IS NOT NULL OR broken_crates IS NULL);
```

### 3.1 The second CHECK is one-sided, and that is deliberate

The symmetrical form — `(closed_at IS NULL) = (broken_crates IS NULL)` — is the one this slice
started with, and it cannot be written. It forces **every already-closed shift** to carry a
number, so the migration would have to invent one for the 150 closed shifts the dev seed
generates and for whatever is in production. Backfilling `0` asserts «нічого не побилось» for
days nobody was asked about.

That is the precise lie `28-db-schema.dbml` refuses elsewhere, in this same subject area:
`target_crates` has no `NOT NULL` and no default because *«нуль стверджував би, що ящиків немає,
тоді як ми просто не знаємо, скільки їх має бути»*. The same sentence applies word for word to
breakage.

The half that **is** true forever is «a number never sits on an open shift», and it survives both
the history and decision 3's reopen-to-`NULL`. So:

| `closed_at` | `broken_crates` | means |
|---|---|---|
| `NULL` | `NULL` | shift is open — enforced by the CHECK |
| `NULL` | any number | **impossible** |
| set | `NULL` | closed before this column existed — the only way to reach this state, since §4.1 makes the DTO field required |
| set | `0` | closed, nothing broke |
| set | `n > 0` | closed, `n` broke |

`broken_crates` is `int`, not `numeric`. It is a count of physical objects, so none of
`money.ts`'s machinery touches it — see §5.3.

---

## 4. Behaviour

### 4.1 Write — inside the close transaction

`CloseShiftDto` gains a sibling to `counted_amount`:

```ts
/** `Max` is a typo guard, not a business rule — #110's own example is 3.
 *  REQUIRED, and zero is a normal value (#110, literally: «нуль — нормальне
 *  значення»). `NULL` means «не записано» and is not reachable through this
 *  DTO — only an open shift or a pre-migration close has it. */
@IsInt()
@Min(0)
@Max(10000)
broken_crates: number;
```

Required rather than optional, for the reason the cash count is written inside this same
transaction rather than beside it: a number that can be skipped gets skipped.

`ShiftsService.close` sets it on the `Shift` it already saves. `ShiftsService.reopen` sets it to
`NULL` on the `Shift` it already saves. **No new write path, no new transaction, no new audit
action** — the existing `shift.closed` and `shift.reopened` entries carry it in `after`.

Close is `@Auth(UserRole.PointOperator)` already (§10.3), so «бій вписує приймальник» is true by
construction and needs no new check.

### 4.2 Read — `GET /shifts/:id/crates`, `@Auth()`

```jsonc
{ "with_berry": 142, "broken": 3, "dispatched": 145 }
```

- **`with_berry`** — `Σ intake_item_tare_types.units`, joined `→ intake_items → intakes`, where
  `intakes.shift_id = :id`, `intakes.voided_at IS NULL`, and the tare type is the single
  `is_crate = true` row. Computed on every call, stored nowhere, and with **no input field in any
  role** (#110: «поля вводу немає»). An empty shift gives `0`, not `null` — the query knows there
  were no crates, which is different from not knowing.
- **`broken`** — the column. `null` on an open shift.
- **`dispatched`** — `with_berry + broken`, or `null` while `broken` is.

**It must serve an OPEN shift.** The close screen renders `142` while the operator is still
typing the breakage, so a read that required a closed shift would be useless to the one screen
that needs it. Point-scoped through the shift with the same `resolvePointFilter` as every other
shifts read, so an operator sees their own point and the owner sees all.

### 4.3 What is NOT stored

«Відвантажено» is never written. It is `with_berry + broken` at read time. Storing it would be a
third copy of a fact the other two already fix, and §6.8's snapshot semantics — the reason a
stored total would be defensible — belong to the dispatch document this slice does not build.

The consequence is named rather than hidden: **voiding an intake on a closed day silently moves
that day's «відвантажено»**. §6.8 anticipates exactly this and asks for a warning — *«було 142,
стало 145» — і система МОВЧКИ нічого не переписує* — which is a dispatch-document behaviour,
because the warning needs a snapshot to compare against. Until `crate_shipments` exists the
number simply recomputes. Recorded in §7.

---

## 5. Module placement

### 5.1 `shifts/` owns the column

Entity field, migration, DTO field, and the two assignments in `close` and `reopen`.

### 5.2 `crates/` owns the derivation

A new `crates/crate-dispatch.service.ts` and a controller for the `/shifts/:id/crates` route.
This matches how the module already works: `point-cash/` reads `CRATE_BOOK_SQL` out of
`crates/crate-balance.service.ts` rather than re-deriving the filter, and the module already has
three controllers because *«`/suppliers/:id/crate-balance` cannot live on a `/crate-issuances`
prefix»*. A shift-prefixed route in `crates/` is that same established shape.

### 5.3 Why the read lives in `crates/`

**An earlier draft of this spec said the money-arithmetic eslint rule FORCED this, and that was
wrong.** It is recorded rather than deleted, because the next reader will reach for the same
argument. Two things defeat it, both checked against the source:

1. `no-restricted-globals` catches the bare global `parseInt`. `Number.parseInt(...)` is a
   `MemberExpression` and passes, and `CallExpression[callee.name='Number']` does not match it
   either. `crate-balance.service.ts` — a file that IS on the banned list — already uses
   `Number.parseInt` with a comment saying «A row COUNT, not money». The same escape is available
   inside `src/shifts/**`.
2. No conversion is needed at all. `COALESCE(SUM(...), 0)::int` returns Postgres `int4`, which
   node-postgres parses to a JS **number**; only an uncast `SUM()` (`int8`) arrives as a string.

So placement is a **module-boundary decision, not a lint consequence**, and it stands on its own:
`crates/` owns crate counting, exactly as `point-cash/` reads `CRATE_BOOK_SQL` out of
`crates/crate-balance.service.ts` rather than re-deriving the filter. Putting a crate query in
`shifts/` would make `shifts/` the second module that knows how `is_crate` selects a tare type.

The `::int` cast is still required, for the reason in (2) — an uncast `SUM()` would hand a string
to a field typed `number`, which TypeScript would not catch, because `runner.query` returns
`any`. Type the row shape explicitly, as `crate-balance.service.ts` does.

The one arithmetic operation in this slice, `with_berry + broken`, is integer addition. `+` is
not among the banned operators anywhere in the repo, and `money.ts` is not involved at any point.

---

## 6. Testing

| Where | What |
|---|---|
| `crates/crate-dispatch.service.spec.ts` | a voided intake is excluded; a non-crate tare type is excluded; a shift with no intakes gives `0`, not `null`; `dispatched` is `null` exactly when `broken` is |
| `crates/crates.db-spec.ts` | real Postgres: an intake with 12 crates and 8 Чешка gives `with_berry = 12`; voiding it gives `0` |
| `shifts` db-spec | close with `broken_crates: 3` persists it; reopen sets it `NULL`; re-close with `0` stores `0` and the `3` is still readable in the audit log |
| DTO spec | `-1` rejected, `0` accepted, absent rejected, `3.5` rejected |
| constraint | a direct `UPDATE` setting `broken_crates` on an open shift raises 23514 |
| dev seed | a non-zero breakage on Шипинки's closed shift, `0` at the other points, so the screen has both cases on a fresh database |

**Verification tier:** this slice carries a migration, so per CLAUDE.md's evidence table it needs
`npm run verify:full` — `test:db` is not in the fast tier.

---

## 7. Out of scope → `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md`

- **`crate_shipments` and the rest of §6.8.** The dispatch document, its snapshot of «з ягодою» at
  the moment the truck leaves, the «було 142, стало 145» warning that needs that snapshot, two
  dispatches a day, and void semantics. Still deferred, now for the second time.
- **§6.9's end-of-day panel.** Its blocker is gone with this column, so record the formula and
  leave the screen at «—»:

  ```
  поїхало на базу (день)   = with_berry + broken_crates, per shift
  поїхало на базу (всього) = Σ of that over the point's shifts
  у людей                  = crates/crate-balance.service.ts
  порожніх на точці        = target_crates − у людей − Σ поїхали      ← RESIDUAL
  ```

  **Use §6.9's residual form, not #110's movement chain.** The ticket writes it as
  `було порожніх 496 − видано 20 + повернуто 7 − поїхало 142 = 341`, which needs a stored opening
  stock of empty crates that no table holds and that could disagree with the ledger. §6.9 derives
  the same 341 as `800 − 195 − 264` with no new state. Both reach 341 in the worked example, which
  is why the ticket's arithmetic does not settle it — the schema's own «два примірники одного
  факту» does.

  Also carry §6.9's display rules: negative is shown red and does not block (*«система показує
  факт, а не спиняє день заднім числом»*), and a point with no `target_crates` shows «—», never
  `0`.
- **§6.10's «підсумок ящиків, а не ягоди» at close. THIS SHIPPED — the claim that follows was
  wrong, and is recorded rather than deleted for the same reason as §5.3.** It said that what the
  operator sees at close is frontend and that this slice ships none. Making `broken_crates`
  required on `CloseShiftDto` (§4.1) removed that choice: `POST /shifts/:id/close` is a live route
  the shipped SPA already calls, so a required field turns every close in the product into a 400
  until the form carries it. The frontend was therefore MANDATORY, not deferrable scope, and the
  close drawer ships the breakage input together with §6.10's three numbers — «з ягодою», «бій»
  and «Відвантажено» — in `features/count-shift/ui/CountDrawerDialog.tsx`.
- **A `cash_counts` row with `book = 'crates'`.** Untouched by this slice and still paired with
  the settlement trio: both arrive together or not at all.
- **All frontend — RETRACTED, see §6.10 above.** What is genuinely still out of scope is the
  frontend for §6.9's panel. The close screen is not, and was never optional once §4.1 made the
  field required.

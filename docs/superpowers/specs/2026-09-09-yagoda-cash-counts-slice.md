# Yagoda CRM — Cash Counts Slice Spec

**Date:** 2026-09-09
**Ticket:** #20 «Shift logic» (milestone «Каса точки і зміна»), **slice 2 of 3**.
**Source:** the client's ruling of 2026-09-09 (quoted in §2), `26-rules-by-example.md` §7,
`28-db-schema.dbml`, and the `/grilling` session of 2026-09-09 that followed the ruling.
The transfers spec (`2026-09-09-yagoda-transfers-cash-slice.md`) is **the transfers spec**
throughout; the foundation spec's §5 data conventions bind this slice in full.

**Position in the schema:** 13 of 17 tables are built. This slice implements **one** —
`cash_counts` — and rewrites the anchor of the `point-cash` module. After it, three remain, all
of them crates: `crate_issuances`, `crate_returns`, `crate_return_allocations`.

**THIS SLICE CHANGES CODE THAT IS ALREADY SHIPPED, and that is its most important property.**
Slice 1 computed a point's cash from the beginning of time over documents alone. This slice
re-anchors that computation on physical counts, and forces one reversal in `transfers`. §10
lists every shipped file that moves. A reader who treats this as purely additive will leave the
two halves disagreeing.

---

## 1. Goal

Make the drawer answerable.

Slice 1 can say what a point's cash *should* be if every document is right and nothing has gone
missing. It has no way to notice that 350 ₴ is not there. This slice adds the only thing that
can: a human counting the drawer, at the open and at the close of every shift, with the
difference recorded and reported.

## 2. The client's ruling, verbatim in substance

Recorded first because four of this slice's decisions come from it rather than from the rules:

> When opening or closing a shift, the cash drawer must be counted, just as it is when opening
> the system for the first time. When the system is opened for the first time, we count the cash
> at each collection point. This becomes the initial value, which we consider the starting cash
> balance for that point. The cash balance at shift opening must match the balance from the most
> recent shift closing, if there has been one. The cash balance at shift closing must match the
> result of our daily operations. **If the cash balance does not match, this does not block the
> process. We proceed based on the counted amount, but notify the owner about the discrepancy so
> that the incident can be investigated and the cause identified.**

The last sentence overrules §7.7 in full. §7.7's own closing note already leaned this way —
«система підказує, а керівник вирішує проблему недостачі в ручному режимі за межами системи» —
but its rule text says the opposite, and the rule text is what the enum encodes.

## 3. The model

One sentence: **`expected = the previous count + the movements between them`; `discrepancy =
counted − expected`; recorded, reported, never blocking.**

### 3.1 The chain, and why there is no second number

```
counted(n)   = expected(n) + d(n)
expected(n)  = counted(n−1) + movements(n−1 → n)
→ counted(n) = counted(0) + Σ movements + Σ d
documents    = counted(0) + Σ movements
→ divergence = Σ d
```

A point's **accumulated unexplained difference is `Σ (counted_amount − expected_amount)` over its
counts**, and nothing else. It is not stored, not snapshotted and not a second formula: the
count chain and the document line can differ by the discrepancies and by nothing else, so a
stored divergence would be a second copy of a fact the schema already holds. This was the
client's own observation during the grilling and it removed a column from an earlier draft.

### 3.2 The first count is the baseline, and there is no «initial» kind

A point's first count has no predecessor. Its `expected_amount` is set **equal to its
`counted_amount`**, so its discrepancy is zero by construction.

That is not a fudge. The ruling says the counted figure *becomes* the starting balance, which
means that at that instant the expectation genuinely is whatever is in the drawer. It keeps
`expected_amount` `NOT NULL` as the DBML has it, and it keeps `Σ (counted − expected)`
arithmetically correct with no special case — the first count contributes zero.

**There is no `initial` value in `cash_count_kind`, no nullable `shift_id`, and no
`opening_balance` column on `collection_points`.** Go-live is each point opening its first shift;
counting the drawer is part of opening one. The alternative — a baseline count outside any shift
— would need a nullable foreign key and a second path through every query, to distinguish a case
nobody acts on.

**This retires the transfers spec's §6.6 go-live ceremony.** That spec has the owner sending each
point a transfer for its opening balance, with `carrier` reading «Залишок на 09.09.2026». The
first count replaces it, which is what the client described and is better: the drawer's opening
figure is now a count of the drawer rather than a document about it. Nothing in the shipped code
depends on the ceremony — it was instructions, not behaviour — but the transfers spec is amended
(§11).

### 3.3 Movements are bounded by the shift

`movements(previous count → this count)` = every cash movement belonging to **this shift**:

```
+ Σ transfers accepted into this shift    (the effective figure — see §4.2)
− Σ payouts.amount WHERE shift_id = this shift    -- INCLUDING voided
+ Σ payouts.amount WHERE shift_id = this shift AND return_settled_at IS NOT NULL
```

**Shift-bounded rather than timestamp-bounded, by the client's decision**, whose reasoning is
recorded because it outranks the technical argument: «closing the shift is an important part of
the process, and it will be easier for us to make sure shifts are closed on time than to deal
with time boundaries». A rule the business can train and audit beats a boundary only the code
can see.

The alternative considered and rejected was bounding each count by the previous count's
timestamp, which dissolves the Friday-closed-Saturday problem automatically. It was rejected in
favour of process discipline. §9.1 records what that costs.

Both asymmetries from the transfers spec survive **unchanged**: voided payouts stay subtracted
(the money left the drawer and returns only via `return_settled_at`), voided transfers stop
counting entirely. Same column, two opposite readings, and §9.3 is still the reason.

## 4. What this forces in `transfers` — a reversal

### 4.1 Accepting a transfer now requires an open shift

The transfers spec §6.4 says the opposite, at length, and the client approved it: the carrier
arrives when they arrive, and a point should not open its book to sign for a delivery.
Shift-bounded accounting makes that untenable — a transfer accepted outside any shift belongs to
no shift's arithmetic, so it enters no expectation and surfaces as a discrepancy when nothing
went wrong.

The same-day version is worse, and it is the flow §7.9 itself describes: «машина виїхала ввечері,
точка порахувала вранці». A transfer accepted at 07:00, before the 07:30 opening count, is in the
drawer when the drawer is counted. With date-granular bounds there is no way to distinguish
«accepted before the count» from «accepted after it», so it lands in the opening drawer *and* in
the day's movements — a surplus at opening and an equal shortage at close, two false incidents
from one correct delivery.

`accept` and `dispute` therefore refuse with `409 NO_OPEN_SHIFT` when the point has no open
shift. The operator opens the shift, then signs. The carrier waits either way.

### 4.2 `accepted_date` comes from the shift, not from the clock

`TransfersService` currently stamps `accepted_date` from `TimeService.now().toISODate()`. It must
instead take the **open shift's `business_date`**.

Date-matching would otherwise break on precisely the case the client is planning to tolerate: a
shift opened Friday and closed Saturday morning has `business_date = Friday`, while a transfer
accepted into it on Saturday would stamp `accepted_date = Saturday` and fall outside its own
shift's movements.

This still honours §7.9's actual argument, which was only ever «зараховано ДНЕМ ПРИЙНЯТТЯ, а не
днем відправлення» — do not use the dispatch day. The shift's business date *is* the operational
day of acceptance.

**No `shift_id` column is added to `transfers`.** With `UQ_shifts_point_business_date` there is
exactly one shift per point per day, so `(collection_point_id, accepted_date)` identifies it, and
§4.1 guarantees every accepted transfer has one. The DBML's deliberate omission stands.

## 5. Table

`cash_counts` **exactly as `28-db-schema.dbml` defines it** — this slice adds no column:

```
id, shift_id, book, kind, counted_amount, expected_amount,
counted_by_user_id, counted_at, created_at
```

- `book` is written from a **constant** (`berry`) — see §7.
- `kind` is `opening | closing`, plus `midday` reachable only via §6.3.
- `counted_by_user_id` is **who pressed the button**, not who opened the shift (§10.6 — «якщо
  касу перерахує Марія, у документі перерахунку стоїть Марія»).
- `expected_amount` is a **snapshot**, frozen at the moment of counting. The DBML's defence is
  «без нього пізніша подія тихо переписала б учорашню розбіжність», and the event is nameable:
  voiding a transfer drops it from the formula retroactively, so an owner voiding a three-day-old
  transfer would silently rewrite every discrepancy since. Voided *payouts* cannot do this — they
  stay subtracted.
- The unique index is **partial**: `UNIQUE (shift_id, book, kind) WHERE kind <> 'midday'`. DBML
  cannot express that; it is hand-written, as `UQ_shifts_open_per_point` was.

**No `void_*` trio, and no correction path.** A count is evidence, not a document — §7.6:
«перерахунок це свідчення, а не коригування». It has no code, no paper twin and no supplier copy.
A count that was wrong is answered by counting again (§6.3), never by editing.

## 6. Routes

| Method | Path | Role | Body |
|---|---|---|---|
| `POST` | `/shifts` | operator | `{ counted_amount }` |
| `POST` | `/shifts/:id/close` | operator | `{ counted_amount }` |
| `POST` | `/shifts/:id/reopen` | owner | `{ reason }` — unchanged, behaviour extended (§6.3) |
| `PUT` | `/shifts/:id/explanation` | owner | `{ explanation }` |
| `GET` | `/cash-counts` | any | `collection_point_id?`, `shift_id?`, `from?`, `to?`, `only_discrepancies?`, `page?`, `limit?` |

### 6.1 The count is part of the verb

`POST /shifts` and `POST /shifts/:id/close` each write the shift row **and** its count row in one
transaction, or neither.

«Must be counted» is only true if it cannot be skipped. A separate `POST /cash-counts` would
permit a shift to exist for an hour with no opening count, at which point the closing expectation
has no anchor and the chain is broken for that point forever. One transaction also means the
`expected_amount` snapshot is taken under the same lock that reads the movements.

`ShiftsService.open` currently takes no DTO, and its own comment predicted this: «THE ROUTE IS
PROVISIONAL IN SHAPE … Both arrive with `cash_counts`, and that is when this grows a DTO.»

### 6.2 Neither route returns the expectation before the count is written

§7.6: «очікувана сума СХОВАНА, поки не введено фактичну». The discrepancy appears in the
**response**, after the write.

**This is a nudge and not a control, and the spec says so rather than pretending otherwise.** The
expected figure and the point's cash are the same number, and §7.10 requires the cash screen to
be the same for both roles — so an operator can read it in another tab, or simply add up the
day's payouts, which they witnessed. Building the nudge costs nothing; damaging the screen §7.1
and §7.10 both argue for, to make it a real control, costs the operator the «не вистачає до
цільового» line that exists «просто щоб бачили вони».

### 6.3 Reopening demotes the closing count to `midday`

`POST /shifts/:id/reopen` is shipped, owner-only, and exists for a mistaken close at 11:00 with
cars still arriving. Reopening and re-closing needs a second `closing` count, which
`UNIQUE (shift_id, book, kind)` refuses. **Reopen therefore rewrites the existing closing count's
`kind` to `midday`.**

The 11:00 count was not a close; it was a count taken at 11:00, and `midday` is the kind that
exists for exactly that and is deliberately outside the unique index. `counted_at`,
`counted_by_user_id` and the frozen `expected_amount` are all preserved — nothing is destroyed,
nothing invented, and the second close writes a fresh row against a free slot.

**It mutates a posted row, which this codebase otherwise refuses to do.** The defence is the one
the intakes spec used for why a shift may be reopened while an intake may only be voided: a count
carries no code, no paper twin and no supplier copy. The alternatives are destroying evidence
(§7.6 forbids it) or making every closing-count lookup an ordering problem, where a bug returns a
wrong cash figure instead of an error.

A reopened shift's second closing expectation is **unchanged** — still `opening count + this
shift's movements`. It is the same shift. The demoted count is history; **`midday` counts never
anchor anything.**

`midday` gets **no endpoint** in this slice. §7.6's «перерахувати можна скільки завгодно разів»
is real but unasked-for; the kind is reachable only as a by-product of reopening until it is.

### 6.4 Nothing blocks

There is no path by which a discrepancy prevents a close. `close` stays **operator-only** — §10.3
puts opening and closing with the operator, and removing the blocking removes the one reason the
owner was ever involved.

`shift_status.awaiting_explanation` becomes **unreachable by decision, not by omission**, and
stays in the enum with a comment saying so — removing an enum value is a migration nobody should
have to write, and the next reader must not implement it as a gap. `shifts.explanation` is used,
for the half of §7.7 the client kept (§6.5).

### 6.5 The owner's explanation

`PUT /shifts/:id/explanation`, owner only (§10.2), writes `shifts.explanation`. Idempotent —
re-sending replaces the text, and an empty body is refused.

An **open incident** is a count whose `counted_amount <> expected_amount` on a shift with no
explanation. `GET /cash-counts?only_discrepancies=true` is the owner's working list, and it
shrinks as it is worked.

Two limits, accepted rather than designed around:

- **One explanation per shift, not per count.** A shift whose opening and closing counts are both
  off for different reasons shares one text field. The shift is the unit an owner investigates,
  and an `explanation` column on `cash_counts` would be a schema addition serving a case nobody
  has reported.
- **Explaining is not correcting.** §7.7's «розбіжність у документі лишається, її не підганяють»
  holds: the numbers never move, and `Σ (counted − expected)` still includes explained incidents.
  An explanation changes what is *open*, never what is *true*.

## 7. Berry only, and the drawer problem this defers

`book` is written from a constant. The operator enters **one** amount; there is no crates count.

That is truthful today: `crate_issuances` and `crate_returns` do not exist, no deposit has ever
been taken, and the whole drawer *is* the berry book. Ticket #20 says so — «це стосується лише
каси за ягоди».

**Named for the crates slice, because it will inherit the DTO shape chosen here.** §7.6 says the
two books are counted separately; the same note says «фізично шухляда одна, книг дві». One
physical count must become two book figures and **nobody has decided how**. Neither candidate is
acceptable as stated: asking the operator to split it is asking them to distinguish banknotes
that are identical, and deriving berry as `counted total − expected crate deposits` makes the
crates book unfalsifiable, since it could never disagree with itself. Adding a second amount to
the DTO later is additive; deciding the semantics is not.

## 8. `point-cash` is re-anchored

**The formula's bounds and base change; its arithmetic does not.**

Today (`point-cash.service.ts`), `cashSql` sums documents from the beginning of time against a
date: `accepted_date <= D`, `shifts.business_date <= D`, and an `AT TIME ZONE` cast on
`return_settled_at`. Under §3 a point's cash is:

```
cash = latest non-midday count's counted_amount
     + (that count's shift's movements, ONLY IF that count was its `opening`)
```

**The anchor is the latest `opening` or `closing` count, and `midday` is excluded from anchoring
— consistent with §6.3's «midday counts never anchor anything», and load-bearing here.** A
demoted midday count (§6.3) sits in the middle of a shift, and isolating "the movements after
it" would need a timestamp bound this slice does not have. Excluding it is not a simplification;
including it would be unimplementable under §3.3.

There is no third term for "shifts after the anchor", and that is a consequence rather than an
omission: §6.1 makes every shift opening write an `opening` count, so a shift later than the
anchor would itself hold a later count and *be* the anchor. The two live cases are therefore:
the current shift's `opening` count (add that shift's movements so far), or the last shift's
`closing` count (add nothing — the drawer has been counted and nothing has moved since).

What survives untouched: the three-way `CASE` over transfer status (accepted → `cash`, resolved
dispute → `resolved_cash`, open dispute → `reported_cash`), the voided-payout asymmetry, the
`0.00` fallback, `::text` on every projection, and the rule that nothing is stored or cached.

What changes: the base is a count rather than zero, and the bounds are shifts rather than dates.
The `AT TIME ZONE` cast on `return_settled_at` is **no longer needed by this query** — a returned
payout belongs to its shift, not to a calendar day. `asOfSql` and the timezone injection stay in
the module for `as_of`, which still names a business date.

**A point with no counts reads `0.00` and always has** — its documents are ignored entirely until
someone counts the drawer. That is correct under §3.2 and it is a visible behaviour change for
any point already carrying transfers: on deploy, every point's cash reads `0.00` until its first
shift opens. Called out because it will look like a regression.

`GET /point-cash`'s row gains **`unexplained_difference`** — `Σ (counted − expected)` for that
point — which §3.1 makes free. `shortfall` stays `target_cash − cash`, and a point with no target
still appears with `shortfall: null`.

## 9. What this slice deliberately cannot do

### 9.1 A late close still misfiles a same-day transfer

The cost of §3.3's shift bounds, named rather than hidden. Friday's shift is closed Saturday
morning; a transfer accepted Saturday into that still-open Friday shift takes
`accepted_date = Friday` (§4.2), which is what makes the arithmetic close — but the money reached
the point on Saturday, and §7.9's «гроші не мають лежати в касі за день, коли їх фізично не було»
is bent by exactly one day.

The client accepted this in exchange for auditable process discipline. The mitigation is
operational, not technical: close shifts on time. Timestamp bounds would remove it and were
declined.

### 9.2 And the rest

- **No midday endpoint** (§6.3).
- **No crates book** (§7).
- **No notification.** «Notify the owner» is a read — `GET /cash-counts?only_discrepancies=true`
  plus `unexplained_difference` on the cash screen. There is no email, no push, and no
  notification centre in this project, and this slice does not build one.
- **No resolution workflow beyond a text field.** The cause is identified outside the system, per
  §7.7's own note.
- **No frontend.** Slice 3.

## 10. Every shipped file this slice moves

| File | Change |
|---|---|
| `shifts/shifts.service.ts` | `open` and `close` take a counted amount and write a count in the same transaction; `reopen` demotes the closing count; new `setExplanation` |
| `shifts/shifts.controller.ts` | Two DTOs where there were none; `PUT /:id/explanation` |
| `shifts/dto/` | `OpenShiftDto`, `CloseShiftDto`, `SetExplanationDto` |
| `transfers/transfers.service.ts` | `accept`/`dispute` require an open shift; `accepted_date` from the shift (§4) |
| `transfers/transfers.module.ts` | Gains `ShiftsModule`, which the transfers spec §3 explicitly refused |
| `point-cash/point-cash.service.ts` | Formula re-anchored (§8); row gains `unexplained_difference` |
| `point-cash/point-cash.mapper.ts` | New field |
| `frontend/src/entities/point-cash`, `entities/transfer`, `pages/transfers`, `pages/point-cash` | **Uncommitted** work from the current session; the cash figure and the accept/dispute gating both change |
| `26-rules-by-example.md`, `28-db-schema.dbml` | §11 |
| `docs/superpowers/specs/2026-09-09-yagoda-transfers-cash-slice.md` | §6.4 and §6.6 amended (§11) |

## 11. Divergences and amendments

Four divergences from the schema of record, each amended into the source documents as a dated
addition leaving the superseded text visible — the convention slice 1 used.

### 11.1 §7.7 loses its gate

A discrepancy no longer blocks a close, no longer moves the shift to «Очікує пояснення», and no
longer requires the owner to close it. Client ruling, 2026-09-09. `awaiting_explanation` stays in
the enum, unreachable.

### 11.2 §7.3's closed list gains the baseline count

«Що рухає касу» lists two sources. A point's first count now establishes its starting balance,
which is a third. §7.6's «перерахунок нічого не виправляє і нічого не перетирає» remains true of
every *subsequent* count.

### 11.3 §7.9 and the transfers spec: acceptance requires an open shift

Reverses transfers spec §6.4 and changes §6.2's `accepted_date` source. Both are amended in that
spec with a pointer here, since it is the document an implementer reads.

### 11.4 Reopening mutates a count's `kind`

Not contemplated by the DBML. §6.3 gives the reasoning.

**Also amended:** transfers spec §6.6's go-live ceremony is retired (§3.2), and its §12 follow-up
"the Friday/Saturday question is slice 2's" is answered by §3.3 and §9.1.

## 12. Tests

**Unit (`*.spec.ts`)** — `ShiftsService` and `TransfersService` with mocked repositories:

- `open` writes shift + count atomically; a failing count write rolls back the shift.
- `open` with no previous count sets `expected_amount = counted_amount` (**the §3.2 regression
  test** — get this wrong and every point's first day reports its whole drawer as a surplus).
- `open` after a previous close sets `expected_amount` = that close's `counted_amount`.
- `close` computes `expected` from the opening count plus the shift's movements.
- A discrepancy does **not** block: `close` succeeds and returns `status: 'closed'`, never
  `awaiting_explanation`.
- `reopen` rewrites the closing count's `kind` to `midday` and preserves its other columns.
- `setExplanation` is owner-only; an operator is refused.
- `accept`/`dispute` refuse with `NO_OPEN_SHIFT` when none is open; when one is, `accepted_date`
  equals the **shift's** `business_date`, not today's date (**the §4.2 regression test** — pin it
  with a shift whose `business_date` is deliberately not today).

**Database (`*.db-spec.ts`)** — the formula and the constraints:

- `cash-counts-schema.db-spec.ts` — the partial unique index permits two `midday` rows and
  refuses two `closing` rows on one shift; `expected_amount` is `NOT NULL`.
- `point-cash.db-spec.ts` (extending the existing 17 scenarios): a point with no counts reads
  `0.00` **even when it has accepted transfers**; cash after an opening count equals the count
  plus that shift's movements; cash after a closing count equals the closing count exactly;
  `unexplained_difference` equals `Σ (counted − expected)` across several shifts including an
  explained one (**explaining must not change it** — §6.5).
- A voided transfer accepted *before* a count does not retroactively change that count's frozen
  `expected_amount` (the snapshot's whole purpose).
- **A demoted `midday` count does not become the cash anchor** (§8): reopen a closed shift, then
  read the point's cash — it must still anchor on the shift's `opening` count plus that shift's
  movements, not on the midday row, whose `counted_at` is the newest of the three.

## 13. Follow-ups this slice creates

- **The crates drawer split** (§7) — blocking for the crates slice.
- **A midday recount endpoint** (§6.3) if §7.6's «скільки завгодно разів» is wanted.
- **Late closes bend a transfer's date by one day** (§9.1) — operational, revisit if it bites.
- **`Σ (counted − expected)` has no acknowledgement** other than a shift explanation; a point
  with fifty explained incidents still shows their sum. Correct, but a future screen may want
  "unexplained only" as a separate figure.

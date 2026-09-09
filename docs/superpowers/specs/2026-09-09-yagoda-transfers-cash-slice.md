# Yagoda CRM — Transfers & Point Cash Slice Spec

**Date:** 2026-09-09
**Ticket:** #20 «Shift logic» (milestone «Каса точки і зміна»), **slice 1 of 3**.
**Source:** `26-rules-by-example.md` §7 (the primary text), `28-db-schema.dbml` (the schema of
record), and the decisions taken in the `/grilling` session of 2026-09-09. The foundation spec
(`2026-09-04-yagoda-foundation-slice.md`) §5 data conventions bind this slice in full, and the
documents spec (`2026-09-08-yagoda-intakes-payouts-slice.md`) supplies the patterns this one
copies: one formula with one home, a `void_*` trio rather than a status, and server-derived
dates with no backdating path.

**Position in the schema:** `28-db-schema.dbml` describes 17 tables, 12 of which are built. This
slice implements **one** — `transfers` — and adds one computed read module that owns no table.
After it, four remain: `crate_issuances`, `crate_returns`, `crate_return_allocations`,
`cash_counts`.

**Position in the ticket.** Ticket #20 asks for three things: money moving from the base to a
point with the discrepancy recorded, a shift that opens with a cash count, and a shift that
closes with an auto-calculated expectation and a second count. Those are two tables. They are
split because the closing count's central number — «скільки має бути в шухляді» — is meaningless
until accepted transfers exist to add to it. This slice builds the money movement and the
formula; **slice 2** builds `cash_counts`, the shift open/close ceremony,
`awaiting_explanation`, and the owner's explanation. **Slice 3** is the frontend for both.

**Four rulings from the client on 2026-09-09 override the written rules**, and §9 records each
one as a dated amendment to the source documents rather than as a silent divergence in code.

---

## 1. Goal

Give a collection point's drawer a number the system can defend.

Twelve tables in, this database can say what a supplier is owed but not what is in the till.
§7.3 closes the list of what moves a point's cash to exactly two things — payouts out, accepted
transfers in — and payouts have existed since the documents slice. This slice builds the other
half, and with it the first figure the owner asks for every evening: **how much money is at each
point, and how much does the network still owe it.**

## 2. Scope

**In:**

- `transfers` — its own module, its own table, five verbs: create, accept, dispute, resolve,
  void.
- `point-cash` — a small module owning the berry cash formula and nothing else, in the shape
  `supplier-balance` established (§6.7 of the documents spec). No table, no cache, no stored
  balance.
- Amendments to `26-rules-by-example.md` and `28-db-schema.dbml` recording the four client
  rulings (§9).

**Out, and named rather than forgotten:**

- **`cash_counts` and the whole counting ceremony.** No `opening`/`midday`/`closing` record, no
  `expected_amount` snapshot, no discrepancy against a counted figure. Slice 2.
- **`awaiting_explanation`.** The enum value exists — the documents slice created it — and stays
  unreachable for one more slice. `ShiftsService.close` is not touched by this slice at all.
- **The crates cash book.** `cash_book = 'crates'` has no source tables (`crate_issuances`,
  `crate_returns`) and therefore no formula. Ticket #20 excludes it in as many words: «це
  стосується лише каси за ягоди, і не стосується каси за ящики».
- **Crate accounting of any kind.** `transfers.crates` is stored and returned; nothing consumes
  it. See §6.8.
- **The frontend.** Slice 3.
- **`AppConfig.cashBookFrom`.** Not introduced. See §6.6.

## 3. Module boundaries

Two new modules. Neither touches a table it does not own.

```
src/transfers/
  transfer.entity.ts
  transfer-status.enum.ts
  transfers.controller.ts
  transfers.service.ts
  transfer.mapper.ts
  dto/create-transfer.dto.ts
  dto/dispute-transfer.dto.ts
  dto/resolve-transfer.dto.ts
  dto/void-transfer.dto.ts
  dto/list-transfers.query.ts

src/point-cash/
  point-cash.service.ts        <- THE FORMULA, written once
  point-cash.controller.ts
  point-cash.mapper.ts
  dto/list-point-cash.query.ts
```

`PointCashService` reads `transfers`, `payouts` and `shifts` in raw SQL and injects nothing but
`DataSource` — exactly as `SupplierBalanceService` does, and for the same reason its header
gives: a formula that exists in two places is a formula that will disagree with itself.

`TransfersService` injects `CollectionPointsService` (to check the target point is real and
active), `AuditService` and `TimeService`. It does **not** inject `ShiftsService` — see §6.4.

`PointCashService.cashFor()` is the seam slice 2 will call for `expected_amount`. It is exported
from `PointCashModule` so `CashCountsModule` can import it without a circular dependency.

## 4. Routes

| Method | Path | Role | Body |
|---|---|---|---|
| `POST` | `/transfers` | owner | `{ collection_point_id, cash, crates, carrier, correction_of_transfer_id? }` |
| `GET` | `/transfers` | any | query: `collection_point_id?`, `status?`, `from?`, `to?`, `include_voided?`, `page?`, `limit?` |
| `GET` | `/transfers/:id` | any | — |
| `POST` | `/transfers/:id/accept` | operator **at that point** | none |
| `POST` | `/transfers/:id/dispute` | operator **at that point** | `{ reported_cash, reported_crates, dispute_note }` |
| `POST` | `/transfers/:id/resolve` | owner | `{ resolved_cash, resolved_crates }` |
| `POST` | `/transfers/:id/void` | owner | `{ reason }` |
| `GET` | `/point-cash` | any | query: `collection_point_id?`, `as_of?`, `page?`, `limit?` |
| `GET` | `/point-cash/:pointId` | any | query: `as_of?` |

On `GET /transfers`, `from`/`to` filter on **`sent_at`'s local date** — the day the base
dispatched the money — because that is the only date every transfer has; a `sent` transfer has no
`accepted_date` and filtering on it would hide exactly the in-flight rows the owner opens this
list to see. `include_voided` defaults to **false**, matching `GET /intakes`.

`POST /transfers/:id/accept` takes **no body**, and that is a rule rather than an omission:
§7.9 step 3 — «ТОЧКА має рівно дві дії: [Прийняв] [Не сходиться] — поля суми в точки НЕМАЄ».
A point that could type a number on acceptance would have no reason ever to press the second
button, and the dispute record — the only thing that reaches the owner — would never be written.

`GET /point-cash` widens by role rather than splitting into two endpoints, because §7.10 asks
for exactly that: «керівник відкриває той самий екран каси, який бачить приймальник цієї точки,
плюс свої блоки: одна правда для обох, різна повнота».

## 5. Access rules

| Verb | Owner | Operator |
|---|---|---|
| create | ✅ | ❌ |
| accept | ❌ **never** | ✅ own point only |
| dispute | ❌ **never** | ✅ own point only |
| resolve | ✅ | ❌ |
| void | ✅ | ❌ |
| read | ✅ network-wide | ✅ own point only |

The owner's two ❌ are the sharpest rule in this slice and come from §7.9 directly: «Натиснути
"Прийняв" може ТІЛЬКИ точка (§10.3) — керівник не може зробити це за неї.» This inverts the
usual shape, where the owner may do anything an operator may. The reason is §10.3's: a signature
under money must belong to the person who physically counted it, and an owner pressing «Прийняв»
from an office is a signature under money they never touched.

Point scope uses the existing `auth/access/point-scope` helpers — `resolveWritePoint` on create,
`assertOwnsPoint` on accept/dispute, `resolvePointFilter` on both list endpoints. Nothing new is
invented. As everywhere else in this codebase, another point's transfer is a **404**, not a 403.

## 6. Domain rules

### 6.1 The state machine, and why a settled dispute stays `disputed`

```
                    ┌──────────────── owner: void (any state) ───────────────┐
                    │                                                        ▼
  owner: create ──> sent ──┬── point: accept ──> accepted                (void_* set,
                           │                                             status UNCHANGED)
                           └── point: dispute ─> disputed ── owner: resolve ─> disputed
                                                                            (resolved_* set)
```

`transfer_status` has exactly three values and gains none. Resolution is **fields, not a
transition**: after the owner closes a dispute the row still reads `status = 'disputed'`, now
with `resolved_at` set. That is not a modelling accident — the DBML's own formula branches on
`status = 'disputed' AND resolved_at IS NOT NULL`, and §7.7's principle is that «розбіжність у
документі лишається, її не підганяють». A settled dispute is still a dispute that happened, and
flipping it to `accepted` would erase from the record that anything went wrong.

Void is likewise **not** a status. `transfer_status` had a `void` value until it was removed on
03.09.2026 for the reason the enum's own comment gives: §9.3 requires a mandatory *reason*, which
a status cannot carry. The mechanical consequence is stated loudly in three places already and is
restated here because it is the single easiest thing to get wrong in this slice: **a voided
transfer keeps `status = 'accepted'`, so every query about cash must filter `voided_at IS NULL`
itself.**

Accept, dispute, resolve and void are each **one-shot**. A posted document is not re-pressed;
§9.3's correction model (§6.9 below) is the only way back.

### 6.2 A disputed transfer carries `accepted_date` — RULING 1

**The schema contradicts itself here, and this slice resolves it.** The `transfers` Note states
the app invariant as «accepted_* заповнені **рівно** при status = accepted», which would leave a
disputed transfer with `accepted_date = NULL`. But the cash formula in the `cash_counts` Note
filters *every* transfer through `accepted_date <= D` before branching on status — so under the
Note's own invariant, the `disputed` branch is unreachable dead code and a resolved dispute could
never reach the cash book at all.

**Both buttons stamp `accepted_date`, `accepted_at` and `accepted_by_user_id`.** «Прийняв» and
«Не сходиться» record the same physical fact — *the money arrived at this point today* — and
differ only on whether the amount matched. This is §7.9's own reasoning for using the acceptance
day at all: «машина виїхала ввечері, точка порахувала вранці, і гроші не мають лежати в касі за
день, коли їх фізично не було.» The point counted the disputed money on the 5th; it belongs in
the drawer from the 5th.

`accepted_date` is **server-derived** from `TimeService.now().toISODate()` — the local calendar
day in `APP_TIMEZONE`, never a client value. There is no backdating path anywhere in this
codebase and this slice does not open the first one.

### 6.3 An unresolved dispute counts at the point's own figure — RULING 2

§7.9 step 4б currently says the point's reported number «у ЖОДНУ формулу не входять — це
інформація для керівника», and the `transfers` Note repeats it as «у формули не входять ніколи».
**The client overruled this on 2026-09-09**, and §7.9 was the right place to ask: it ends with
«→ **Примітка:** як фіксувати розбіжність — уточнити у замовника системи.» The doc posed the
question, the 03.09.2026 schema note guessed one way, and the client has now answered it the
other way.

The ruling, in the client's words: the money is credited to the drawer **in the amount actually
received**; the shortfall is settled outside the system; the system's job is to make the problem
visible to the owner.

Why this is the better rule, recorded so nobody reverts it: the cash figure answers «скільки має
бути в шухляді». If 140 000 physically arrived, excluding it makes that point's expected cash
wrong by 10 000 **on every count from then on** — the real discrepancy gets buried under a
permanent phantom one. Under the ruling, the drawer figure is right, the network's debt to the
point (§7.10, `target_cash − cash`) is still 10 000 larger because that money genuinely never
arrived, and the 10 000 shows up once, as a documented discrepancy on the document where it
happened.

### 6.4 No open shift is required — RULING 3

> **SUPERSEDED 2026-09-09 by the cash counts slice (`2026-09-09-yagoda-cash-counts-slice.md`
> §4.1).** Accepting a transfer now REQUIRES an open shift, and `accepted_date` comes from that
> shift's `business_date` rather than from the clock. The reasoning below is preserved because it
> is still why `transfers` carries no `shift_id`; only the no-open-shift-required conclusion is
> reversed.

`transfers` is the only money document that carries `collection_point_id` **directly**.
`intakes` and `payouts` deliberately store neither point nor date and learn both from
`shift_id`; this table stores its own point and its own `accepted_date`. That is a design
decision in the schema, not an inconsistency, and this slice honours it: **accepting a transfer
does not require an open shift, and `TransfersService` does not depend on `ShiftsService`.**

The carrier arrives when they arrive. §7.9's own scenario has the point counting in the morning
before the 07:30 shift opens (§1), and requiring a shift would force a point to open its book —
committing that day's business date — merely to sign for a delivery. §7.9 gives the point «рівно
дві дії», not two actions and a precondition.

**Accepted consequence:** a transfer can be accepted on a day with no shift at all, and its money
enters the cash formula on that date regardless. Nothing breaks, because the formula is
date-based rather than shift-based, and the next shift's opening count will correctly expect the
money. It does mean a point's cash can move on a day that has no shift row.

### 6.5 The formula

One SQL expression, one home, `::text` on the way out so no value ever passes through a JS
number. `D` is the as-of date; `tz` is `APP_TIMEZONE`.

```sql
  COALESCE((SELECT SUM(CASE
              WHEN t.status = 'accepted'                             THEN t.cash
              WHEN t.status = 'disputed' AND t.resolved_at IS NOT NULL THEN t.resolved_cash
              WHEN t.status = 'disputed'                             THEN t.reported_cash
            END)
       FROM transfers t
      WHERE t.collection_point_id = <point>
        AND t.voided_at IS NULL              -- NOT a status. See §6.1.
        AND t.accepted_date <= <D>), 0.00)

- COALESCE((SELECT SUM(p.amount)
       FROM payouts p JOIN shifts s ON s.id = p.shift_id
      WHERE s.collection_point_id = <point>
        AND s.business_date <= <D>), 0.00)   -- INCLUDING voided. See below.

+ COALESCE((SELECT SUM(p.amount)
       FROM payouts p JOIN shifts s ON s.id = p.shift_id
      WHERE s.collection_point_id = <point>
        AND p.return_settled_at IS NOT NULL
        AND (p.return_settled_at AT TIME ZONE <tz>)::date <= <D>), 0.00)
```

Four things about it that are load-bearing:

**Voided payouts are counted IN.** This is the exact opposite of the debt formula, which filters
them out, and the same `voided_at` column reads two ways in two queries. §9.3 says why: the money
physically left the drawer, and voiding a payout does not put it back. It returns only when a
human physically returns it, which is what `return_settled_at` stamps. «Інакше сторно стає
способом красти.» A reader who "harmonises" these two queries has opened a theft path.

**Voided transfers are filtered OUT, by row rather than by status.** See §6.1.

**`sent` transfers contribute nothing** and need no explicit filter: their `accepted_date` is
`NULL`, which the `accepted_date <= D` predicate already excludes. §7.9 step 2 — «у стані sent не
рухається НІЧОГО».

**The timezone cast is deliberate.** `return_settled_at` is a `timestamptz` being compared to a
business date; `::date` alone would use the session timezone and misfile a late-evening
settlement by a day. Everything else in the formula is already `date`-typed.

**The fallback is `0.00`, not `0`.** `SUM` over no rows is `NULL`, and `COALESCE(NULL, 0)` renders
as `'0'` — so a brand-new point would read `"0"` where every other figure reads to two places.
The same literal, for the same reason, as `supplier-balance`.

**There is no timestamp in this formula and there cannot be one.** Transfers contribute by
`accepted_date` and payouts by `shifts.business_date`, both `date`-typed. "Cash at 14:00" is not
expressible. This is survivable because slice 2's `expected_amount` is a *snapshot* computed at
the instant of counting: a midday count at 14:00 asks for `D = today` and picks up exactly the
payouts written so far. The module header must say this, because the next reader will try to add
a timestamp.

### 6.6 `point-cash` — the read module

> **SUPERSEDED 2026-09-09 by the cash counts slice §3.2.** The go-live ceremony described here —
> the owner sending each point a transfer for its opening balance — is retired. A point's opening
> balance is now its first cash count. The rest of this section, on why there is no
> `cashBookFrom` setting, still stands.

`cashFor(pointId, asOf?, manager?)` returns the berry cash as a decimal string; `asOf` defaults
to today's local date. The optional `EntityManager` follows `SupplierBalanceService.debtFor` so
slice 2 can compute `expected_amount` inside the transaction that writes the count.

`list(actor, query)` returns one row per visible point:

```ts
{ collection_point_id, name, target_cash: string | null, cash: string,
  shortfall: string | null, latest_transfer: { status, sent_at } | null }
```

An operator's list is their own point; an owner's is the network, narrowable with
`collection_point_id`. `shortfall` is `sub(target_cash, cash)` via `common/money.ts`, and is
`null` — never `0.00` — when the point has no target.

**Points with no `target_cash` DO appear, with `shortfall: null` — RULING 4.** §7.10 says such
points «в таблицю не потрапляють узагалі», and the `collection_points` entity header treats that
nullable target as load-bearing for precisely this rule. But §7.10 was written about the *debt*
table, where a missing target leaves nothing to subtract from. This endpoint is the *cash* screen.
A point's cash is a fact whether or not anyone set a target; only the shortfall is unknowable,
and `null` says "unknown" where `0.00` would assert something false. Hiding the row would blind
the owner to real money. The frontend renders «—», exactly as `target_crates` already gets under
§6.9. The debt-table rule survives where it belongs: no zero appears in the shortfall column.

`latest_transfer` is §7.10's «стан переказу» column — the most recent non-voided transfer by
`sent_at`, or `null`.

**No `AppConfig.cashBookFrom`.** The `cash_counts` Note names it as an application parameter
living in the prototype's `src/lib/types.ts`; nothing by that name exists in this repository. It
is not introduced, because on a fresh installation it excludes rows that do not exist, and it
does not answer the question it appears to answer.

**Day-one balances are entered as an ordinary transfer.** On the day this goes live every point's
computed cash is `0.00` while its drawer holds real money. §7.3 closes the list of what puts cash
into a drawer to exactly one thing — an accepted transfer — so the owner creates one transfer per
point for its opening balance and each operator signs for it. This is the mechanism working as
designed, not a workaround. The only blemish is `carrier`, which is `NOT NULL`; the owner types
something like «Залишок на 09.09.2026». The module header records this so the absence of an
opening-balance concept reads as a decision.

### 6.7 The discrepancy is computed, never stored

`declared − effective`, where `effective` is `resolved_cash ?? reported_cash`, computed in
`transfer.mapper.ts` and returned as `cash_discrepancy` / `crates_discrepancy` (`null` unless
`status = 'disputed'`). Nothing is written to a column.

**The sign is fixed and must not be flipped:** a **positive** discrepancy is a **shortage** —
less arrived than the base declared, `150 000 − 140 000 = 10 000`. A **negative** discrepancy is
a surplus: more arrived than declared. Stated here because the opposite convention is equally
defensible and a later reader with a different instinct would silently invert every screen.

Same reasoning the `cash_counts` Note gives for its own discrepancy: «Розбіжність = counted −
expected і НЕ зберігається; поля вводу для неї немає в жодної ролі (§7.7).» A stored discrepancy
is a second copy of a fact, and there are no thresholds — a hryvnia out is the same kind of event
as 350 out.

Ticket #20 asks for both directions — «фіксувати розбіжність як недостачу, так і фактично більшу
суму» — so the value is signed and a surplus is as ordinary as a shortage. Nothing clamps it.

### 6.8 `crates` is stored and consumed by nothing

`crates`, `reported_crates` and `resolved_crates` are written, validated and returned. No crate
balance is computed anywhere and no `cash_book = 'crates'` figure exists, because
`crate_issuances` and `crate_returns` do not exist.

The transfer document is the record of what the carrier signed for — §7.9: «переказ несе гроші й
порожні ящики однією поїздкою» — and refusing to record 200 crates because we cannot yet *count*
them would make the crates slice begin by re-keying paper.

**Accepted consequence:** after this slice an owner can send 200 crates and a point can accept
them, and no screen anywhere will show that the point now holds 200 more. The number is recorded
and inert until the crates slice.

### 6.9 Void, correction, and the mistaken «Прийняв»

Void is the `void_*` trio with a **mandatory** reason (§9.3), owner-only (§9.4 — «сторнує переказ
тільки керівник; точка сторнувати не може»), and legal in any state including `accepted`.

The operator who presses «Прийняв» on the wrong row, or signs for 150 000 and finds 140 000 an
hour later, has no second button — dispute is the path not taken. The way back is §9.3's standard
move, which the schema built `correction_of_transfer_id` for: **the owner voids with a reason,
the owner creates a correction referencing the voided document, the point accepts the
correction.** Both documents stay readable forever, the correction is in the owner's hands per
§10.2, and no posted document is ever silently rewritten.

The alternative — letting the owner `resolve` an undisputed accept — was rejected: it rewrites a
posted document's effect with no second signature from the point, and it gives `resolved_*` two
different meanings.

**Accepted consequence:** voiding an accepted transfer removes its money from the point's cash
immediately, so between the void and the point accepting the correction the point's expected cash
is short by the full amount. In practice these are a minute apart. If the fix drags on, the
discrepancy is an accurate description of reality: no valid document currently accounts for the
money in the drawer.

`correction_of_transfer_id` must reference a transfer **at the same point**; the service checks
this because a correction pointing across points would silently move money between drawers.

### 6.10 Validation

- `cash >= 0`, `crates >= 0`, and **not both zero** — a document that moves nothing should not
  exist. Same rule for `reported_*` and `resolved_*`.
- **Negatives are refused everywhere.** A transfer that takes money *away* from a point is not in
  §7.3's closed list, and permitting a negative `cash` would be a back door to exactly that.
  This is stricter than `numeric(12,2)` and is enforced by `CHECK` as well as by DTO.
- `carrier` is required and non-blank — §7.9: «без перевізника документ НЕ проводиться», because
  the carrier signs the paper book and is half of a trip's identity (there is no trip number).
  Trimmed via `common/trimmed-name.ts`.
- `dispute_note` is **required and non-blank**. §7.9 has the point writing a number *and* a
  comment, and the comment is the entire reason the document reaches the owner.
- `void_reason` required and non-blank (§9.3).
- All money fields are canonicalised decimal strings via `@CanonicalDecimal()` + `@Matches`,
  exactly as `payouts` does.
- The target point must exist and be **active**. Its `kind` is **not** checked — see §8.3.
- **The active check binds `create` only.** A transfer already in flight to a point deactivated
  since it was sent stays acceptable, resolvable and voidable. The money physically travelled;
  refusing the acceptance would strand it in `sent` forever with no verb able to touch it, and
  §5.6's deactivation is «не видалення» — it stops new business, it does not abandon open
  documents.

### 6.11 Concurrency

Accept, dispute, resolve and void are each a **single conditional `UPDATE`** guarded on the state
they require, with zero affected rows translated to a `409`:

```sql
UPDATE transfers SET ... WHERE id = $1 AND status = 'sent' AND voided_at IS NULL
```

Two operators at one point pressing «Прийняв» on the same delivery is a live race, not a
theoretical one. The foundation follow-ups document already names check-then-act as this
codebase's known sin (`user-admin.service.ts`), and this slice does not add a second instance.

Every verb writes an audit row — `transfer.created`, `.accepted`, `.disputed`, `.resolved`,
`.voided` — carrying `before`/`after` and, where there is one, the reason as `note`.

## 7. Migration

One migration, `1788600000008-YagodaTransfers`, creating the `transfer_status` enum and the
`transfers` table. Nothing else is altered: no existing table changes, no existing enum gains a
value.

`down()` drops both.

Constraints beyond the DBML's column list:

```sql
CHK_transfers_cash_non_negative      "cash" >= 0
CHK_transfers_crates_non_negative    "crates" >= 0
CHK_transfers_not_empty              "cash" > 0 OR "crates" > 0
CHK_transfers_reported_non_negative  ("reported_cash" IS NULL OR "reported_cash" >= 0)
                                 AND ("reported_crates" IS NULL OR "reported_crates" >= 0)
CHK_transfers_resolved_non_negative  ("resolved_cash" IS NULL OR "resolved_cash" >= 0)
                                 AND ("resolved_crates" IS NULL OR "resolved_crates" >= 0)
CHK_transfers_void_trio              num_nulls("voided_at","voided_by_user_id","void_reason") IN (0,3)
CHK_transfers_no_self_correction     "correction_of_transfer_id" <> "id"
```

Indexes as the DBML gives them: `(collection_point_id, accepted_date)` and `(status)`.

**No `CHECK` enforces the `accepted_*` / `reported_*` / `resolved_*` state invariants**, and the
DBML says why in as many words: «CHECK під це не написаний навмисно, бо стан документа міняється
в часі й проміжні комбінації існують». The invariants live in the service's conditional updates.

The migration header must carry, in the style `YagodaSuppliersAndPrices` established, the list of
things a later reader will try to "fix":

1. `transfer_status` has **three** values and must not gain a fourth. `void` was removed on
   03.09.2026 because §9.3 requires a reason a status cannot carry.
2. A voided transfer keeps `status = 'accepted'`. Every cash query filters `voided_at IS NULL`
   itself. This is not a bug.
3. `accepted_*` are filled on **dispute** as well as on accept (§6.2), which contradicts the
   `transfers` Note as originally written. The Note is amended by this slice (§9).
4. There is no `shift_id` and there must not be one. Transfers are point-scoped by design (§6.4).
5. There is no stored balance, no cash-movement table and no opening-balance document. §7.3's
   list is closed and the figure is a formula (§6.5).

## 8. Divergences from `28-db-schema.dbml`

Three, each a decision rather than an oversight. The first two (§8.1, §8.2) are also amended into
the source documents by §9, so for those this section is a summary rather than the record. The
third (§8.3) is **not** amended anywhere: `28-db-schema.dbml` and `26-rules-by-example.md` say
nothing this slice contradicts on `kind` — §7.3's sentence is simply about the sending side, not
the receiving one — so there is nothing to supersede and this section is its only record. A reader
who wants to know why a base-kind point may receive a transfer will find the answer here and
nowhere else.

### 8.1 A disputed transfer carries `accepted_date`

The `transfers` Note's invariant says `accepted_*` are set «рівно при status = accepted». This
slice sets them on dispute too. **What it buys:** the `cash_counts` formula's `disputed` branch
becomes reachable at all; under the Note as written it is dead code. **What it costs:** nothing —
the two Notes could not both be satisfied, and this is the reading that makes the formula the
schema itself specifies actually run. See §6.2.

### 8.2 An unresolved dispute contributes `reported_cash`

The formula gains a third branch. See §6.3. Overrules §7.9 step 4б and the `transfers` Note on
explicit client instruction, answering a question §7.9 itself left open.

### 8.3 `collection_points.kind` is not checked on the transfer target

§7.3 says «Своєї каси в бази немає: переказ зменшує борг перед точкою, а не рухає касу бази»,
which reads at first like a base-kind point cannot receive a transfer. This slice does not check
`kind`, and any active point may receive one.

§7.3's sentence is about the **sending** side: creating a transfer debits no base cash account,
because the network's money comes from outside the system entirely. It says nothing about the
base as a *recipient* — and §4.8 says the warehouse «приймає ягоду, має свої квитанції, свою
колонку і свій рядок у зведенні». A point that takes intakes pays suppliers, payouts drain a
drawer, and §7.3's own closed list makes an accepted transfer the only way to refill one.
Refusing on `kind` would block that point's only cash source, and the failure would surface as an
unexplainable growing shortage rather than as an error. `PointKind` is currently stored and
validated but read by no service in the backend; this slice does not make it the first.

## 9. Amendments to the source documents

Written as the **first commit of the slice**, in the dated-addition style both files already use,
with the superseded text left visible. Nothing is deleted.

§7.9 asked the client a question — «як фіксувати розбіжність — уточнити у замовника системи» —
and the client answered it. Leaving that answer only in code would leave the doc posing a closed
question, and the next reader would "fix" the formula back.

**`26-rules-by-example.md`:**

- §7.9 — a `→ **Примітка (замовник, 09.09.2026 — закриває відкрите запитання §7.9)**` recording
  that money is credited at the amount actually received, that the shortfall is settled outside
  the system, and that the system's job is to make it visible. Notes that this supersedes step
  4б's «у ЖОДНУ формулу не входять».
- §7.9 — a second note recording that both point actions stamp the acceptance day (§6.2).
- §7.10 — a note recording that a point with no `target_cash` appears on the **cash** screen with
  «—» in the shortfall column, while the debt column still shows no zero row (§6.6).

**`28-db-schema.dbml`:**

- `cash_counts` Note — the formula gains its third branch and the timezone cast.
- `transfers` Note — the `accepted_*` invariant is corrected; the `reported_*` sentence «у формули
  не входять ніколи» is superseded with a pointer to the 09.09.2026 ruling.

## 10. What this slice deliberately cannot do

- **Count a drawer.** No `cash_counts`, so nothing compares the formula against physical money.
  The formula's output is unverified by construction until slice 2.
- **Block a shift close.** `awaiting_explanation` stays unreachable and `ShiftsService` is
  untouched.
- **Say anything about crates.** Recorded, inert (§6.8).
- **Say anything about the crates cash book.** No source tables.
- **Show a point its own cash in a browser.** Backend only.
- **Answer "cash at 14:00".** Not expressible (§6.5).

## 11. Tests

**Unit (`*.spec.ts`)** — `TransfersService` with mocked repositories, in the style of
`shifts.service.spec.ts`:

- create: owner only; operator refused; unknown/inactive point refused; both-zero refused;
  negative refused; blank carrier refused; correction across points refused.
- accept: operator at that point only; **owner refused** (the inverted rule of §5); another
  point's transfer is a 404; accepting a `sent` transfer stamps all three `accepted_*`; accepting
  an already-accepted or voided transfer is a 409.
- dispute: stamps `accepted_*` **and** `reported_*` (§6.2 — the regression test for the whole
  ruling); blank note refused; disputing an accepted transfer is a 409.
- resolve: owner only; status stays `disputed`; resolving a non-disputed transfer is a 409;
  resolving twice is a 409.
- void: owner only; reason mandatory; legal on an accepted transfer; status unchanged.
- mapper: `cash_discrepancy` sign both directions, `null` when not disputed.

**Database (`*.db-spec.ts`)** against real Postgres, in the style of
`supplier-balance-list.db-spec.ts` — **the formula cannot be unit-tested and must be exercised
here:**

- `transfers-schema.db-spec.ts` — every `CHECK` rejects what it should, both indexes exist, the
  enum has exactly three values.
- `point-cash.db-spec.ts` — one scenario per formula branch, each asserted as an exact string:
  1. accepted transfer adds `cash`
  2. `sent` transfer adds nothing
  3. **voided accepted transfer adds nothing** (the `voided_at IS NULL` row)
  4. **unresolved dispute adds `reported_cash`** (ruling 2)
  5. resolved dispute adds `resolved_cash`, not `reported_cash`
  6. payout subtracts
  7. **voided payout still subtracts** (the asymmetry with the debt formula)
  8. voided payout with `return_settled_at` nets to zero
  9. `as_of` excludes a later `accepted_date` and a later `business_date`
  10. a point with no rows reads `"0.00"`, not `"0"`
  11. a settlement at 23:30 local lands on that local day, not the next (the timezone cast)
  12. `shortfall` is `null` for a point with no `target_cash`, and that point still appears

**Also:** add `src/point-cash/**/*.ts` and `src/transfers/**/*.ts` to the money-arithmetic
`files` list in `backend/eslint.config.mjs`. `shortfall` is the first subtraction outside the
four modules currently covered, and the rule is what keeps it going through `common/money.ts`.

## 12. Follow-ups this slice creates or unblocks

**Unblocks:**

- **Slice 2 (`cash_counts`)** — `PointCashService.cashFor()` is the seam it calls for
  `expected_amount`.
- **The `crates` cash book**, once `crate_issuances`/`crate_returns` exist. `book` becomes a
  parameter of `cashFor` rather than a new formula.

**Creates:**

- **The Friday/Saturday question, deferred to slice 2's grilling and recorded here so it is not
  discovered late.** `ShiftsService.close` deliberately does not read `business_date`, so
  Friday's forgotten shift can be closed on Saturday morning. A closing count taken on Saturday
  covers a drawer whose physical contents include Saturday's arrivals. `D = Friday` excludes them
  from expected while they sit in the counted cash — a false surplus. `D = Saturday` includes
  Saturday's payouts, which belong to a shift nobody has opened. `cashFor`'s optional `asOf`
  exists so slice 2 can express either answer; this slice does not choose.
- **Go-live requires a ceremony.** One transfer per point for its opening balance, each accepted
  by its operator (§6.6). Worth a line in the deployment notes when the crates book lands, since
  crates will need the same.
- **`PointKind` is still read by nothing.** §8.3 declines to make this slice the first. If a
  later slice does branch on it, §7.3 versus §4.8 has to be settled with the client first.

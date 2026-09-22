# Supplier card: the history explains itself, and the balance is read, not rebuilt

**Tickets:** #148 (card vs mock), #103 (balance without a breakdown)
**Programme slice:** 6 «Постачальники» and the card — `docs/superpowers/specs/2026-09-17-yagoda-mock-parity-programme.md` §5.6
**Date:** 2026-09-22

## 1. The complaint, in the client's words

> Є вимога аби приймальник міг явно бачити коли зʼявився борг і що конкретно
> здавала людина, щоб апелювати цим у разі конфліктної ситуації. В цілому ми
> можемо зараз проглянути це інфо заглядаючи у кожну квитанцію але в мокапі
> достатньо зайти на постачальника і одразу розгорнуто видно, що коли і скільки.

The card is where an argument with a supplier is settled. Today settling one
means opening receipts one at a time.

## 2. Why the screen cannot do it today

**`GET /intakes` returns headers only.** `frontend/src/entities/intake/model/intake.ts`
says so in its first line — «header only — `GET /intakes` never nests items». The row
carries `amount`, `net_kg`, `lines_count`, `supplier_name`, `paid_amount`. What the
person actually handed over — grade, gross, tare, price, bonus — lives on
`IntakeItemResponse`, and that is reachable only through `GET /intakes/:id`. The extra
click is not a layout mistake; it is the only place the data exists.

**`GET /suppliers/:id/balance` returns `{ supplier_id, debt }` and nothing else.** The
card therefore reconstructs the explanation from three separate reads (`/intakes`,
`/payouts`, `/intake-top-ups`), each capped at `limit: 100`. Two consequences, both
already visible: a supplier with a long season has a truncated timeline that can no
longer explain the balance, and the client re-derives on screen what the server just
computed, free to drift from it.

That second failure is wider than the timeline. The card's tiles («Здач за сезон»,
«Ягоди здано», «Нараховано») total the *loaded* documents, so for any supplier past
100 documents they are simply wrong — and nothing on screen says so.

## 3. Decisions taken before this design

**D-1 stays closed (owner's decision, 2026-09-22).** The mock shows «у залишок {сума}»
under each receipt and an «Відкриті залишки — за що саме винні» panel. Both require
knowing which payout closed which receipt. This system deliberately does not keep that:
debt is the difference of three histories (`Σ intakes + Σ top-ups − Σ payouts`), and no
allocation table exists. Porting it by approximation would mislead exactly the reader it
is meant to arm. Excluded; #101's «найстаріший залишок» stays blocked on the same fork.

**A multi-line receipt shows its lines beneath its row, always (owner's decision,
2026-09-22).** In the mock one reception is one berry at one price, so its row fits two
sub-lines. Here a receipt has `lines_count` items, each with its own grade, tare and
price. Collapsing them behind a disclosure would reintroduce the click the ticket is
about; splitting the timeline one-row-per-line would break «receipt = document» —
the document's amount would have no row of its own, and a void would have nowhere to
show. For the common single-line receipt the result is byte-for-byte the mock's row.

## 4. Two backend reads

### 4.1 `GET /intakes?expand=items`

Items nest into each list row **only** when the flag is set. The default response shape
does not change: the day feed, reception and the dashboard all read this endpoint and
none of them wants items, so the heavier payload must be opt-in.

The word `expand` is not invented here — the programme's shared-reads register (§6)
already names this read `expand=items`, built in slice 5.8 «Журнал» and consumed by
5.6's history rows. Building it here means #102's journal reuses it rather than growing
a second query for the same numbers, which is the register's stated rule.

Each item carries the display names of its product and grade, denormalised onto the
response the way `supplier_name` already rides on the intake header. Without them the
card can only render a `product_grade_id`.

### 4.2 `GET /suppliers/:id/balance` gains a breakdown

`supplier-balance.service.ts`'s `debtSql()` is already three `COALESCE(SELECT SUM(...))`
terms — receipts, top-ups, payouts — with four `voided_at IS NULL` filters across them.
The breakdown is that expression **decomposed, not restated**: the three sums are
returned individually alongside the total they add up to. Because they are the same
SQL, `intakes_total + top_ups_total − payouts_total = debt` cannot drift; a second
formula written next to the first could.

The response gains:

| Field | Meaning |
|---|---|
| `intakes_total` | Σ live receipts |
| `top_ups_total` | Σ live top-ups whose parent receipt is live |
| `payouts_total` | Σ live payouts |
| `intakes_count` | how many live receipts |
| `kg_total` | Σ `net_kg` over live receipts |
| `last_intake_date` | business date of the most recent live receipt, `null` if none |

The last three are not padding: they are what the card's three tiles must stop
computing from a truncated page. They also serve slice 5.7's per-row «N здач» and
5.12's top-suppliers table when those arrive on `/supplier-balances`, which is why they
belong on the balance read rather than in a separate summary endpoint.

## 5. The card

**Tiles become read facts.** «Здач за сезон» ← `intakes_count`, «Ягоди здано» ←
`kg_total`, «Нараховано» ← `intakes_total`, «Залишок за нами» ← `debt`, with the
breakdown spelled out beneath it as `{intakes} + {top-ups} − {payouts}`. None of them is
summed from loaded rows any more, so none of them lies past 100 documents.

**Receipt rows explain themselves.** Date, time, code, amount, receipt icon — and
beneath, per item, two lines: «{товар} «{сорт}» · {кг}» and «{брутто} брутто −
{тара} тара · {ціна+надбавка} ₴/кг». `ціна+надбавка` is added through
`shared/lib/money`; the eslint rule in the money modules bans bare arithmetic, and this
is money.

Clicking the row still opens the receipt sheet — but now to print it, not to find out
what is in it.

**Payouts, top-ups, voided rows, and the void/top-up actions are unchanged.** The
timeline keeps `limit: 100` per source and keeps its honest truncation note. What
changes is that a truncated *list* no longer drags lying *tiles* along with it.

## 6. Out of scope

- D-1: per-receipt «у залишок», «Відкриті залишки», «найстаріший залишок» (§3).
- The suppliers **list** (eyebrow, «Тільки з залишком» toggle, balance total) — the
  other half of programme slice 6. #148 names the card.
- `village` on `suppliers` (§5.6 [B]) — nothing on the card needs it.
- The journal's own line-level screen (#102). This slice builds the read it will use.

## 7. Testing

**Backend.** Unit specs for each term of the breakdown separately — a voided receipt
neutralises its own top-ups; a voided payout stops closing debt; a supplier with no
documents reads `'0.00'`, not `'0'`. A db-spec asserting
`intakes_total + top_ups_total − payouts_total === debt` over the *same* fixture, so the
decomposition can never silently diverge from the total. For `expand=items`: the nested
shape, and — separately — that a request **without** the flag returns exactly the shape
it returns today.

**Frontend.** Lines are on screen without any click; tiles read from the breakdown and
not from the loaded rows (pinned by a fixture where the two would differ); a voided
receipt still renders struck through with its reason; the truncation note survives.

## 8. Risks

**Payload weight.** 100 receipts × their items is a much larger response than 100
headers. `expand` is opt-in for that reason. If the card proves heavy, the page size
shrinks — the response shape does not change.

**A new query flag is a new convention.** `expand` does not exist anywhere in this
backend yet. It is taken from the programme register so the journal inherits it; it
should not be spelled differently in a second place later.

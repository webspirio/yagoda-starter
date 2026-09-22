# Yagoda CRM — Reweigh Screen Design (§8.1–§8.2, frontend)

**Date:** 2026-09-21
**Slice:** the owner's weighing screen at the base, `/reweigh`
**Backend it stands on:** `backend/src/reweighs/` (2026-09-17 reweigh & cost-of-day slice)
**Reference:** `.reference/yagoda-crm/src/pages/ReweighPage.tsx`

## 1. Goal

Build the `Переважування` screen in `frontend/` as closely as the mock allows on top of
the reweigh API that already exists — the owner stands at the scale, types a pallet's
gross weight, watches the чиста вага fall out of it, and sees the недостача against what
the point claims to have sent, before the truck is unloaded.

The mock is a demo CRM with no server: its state is zustand, its documents are objects in
`localStorage`, and it invented a document shape this backend does not have. This spec
records, decision by decision, where the screen follows the mock verbatim and where the
mock's shape had to be re-cut against §8 as it was actually built.

## 2. What already exists

`backend/src/reweighs/`, owner-only across the whole surface (§3.10):

| Route | What it does |
|---|---|
| `GET /shifts/:shiftId/reweigh` | reconciliation — `products[]` (`intake_net_kg`, `reweigh_net_kg`, `state`, `missing_kg`, `missing_amount`), `items[]` (non-voided lines, newest first), `accepted_anything`, `closed_at` |
| `POST /shifts/:shiftId/reweigh-items` | one weighing. Header created lazily per shift. Refuses `NOTHING_ACCEPTED`, `GRADE_NOT_ACCEPTED`, `TARE_TYPE_UNKNOWN`, `TARE_TYPE_DUPLICATED`, `NET_NOT_POSITIVE` |
| `POST /reweigh-items/:id/void` | storno of one line, reason required, `ALREADY_VOIDED` on a second |

`net_kg = (gross_kg − pallet_kg) − tare_weight_kg`, pallet first, tare snapshotted from the
catalogue. The frontend has `nav.reweigh` in `AppLayout` with no `to:` — the nav item has
been waiting for this route.

## 3. Decisions

**3.1 The mock's document does not exist, and the screen does not pretend it does.**
The mock posts a draft list as ONE `reweigh` document with `status: 'posted' | 'voided'`
and voids the whole thing. This backend writes a line at a time and voids a line at a
time (§8.7 as built), with exactly one header per shift created lazily. The screen keeps
the mock's layout and copy and re-targets the verbs: «Провести переважування» posts the
drafts line by line, «Сторнувати» voids one line.

*Cost accepted:* the post is N requests and is **not atomic**. A rejection on line 3 of 5
leaves lines 1–2 written. The screen states this rather than hiding it (§6.4).

**3.2 The screen is a route-level owner gate, not an in-component one.** The mock checks
`role !== 'owner'` inside the component and renders an explanatory panel. This repo gates
at the router (`RequireAuth` + `RequireRole('network_owner')`, as `/transfers` and
`/journal` do), so an operator never reaches the screen and the panel has no reader.

**3.3 (point, date) is a shift.** The mock's «з пункту» and «ягода за» are two independent
fields over a flat document list. Here they resolve to one `shifts` row (UQ point+date),
and that row's id is the only thing every reweigh call takes. No shift for the pair means
no screen state at all — not an empty one (§6.1).

**3.4 The picker's grades come from the server, via `grades[]` on the reconciliation.**
The mock filters its own berry catalogue by «what this point accepted that day». Here the
API enforces that (`GRADE_NOT_ACCEPTED`) and the picker must promise exactly what the API
enforces, from the same query. `gradeTotals()` already computes one row per accepted grade
and discards the grade identity at the product rollup; `grades[]` stops discarding it.

Rejected: deriving the list from `GET /intakes` + a detail fetch per receipt. It is an N+1
on page load and it reconstructs from documents a fact the server can state.

**3.5 «База» is omitted.** `reweighs` has `shift_id` and nothing else; there is no column
for WHERE the weighing happened and nothing downstream reads one. A selector that looks
recorded and is not is worse than an absent one. `reweighs.at_point_id` goes to the
follow-ups doc as a named, unimplemented contract.

**3.6 Недостача stays `null` while the shift is open, and the screen says why.** §3.9 of
the slice spec: «Один рейс на три пункти» is a mid-day trip by construction, so the
weighing is recorded against an open shift and the CLAIM waits for the close. «Різниця»
and «У грошах» render «—» with a line naming the reason. The mock shows a live number
because it has no shift lifecycle to respect.

**3.7 One source of truth per cell: «Наша» is the server's number, drafts are a separate
line.** The mock sums posted documents AND unposted drafts into one «Наша» figure and
computes «Різниця» from that sum. Here «Різниця» comes from the server and «Наша» would
come half from the server and half from the browser — a column whose two halves were
computed by different code, next to a claim about money.

So: every cell of the звірка table is the server's, and beneath the table one line reads
«Незаписані позиції: +N,NN кг — їх ще не проведено». After «Провести» the line disappears
and the numbers move. The owner sees both quantities; neither is mixed into the other.

**3.8 A voided line stays on screen.** The mock's closing caption — «Сторноване не
рахується, але й не пропадає» — is a promise about evidence, and `items[]` filtering
`voided_at IS NULL` breaks it: the line the owner just voided vanishes on the next
refetch. `?include_voided=true` adds them back to `items[]` with the void trio.
`products[]` never counts a voided line, and that does not change.

**3.9 The bottom table is «по всіх пунктах», assembled client-side.** A fan-out of
`useQueries` over the active reception points for the chosen date — shift per point, then
reconciliation per shift — the same pattern `pages/dashboard`'s `useNetworkToday` uses.
~2×P requests for P points (5 working points today). A day-wide `GET /reweigh-items` is
the right shape at 30 points and is a follow-up, not this slice.

**3.10 Money and weight arithmetic is decimal strings, never `Number`.** The mock computes
in floats (`round2(grossNum - palletNum - tw)`). This repo's client-side twin of
`money.ts` is `shared/lib/money`, and the чиста вага preview goes through `sub` on
strings. It is a PREVIEW: the server recomputes `net_kg` and is authoritative, and the
list after a refetch shows the server's value.

**3.11 Date and point live in the query string.** `?date=&point=`, as `pages/day` and
`pages/point-cash` do. Still page-local — the mock's rule that this screen never moves
anyone else's working day is kept, because there is no global work date to move — and it
survives a reload and pastes into a message.

**3.12 The point picker lists ACTIVE reception points only.** `usePointOptionsQuery`
returns active points; the mock renders a deactivated point with a «закритий» marker. A
past day at a since-deactivated point is therefore unreachable from this screen →
follow-up. The date stepper's upper bound is today (`todayIso`); there is no season-start
constant in this project, so the lower bound is open, unlike the mock's
`config.seasonStart`.

## 4. Structure

```
entities/reweigh/                    # NEW slice
  model/reweigh.ts                   # ReweighItem · ReconciliationProduct ·
                                     # ReconciliationGrade · Reconciliation
  api/useReweigh.ts                  # reweighQueryOptions(shiftId, { includeVoided })
                                     # + useReweighQuery
  api/useReweighMutations.ts         # useAddReweighItemMutation · useVoidReweighItemMutation
  index.ts
entities/user/api/useStaff.ts        # NEW — GET /users, owner-only, for the void trace's author
pages/reweigh/
  api/useDayReweighs.ts              # the all-points fan-out (§3.9)
  model/draft.ts                     # Draft + netOf()
  lib/hints.ts                       # addBlock · grossHint · tareHint — pure, unit-tested
  ui/ReweighPage.tsx
  ui/WeighingForm.tsx                # steps 1-3 + чиста вага + «+ ще позиція»
  ui/DraftLines.tsx                  # «Введені позиції»
  ui/Reconciliation.tsx              # «Звірка з пунктом»
  ui/DayLines.tsx                    # «Проведені переважування за <дата>» + inline void row
  ui/FieldWarning.tsx
  index.ts
```

`queryKeys.reweighs = ['reweighs']` joins `shared/api/queryKeys.ts`; a read appends the
shift id and the `includeVoided` flag so the two variants never share a cache entry.

Route `/reweigh` in `app/router.tsx` under `RequireAuth` + `RequireRole('network_owner')`;
`AppLayout`'s existing `nav.reweigh` item gains `to: '/reweigh'`.

**Why `entities/user/api/useStaff.ts`:** the void trace prints an author name and the only
`GET /users` read today lives in `pages/users/api/users.ts`. A page may not import another
page. The read moves down to the entity layer where both pages can have it.

## 5. Data flow

| Region | Source |
|---|---|
| «з пункту» | `usePointOptionsQuery()` → `kind === 'reception'`, active only |
| the shift | `useShiftOnDateQuery(pointId, date)` |
| «3 · Сорт» | `grades[]` from the reconciliation, grouped by `product_name` |
| «2 · Кількість ящиків» | `useTareTypeOptionsQuery()` |
| «Звірка з пунктом» | `products[]` from the reconciliation |
| «Введені позиції» | page memory — `Draft[]`, no round trip |
| «Проведені …» | `useDayReweighs(date)` — fan-out per point (§3.9), `includeVoided: true` |

```ts
interface Draft {
  key: string;                 // client-side only, never sent
  product_grade_id: string;
  product_grade_name: string;
  product_id: string;
  product_name: string;
  gross_kg: string;            // decimal string
  pallet_kg: string;
  tare: { tare_type_id: string; units: number }[];
  tare_weight_kg: string;      // preview only — the server snapshots its own
  net_kg: string;              // preview only — the server recomputes
}
```

Drafts belong to the (date, point) pair: changing either clears them, with the mock's
toast («Позиції очищено — вони належали іншому дню або пункту»).

## 6. Behaviour

**6.1 No shift for (point, date).** The form, the picker and both buttons are disabled and
the screen reads «Зміну за цей день на цьому пункті не відкривали». This is a state the
mock has no concept of and it precedes every other check.

**6.2 `addBlock` — why «+ ще позиція» is inactive.** The mock's ladder verbatim, with
§6.1's rung added on top:

1. no shift for the pair → «Зміну за цей день на цьому пункті не відкривали»
2. `accepted_anything === false` → «На <пункт> <дата> нічого не приймали. Перевірте пункт і дату»
3. no grade chosen → «Оберіть сорт — без нього позиція в документ не піде»
4. `gross_kg <= 0` → «Введіть вагу з ягодою»
5. `net_kg <= 0` → «Чиста вага виходить нульова: піддон і тара зʼїдають усю вагу з ягодою»

The mock's «Товар … не приймали» rung is gone: the picker is now built from `grades[]`, so
an unaccepted grade is unpickable rather than pickable-then-refused.

**6.3 Field warnings, unchanged from the mock.** `GROSS_SUSPECT_KG = 800` and
`TARE_SUSPECT_UNITS = 120`, with the season's records (701,5 кг, 115 ящиків) quoted in the
copy. Warnings beside the field, never blocks — «керівник біля ваг бачить вагу краще за
нас». Plus the mock's «Тару не додано» hint when `tare === 0 && gross > 0`.

**6.4 Posting.** Sequential `await`s over the drafts, stopping at the first rejection.
Posted drafts are removed, unposted ones stay on screen, and the toast names the line that
failed with the backend's own `code` mapped through `shared/lib/api-error`. On success:
invalidate `queryKeys.reweighs` and the day fan-out, clear the drafts, keep the form's
tare type. The button's helper line states that the lines are written one at a time.

**6.5 Voiding.** The mock's inline row inside the table — a required reason field, a
destructive confirm, a cancel — calling `POST /reweigh-items/:id/void`. The line stays in
the table afterward with «сторновано», the time, the author's name and the reason
(§3.8). `ALREADY_VOIDED` surfaces through `apiErrorToBanner`.

**6.6 The звірка table.** Five columns as the mock (Товар · Пункт · Наша · Різниця · У
грошах), every cell the server's (§3.7).
- `state === 'not_reweighed'` → «не перезважено ⚠» in «Наша», «—» in both right columns,
  the row tinted amber. Never a `0`.
- shift open → «Різниця» and «У грошах» are «—» with a line: «Зміна ще відкрита —
  недостача порахується після закриття».
- totals sum only products whose `missing_kg` is non-null; when none qualify the totals
  row reads «—». The mock's «Товарів без позиції: N» note is kept.
- `accepted_anything === false` → the mock's single-cell «Того дня на <пункт> нічого не
  приймали — порівнювати ні з чим».

**6.7 Copy.** Every Ukrainian string goes into `shared/lib/i18n/locales/uk.json` with an
`en.json` mirror, under `reweigh.*`. The mock's explanatory paragraphs (the «день ягоди»
note, the «Наша» footnote, the storno caption) carry over, edited only where a decision
above made them false.

## 7. Backend deltas

Both inside `reweighs/`, both additive, neither changes an existing response field.

1. **`grades[]` on `GET /shifts/:shiftId/reweigh`** (§3.4) — `{ product_grade_id,
   product_grade_name, product_id, product_name, intake_net_kg, reweigh_net_kg }`,
   one row per grade the shift accepted, ordered as `gradeTotals` returns them.
   `gradeTotals` already produces these rows; the rollup loop keeps them instead of
   dropping them. `product_grade_name` needs `pg.name` added to that query's SELECT.
2. **`?include_voided=true`** (§3.8) — an optional boolean query param; when set, the
   `items` find drops its `voided_at: IsNull()` filter. `products[]` is untouched: a
   voided line is never counted, whatever this flag says.

`reweigh-reconciliation.service.ts` is money code (the `files` array in
`backend/eslint.config.mjs`), so the gate for this change is **`npm run verify:full`**,
not the fast tier.

## 8. Testing

- `pages/reweigh/lib/hints.test.ts` — the `addBlock` ladder in order, both warnings at
  their thresholds and one unit either side, the «Тару не додано» case.
- `pages/reweigh/model/draft.test.ts` — `netOf()` on decimal strings: pallet first, tare
  second, a value that would drift through a float.
- `pages/reweigh/ui/ReweighPage.test.tsx` — the repo's page-test pattern: no shift → the
  §6.1 state; open shift → «—» in both right columns; `not_reweighed` → «не перезважено»
  and never `0`; a draft → the «Незаписані позиції» line and the unchanged «Наша»; post →
  one request per draft in order; a mid-list rejection → the survivors stay.
- Backend: `reweigh-reconciliation.service.spec.ts` gains `grades[]` (one accepted grade
  per product, a product with two grades, a grade with no reweigh line) and the
  `include_voided` pair — the flag adds the voided line to `items[]` and does NOT move any
  `products[]` figure.
- Gate: `npm run verify:full` (money code — §7), verdict line pasted under the claim.

## 9. Out of scope → follow-ups

To `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md`:

- `reweighs.at_point_id` — the «База» selector's missing column (§3.5).
- An atomic batch post (`POST /shifts/:id/reweigh` with `lines[]`) — the mock's true
  document, which would make §3.1's N-request post one transaction.
- A day-wide `GET /reweigh-items?date=` — replaces §3.9's fan-out when the network
  outgrows a handful of points.
- Operator read access to the недостача claimed against their own point (§3.10 of the
  slice spec — the client has not answered it).
- Re-weighing a day at a since-deactivated point (§3.12).
- §8.4's «Собівартість дня» screen, which `GET /shifts/:shiftId/cost-of-day` already
  serves.

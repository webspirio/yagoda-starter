# «Прийомка» parity slice — charter

**Date:** 2026-09-21
**Programme:** `2026-09-17-yagoda-mock-parity-programme.md` §5.3; checklist:
`2026-09-17-yagoda-mock-parity-audit.md` «Audit 1 — Прийомка» (items 1–56).
**Tickets:** #116 (paid amount on the receipt), #117 (surcharge clamp, bounds hidden),
#118 (marker hint, = rules §2.11), #112 (typed receipt number — delivered by PR #131,
which this slice builds on), #53 (price per kg on the receipt).
**Branch:** `feat/reception-parity`, cut from `feat/server-generated-document-codes`
(PR #131, draft) with `origin/main` merged in. PR base is #131's branch; #131 must merge
`main` before either can land (its `backend/CLAUDE.md` and verify-layer conflicts are
resolved here the same way they will have to be there).
**Owner's answers (grilling, 2026-09-21):** the operator works on a **laptop**; the
supplier picker is the mock's searchable dropdown; the receipt number is generated; the
marker must prompt for a surcharge as in the mock; «прийомка — сторінка, яку приймальник
бачить більшу частину часу, тут має бути все максимально доступно».

## 1. What the rules decided before the design started

- **The payout is part of reception.** §2.1 step ⑥ «перевірити суму видачі → Залишок» and
  §3.1 «Разом — одне число». Production split intake and payout into two documents (still
  right as *storage*), but put the payout behind a second dialog on the receipt. This slice
  moves «Видано готівкою» back into the «Прийняти» action and writes both documents in
  **one transaction** on the server. Programme decision D-2 is closed by the rules, not
  by a vote.
- **No allocations.** The correction to §3.3 cancels «яку дату закриває виплата»; §3.4's
  «недоплата осідає на сьогоднішній квитанції» lost its subject. So: no «з дат 12.07…»
  under the balance, no «Враховувати залишок» switch (the previous balance is always part
  of «Разом»), no FIFO preview. Programme D-1 is not a fork for this screen — it is a
  cancelled rule.
- **Ceiling is double** (§3.6): `min(Разом, каса за ягоду)`; reception never stops. Today
  the server enforces only the debt half. Decision taken (owner did not object): the server
  enforces the cash half too, for the payout written with an intake AND for a standalone
  `POST /payouts`; the client pre-fills `min(Разом, каса)` and explains the difference.
- **Bounds are a limit, not a hint** (§2.10, #117): the surcharge field clamps to the
  grade's `max_markup`/`max_discount` on the client; the number is never shown; the
  server's refusal stays as the safety net.
- **Marker** (§2.11, #118): a supplier with `kind = wholesale|farmer` shows the red line
  «Це оптовик. Додайте додаткову ціну.» / «Це фермер. Додайте додаткову ціну.»; base price
  unchanged; the surcharge is NOT pre-filled.
- **Any sum from 0 to «Разом»** (§3.7); «До сотні» disabled below 100 ₴; «Усе в залишок» =
  0. A zero payout writes no payout document (production's existing rule, §8.6).

## 2. Backend — PR 1 (`feat(intakes): pay out at reception`)

1. **`POST /intakes` gains `paid_amount?`** (unsigned decimal string). Inside the existing
   transaction, after the intake insert: compute the supplier's debt including the new
   intake, compute `cashFor(pointId, undefined, manager)`, refuse with
   `PAYOUT_EXCEEDS_DEBT` / `PAYOUT_EXCEEDS_CASH` (400, `details: { ceiling }`) if
   `paid_amount` exceeds either, else insert a `payouts` row numbered `PO` by
   `nextDocumentCode`, `paid_by_user_id = actor`, `intake_id = <the intake>`. The supplier
   row lock that `PayoutsService.create` takes is taken here too, in the same order
   (supplier before shift-scoped counters), so the two paths cannot deadlock each other.
   `paid_amount` absent or `0.00` writes no payout.
2. **`payouts.intake_id uuid NULL`**, FK → `intakes.id` `ON DELETE RESTRICT`, indexed.
   Migration + `28-db-schema.dbml` note: «виплата, видана при прийомці, пам'ятає свою
   квитанцію; це не рознесення боргу (§3.3 скасовано), а підпис «гроші видані за цим
   візитом», щоб чек міг надрукувати «видано»». Voiding an intake does NOT void its payout
   (§3.5's recorded exception: the void is allowed with a warning and the debt may go
   negative); the receipt shows both states.
3. **Cash ceiling on `POST /payouts`** too (same `cashFor` read inside its transaction,
   same error code). `payouts.service.ts`'s «half of §3.6» comment is retired.
4. **`GET /intakes` rows gain** `net_kg` (Σ items), `lines_count`, `supplier_name`
   (`last_name first_name`, present even for a deactivated supplier), `paid_amount` (Σ live
   payouts with this `intake_id`, `'0.00'` when none). The programme's first shared read
   (§6); documented in `backend/CLAUDE.md` as such.
5. **`GET /intakes/:id`** (the receipt) gains `payouts: [{ id, code, amount, voided_at }]`
   for rows linked by `intake_id`, `received_by_name`, and the same three list fields.
   `received_by_name` is the shape programme D-8 will generalise (`<verb>_by_name`); it is
   added here for one response only because the printed receipt cannot say «Приймав: —».
6. **Response of `POST /intakes`** = the detail response above (so the receipt dialog opens
   from it with «Видано готівкою» already present).
7. **Tests:** service specs for the ceiling matrix (debt / cash / both / zero / absent), a
   db-spec proving intake + payout are one transaction (a failing ceiling leaves no
   intake), a race spec for two reception writes on one supplier, migration schema spec,
   mapper spec for the new fields. `npm run verify:full` (migration + money code).

Delivered 2026-09-21 on `feat/reception-parity` (backend PR half). Three spec deviations
recorded: the receipt prints «Нараховано», «Видано готівкою» and «Залишок у цьому пункті»
but NOT «Попередній залишок»/«РАЗОМ» (not derivable without allocations); `net_kg`/`paid_amount`
fall back to `'0.00'` via `COALESCE(SUM(x)::text, '0.00')`; `supplier_name` is `first last`
(matches `displayNameOf` and the frontend's `supplierName`), not the `last_name first_name`
§2.4 wrote.

## 3. Frontend — PR 2 (`feat(reception): the mock's reception, laptop-first`)

Layout: the mock's two columns from 1024 px (form left, right column «Стан точки» +
«Сьогоднішні квитанції»), single column below; the right column is scrollable in its own
box (mock `max-h`). Controls keep the starter's 46 px height; every weight and money field
gets `inputmode="decimal"`; Enter advances in the §2.1 order and submits only when the form
is ready; focus lands on the supplier picker on open and returns there after «Прийняти».

**Header** (audit 1–8): eyebrow `{point} · {longDate}`; «Ціни дня» for both roles; the
no-prices empty state with «Встановити ціни» (owner) or the hint (operator); the owner
keeps the inline point select until the shell slice (programme 5.0) — the scope chip is
not built here.

**1 · Постачальник** (9–17): new `features/pick-supplier` — the mock's combobox (Popover +
Command): trigger «Обрати постачальника» / selected `name · KindBadge`, search «Прізвище
або телефон…», rows `name · KindBadge · phone · amber open balance`, empty «Нікого не
знайшли.», footer «Додати нового постачальника» opening `SupplierFormDialog` lifted into
`features/edit-supplier` (both roles; `POST /suppliers` is `@Auth()`), auto-selecting the
new person. Owner sees two groups «Наша точка» / «Інші точки» (by `collection_point_id`
against the chosen point); the operator's list stays point-scoped (programme R2).
`KindBadge` renders nothing for «Звичайний». Under the trigger: §2.11's red line for
wholesale/farmer. Balance strip «Попередній залишок X» + «додасться в «Разом» нижче»
(no dates). Switching supplier with committed lines clears them with the toast «Позиції
очищено — вони належали попередньому постачальнику». History panel: eyebrow «Історія
здач», link «Картка постачальника», last 3 rows `date · kg · amount` from the list read's
`net_kg` (season totals wait for programme 5.6's summary read), empty «Здач ще не було —
це буде перша.».

**2 · Вага з тарою** (18–28): decimal mask (comma shown, 2 places, digits only); «Піддон»
auto-revealed at ≥ 20 tare units; per-tare-row weight «{w × n} кг» on the right; stepper
floor 0 with the instant client hints («Вкажіть кількість тари — без неї брутто пішло б у
чисту вагу цілком», «Чиста вага виходить нульова…»); the gross > 750 kg and per-crate
sanity hints stay.

**3 · Товар, сорт і ціна дня** (29–31): first line pre-selects the first priced product
and grade; option text `{name} · {price} ₴/кг`; surcharge stepper ±1 clamped to the
grade's bounds, typed value clamped on blur, no bounds text (#117); negative allowed.

**Lines** (32–35): counter «{N} позицій · {kg}» on the «Ще позиція» row; table «Тара» as
unit count, «Ціна» with amber «+N» / «−N»; the draft line no longer blocks the totals —
the preview runs on committed lines and the draft is previewed separately (starter's
current «—» state goes away).

**4 · Розрахунок** (36–42): «Нараховано сьогодні · N позицій»; «Попередній залишок»;
**«РАЗОМ ДО ВИДАЧІ»** as the 34 px mono figure; **«Видано готівкою»** input pre-filled
with `min(Разом, каса за ягоду)` (cash from `GET /point-cash/:id`), chips «Уся сума» /
«До сотні» (disabled < 100) / «Усе в залишок»; clamp note «Більше за РАЗОМ видати не
можна — рахуємо X»; cash note «У касі за ягоду X — більше зараз видати нема з чого.
Різниця лягає в залишок постачальника; касу відновлює переказ від керівника.»; right
panel «Залишок за нами» (amber, «Додасться до залишку постачальника — датою сьогодні») /
«Розраховано повністю» (leaf, «Нічого не зависає на балансі»). Submit «Прийняти {N
позицій ·} {kg} · видати {uah}» with the check icon; success toast «Прийнято {kg} — {uah}»
+ «Залишок за нами: X» / «Розраховано повністю»; server refusals map to the field
(`PAYOUT_EXCEEDS_CASH` → the cash note with the server's ceiling) or the banner.

**Right column** (43–47): «Стан точки» — «Каса точки» with «Відкрити» and tiles «У
шухляді зараз» (`/point-cash/:id`), «Видано за ягоду» (Σ live payouts of the shift),
«Залишків створено» (Σ intake amounts − Σ payouts of the shift), «У шухляді на ранок»
(the opening count when present, else «—»); «Ящики» with «Відкрити» and the compact bar
built from what exists: «у людей» (Σ `outstanding_units`), «з ягодою» (PR #128's
`GET /shifts/:id/crates` when merged; until then the segment is omitted, not faked), «наділ»
(`target_crates`). «Сьогоднішні квитанції»: header tonnage badge, rows `HH:MM ·
{supplier_name} · N позицій · {kg} · amber «залишок X» when unpaid · amount · receipt
icon`, scrollable.

**Receipt** (48–56, #116, #53): title «Квитанція {code} · N позицій»; date with time;
«Приймав: {received_by_name}»; per line «Ціна за кг {price} + {bonus} = {eff} ₴»; rows
«Попередній залишок», «РАЗОМ», «Видано готівкою» (Σ linked payouts, with code), «Залишок за
нами»; voided banner kept. **The «Видати готівкою» button leaves the receipt dialog**: a
payout happens at reception or, for a person who comes without berries, on «Залишки»
(§3.7 «Видати без ягоди»). «Анулювати» stays.

**Kept from the starter:** shift gate («Зміну не відкрито…» + «Відкрити зміну»), per-field
server-error mapping, voided rows, spinner/error states, `RequireAuth` scope rules.

**Not ported:** «Інші точки» group for the operator (R2); bounds text (§2.10); the
balance's «з дат» and the «Враховувати залишок» switch (§3.3 correction); the offline «у
черзі» marker (R3); `village` (schema — programme 5.0/5.6); the mock's «keep the
out-of-range bonus and price without it» behaviour (#117 says clamp).

## 4. Definition of done

- Audit 1 items 1–56 marked in the PR description (`ported` / `deferred → …` / `not
  ported (rule)`); items 57–91 belong to «Ящики» and are untouched.
- Before/after screenshots, owner and operator, seeded data, in both PRs.
- `npm run verify:full` green for PR 1 (migration, money); `npm run verify` for PR 2 plus
  `smoke` if the row runs locally; skips named.
- `frontend/CLAUDE.md` (features/pick-supplier, features/edit-supplier, the reception
  page's new shape, receipt widget) and `backend/CLAUDE.md` (paid-at-reception, the list
  read) updated in the PR that changes them.
- Reviewed by a fresh-context subagent before each PR opens.
- The branch is checked out in the main worktree for the owner's side-by-side review
  (`scripts/compare-with-mock.sh`) before PR 2 leaves draft.

## 5. Audit marks

Audit 1 — «Прийомка» (items 1–56); 57–91 belong to «Ящики» and are untouched here.
One line per number, no folding. Absent numbers (4, 8, 13, 15, 18, 21, 23, 26–29, 32,
44, 47–49, 56 — the audit extract never gives them their own line) are marked
«already at parity (audit)» by default, per the audit's own header note that a gap not
called out was already at parity or was a sub-point of a neighbour.

| # | Mark | Reason |
|---|---|---|
| 1 | not ported (needs-api) | eyebrow reads `{point} · {longDate}`; no `village` on the wire (programme 5.0/5.6) |
| 2 | deferred → programme 5.0 | owner keeps the inline point select; the amber scope chip is the shell slice's job |
| 3 | ported | «Ціни дня» renders for both roles now, not owner-only |
| 4 | already at parity (audit) | — |
| 5 | ported (kept) | shift gate is a starter-only addition, kept per §3 «Kept» |
| 6 | ported | typed «№ квитанції» already gone — delivered by PR #131 (#112), confirmed absent from this screen too |
| 7 | ported | no-prices `EmptyState` gained the owner-only «Встановити ціни» action |
| 8 | already at parity (audit) | — |
| 9 | ported | Popover combobox + owner-only «Наша точка»/«Інші точки» groups (`features/pick-supplier`); operator's cross-point group not ported (R2), `village` stays needs-api |
| 10 | ported | `KindBadge` renders nothing for «Звичайний» |
| 11 | ported | §2.11 hint line shows (`kindHintKey`); the bounds line does not (rule §2.10/#117) |
| 12 | ported | inline «Додати нового постачальника» opens `features/edit-supplier`, both roles; «Село» stays needs-api |
| 13 | already at parity (audit) | — |
| 14 | ported | balance strip «Попередній залишок X» ships without the «з дат» clause (§3.3 correction cancels it) |
| 15 | already at parity (audit) | — |
| 16 | ported | switching supplier with committed lines clears them + toasts |
| 17 | deferred → programme 5.6 | season totals («{N} здач · {kg} · {uah}») wait for the summary read; per-row history (date · kg · amount) ships this slice |
| 18 | already at parity (audit) | — |
| 19 | ported | decimal input mask (comma or dot, 2 places) |
| 20 | ported | «Піддон» auto-reveals at ≥ 20 tare units |
| 21 | already at parity (audit) | — |
| 22 | ported | instant client hints alongside the server-preview errors |
| 23 | already at parity (audit) | — |
| 24 | ported | tare stepper floors at 0, not 1 |
| 25 | ported | per-tare-row weight «{w × n} кг» (`mulInt`) |
| 26 | already at parity (audit) | — |
| 27 | already at parity (audit) | — |
| 28 | already at parity (audit) | — |
| 29 | already at parity (audit) | — |
| 30 | ported | first line pre-selects the first priced product and grade |
| 31 | ported | surcharge clamps to the grade's bounds on step and on blur, bounds never shown — the mock's keep-and-warn behaviour is intentionally not ported (rule #117: clamp instead) |
| 32 | already at parity (audit) | — |
| 33 | ported | line counter «{N} позицій · {kg}» on the «Ще позиція» row |
| 34 | already at parity (audit) | «Ще позиція»'s enable rule (draft must preview clean) predates this slice, untouched by any of its tasks |
| 35 | ported | «Тара» as a unit count, signed amber «+N»/«−N» «Ціна»; «Сорт» already read the grade's short name |
| 36 | ported | «Нараховано сьогодні · N позицій» |
| 37 | not ported (rule §3.3 / D-1) | the previous balance is always part of «Разом» — no «Враховувати залишок» switch, no dates |
| 38 | ported | «РАЗОМ ДО ВИДАЧІ» as the 34px mono figure |
| 39 | ported | «Видано готівкою» written in the same «Прийняти» action, one transaction (§2.1 ⑥/§3.1/§3.6); the FIFO-dates preview is not ported (D-1 cancels the rule it previewed) |
| 40 | ported | submit label «Прийняти {N позицій ·} {kg} · видати {uah}» |
| 41 | ported | success toast reads the remainder/settled state |
| 42 | not ported | no dedicated pre-submit warning toast built this slice — the submit button is disabled instead |
| 43 | ported | «Стан точки»: cash tiles + the crates standing bar (`PointStatePanel`) — no proportion bar (D-3, see deviations below) |
| 44 | already at parity (audit) | — |
| 45 | ported | today-receipts header gained the live tonnage badge |
| 46 | ported | receipt rows read `HH:MM · supplier name · N positions · kg · amber remainder · amount · icon` |
| 47 | already at parity (audit) | — |
| 48 | already at parity (audit) | — |
| 49 | already at parity (audit) | — |
| 50 | ported | receipt «Дата» now shows the business date · time (`formatLongDate(business_date)` · `formatTime(created_at)`), not `created_at`'s own calendar day (PR #137 review — the earlier `formatDateTime(created_at)` read a date that could disagree with the shift just past local midnight) |
| 51 | not ported (needs-api) | no `village` on the wire (programme 5.0/5.6) |
| 52 | ported | per-line «Ціна за кг {price} + {bonus} = {eff} ₴» |
| 53 | ported (partial) | «Видано готівкою» + linked payout codes print (#116); «Попередній залишок»/«РАЗОМ»/«з них на попередні залишки» are not ported — not derivable without allocations (§3.3/§3.4 correction; see the receipt deviation below) |
| 54 | ported | «Приймав: {received_by_name}» |
| 55 | ported (partial) | «Анулювати» and the voided banner are kept; «Видати готівкою» is intentionally removed from the receipt — the payout now happens from reception's own «Прийняти» action (#116) |
| 56 | already at parity (audit) | — |

**Receipt deviation.** The receipt does NOT print «Попередній залишок» or «РАЗОМ» — neither
is derivable without allocations, which the §3.3 correction cancelled. It prints
«Нараховано», «Видано готівкою» and «Залишок у цьому пункті» instead, plus one muted
«виплату {{code}} анульовано» line per voided linked payout.

**Four deviations, recorded:**

1. The receipt prints «Нараховано», «Видано готівкою» and «Залишок у цьому пункті», never
   «Попередній залишок»/«РАЗОМ» — see the receipt deviation above.
2. The settled-state figure prints «0,00 ₴», not the mock's «0 ₴» — consistency with every
   other money figure on the screen, all of which carry two decimals.
3. «Стан точки» has no proportion bar (D-3).
4. «Enter advances in the §2.1 order» (§3's own layout intro, above) was not ported — only
   «submits only when ready» shipped (`ReceptionPage`'s Enter guard). Tab already advances
   through the fields, and a field-advance on Enter would conflict with the supplier
   picker's own Enter (which picks the highlighted row) — final-fix-wave finding M11.

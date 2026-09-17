# Mock parity programme: bringing production up to the mock, one screen at a time

**Date:** 2026-09-17
**Request:** «yagoda.webspirio.com це прод, а мок https://webspirio.github.io/yagoda-crm/ зараз
більш правильний і функціональний. Потрібно повністю відтворити UI на проді» — and, on
delivery: «надійніше переносити кожен екран окремо».
**Reference mock:** `webspirio/yagoda-crm` at `468e184` (2026-09-08; nothing newer on `main`).
**Production at the time of the audit:** `407fc0b` (`/api/health/version`), equal to `origin/main`.
**Companion document:** `2026-09-17-yagoda-mock-parity-audit.md` — the screen-by-screen
divergence list this programme is cut from. It is the checklist every screen slice closes
against.
**Prior art:** `2026-09-08-yagoda-frontend-migration.md` (§0a governing seam, §5.3 one kit),
`2026-09-15-yagoda-mock-ui-catchup.md` (§1 and §5: the five missing screens and the
first audit issues #95–#103).

## 0. What this document is, and is not

This is a **programme** spec: it fixes the rules, the order and the unit of delivery for
reproducing the mock on production. It is NOT the spec of any one screen. Each screen gets
its own short spec (a «charter» here plus whatever its grilling adds), its own plan and its
own PR stack — that is what «переносити кожен екран окремо» means in practice.

## 1. Verified state (2026-09-17)

Sixty full-page screenshots of both apps (owner and operator, every route, 1440 px) and
four read-the-whole-file audits of the source established three things:

1. **The visual identity is already the mock's.** Every CSS token the two apps share is
   hex-identical, the three font faces are the same, and the signature kit (`StatTile`,
   `PageHeader`, `Eyebrow`, `EmptyState`, `Sparkline`, `ShareBar`, `Dot`, print CSS) is a
   1:1 port. Production additionally has a dark palette the mock never had. «Відтворити UI»
   is therefore NOT a restyle.
2. **The gap is content and behaviour, screen by screen.** What the operator sees on
   «Прийомка», «Ящики», «Каса точки», «Каса за день» and what the owner sees on
   «Зведення», «Точки», «Постачальники», «Журнал» differs in panels, tiles, columns,
   dialogs and hints — over three hundred items, catalogued in the companion audit.
3. **About half of that gap is not a frontend problem.** The audit tags every item:
   - **[A] frontend-only** — the data is already on the wire (or the change is copy/layout);
   - **[B] needs a backend read** — the tables exist, the aggregation or field does not
     (above all: kilograms are on no list response, so no tonnage anywhere);
   - **[C] domain fork** — the mock embodies a rule the backend deliberately decided
     otherwise, or a table that does not exist (payout allocations, cash paid at reception,
     crate shipments, dated prices, network-wide markup bounds, midday counts, the base
     subsystem).

Nothing is dropped by this classification. It decides *who* closes an item (frontend
slice, backend read, owner decision) and *when*.

## 2. Governing rules

These extend §0a of the 2026-09-08 migration spec and bind every screen slice.

**R1 — Structure is the starter's, UI is the mock's.** Unchanged. FSD layers, per-slice
hooks, `httpClient`/`ApiError`, `RequireAuth`/`RequireRole`, i18n keys, tests. The mock's
`store.ts`/`calc.ts` engine is never ported to the client; the server stays the authority
on every number (§2 of the migration spec, money rules in `backend/src/common/money.ts`).

**R2 — Where the mock contradicts a recorded rule or a client ticket, the rule wins.**
The mock predates several decisions. Known conflicts, resolved here once:
- Surcharge bounds are **not shown** to the operator («Число межі приймальнику не
  показують», `26-rules-by-example.md` §2.10, ticket #117) — the mock prints «межі
  керівника: −30 … +30» under the stepper; production will not.
- Out-of-range surcharge is **clamped to the bound on the client** (#117), not «kept and
  priced without bonus» as the mock does; the server's refusal stays as the safety net the
  operator should never reach.
- Crate documents may be voided by the **operator at their own point while the shift is
  open** (client instruction 2026-09-15, recorded in `CLAUDE.md`); the mock's owner-only
  gate is not copied.
- The typed «№ квитанції» on reception is **removed** (#112); production generates codes.
- The operator's supplier list stays **point-scoped** (§3.9); the mock's «Інші точки»
  group is not ported for the operator.
- `grade_prices` keeps **no `business_date`** unless the owner reverses the 2026-09-07
  decision (#104). Everything time-scoped on «Ціни дня» waits for that decision.

**R3 — Demo scaffolding is never ported.** `DemoPanel`, «Скинути демо-дані», the sign-in
page's demo-accounts card and disclaimer, `SyncPill` («Дані збережено»), the «Що це
замінює» card, the «<N> мс» perf badge, the «Записів про ціни в базі: N» footnote, the
«✓ звірено з Довідником» marker.

**R4 — A screen slice never waits on a domain decision.** Its first PR ships every [A]
item and every [B] item whose read it builds; [C] items are listed in the charter as
«waits for decision D-n». When the decision lands, the same screen gets a v2 slice. This
is what keeps «кожен екран окремо» reliable: no slice blocks on an owner meeting.

**R5 — Shared reads are built by the first screen that needs them, in that screen's
slice, and documented in `backend/CLAUDE.md` so later screens consume rather than
re-derive.** The list is in §6.

**R6 — Definition of done for a screen slice.** (a) The screen's section of the audit is
walked line by line and each item is marked `ported` / `deferred → D-n` / `not ported
(R2/R3, reason)`; the marked list is the PR description. (b) A before/after screenshot
pair for both roles, on the seeded dataset, is attached to the PR. (c) Tests per the
starter's conventions (interaction tests for wired behaviour, render + axe for
presentational parts). (d) `frontend/CLAUDE.md` (and `backend/CLAUDE.md` for a new read)
updated in the same PR. (e) Review by a fresh-context subagent before the PR opens.

## 3. Unit of delivery

One screen = one slice = `docs/superpowers/specs/<date>-<screen>-parity.md` (short: the
charter below plus grilling outcomes) → `writing-plans` → its own branch → one stacked PR
(or a short stack when the backend read is separable and reviewable on its own). Branches
cut from `main`; while an earlier slice is unmerged, the next slice stacks on it and the
stack is linked with `gh stack` per the repo's practice.

Slice size target: one screen's frontend plus at most one new backend read. If a charter
needs more than that, it is split (frontend PR, read PR) rather than grown.

## 4. Order, and why

The order is derived, not chosen by taste, from four heuristics the migration literature
agrees on and this repo already practises:

1. **Shell first, then one route at a time** — design-system migrations put the app inside
   the new shell before touching pages, so every page inherits scope, date and navigation
   instead of carrying its own.
2. **Follow the user's critical path** — sequence vertical slices by the workflow they
   serve. Here the workflow is literally written down: `26-rules-by-example.md` Part 1,
   «Один торговий день від початку до кінця»: 07:10 prices → 07:30 open shift → 08:00–18:00
   reception, crates, transfer → 18:30 truck → 20:40 crates end of day → 20:50 cash end of
   day → 20:55 close shift.
3. **First slices: high use, low complexity, low blast radius** — «start with the easiest
   slice, not the most important one». That puts «Ціни дня» and «Каса точки» (mostly [A])
   before «Прийомка» (the most important screen, and the one carrying the hardest fork).
4. **Dependencies and open tickets** — the operator screens carry every client ticket
   filed this week (#110, #112–#118); the owner screens mostly wait on the aggregation
   reads (§6), which the operator slices start building.

| # | Slice | Kind | Tickets it touches |
|---|---|---|---|
| 0 | Shell and cross-cutting | frontend | — |
| 1 | «Ціни дня» | frontend | — |
| 2 | «Каса точки» | frontend + read (crate units) | #113, #114, #55 |
| 3 | «Прийомка» | frontend + read (`net_kg`, receiver name) | #112, #116, #117, #118, #53 |
| 4 | «Ящики» | frontend | #110 (fork), #115 |
| 5 | «Каса за день» | frontend + read (day by grade) | #114, #100 |
| 6 | «Постачальники» and the card | frontend + read (supplier summary) | #103 |
| 7 | «Залишки» | frontend | #101 |
| 8 | «Журнал» | frontend + read (lines on list, totals, CSV) | #102 |
| 9 | «Перекази» | frontend | #74, #76 |
| 10 | «Точки» | frontend + read (season summary) | — |
| 11 | «Тара і сорти» | frontend | — |
| 12 | «Зведення» | frontend + read (season summary) + chart lib | #97 (tile), #99 |
| 13 | Base subsystem: «Переважування», «Собівартість дня», «Середня ціна по мережі», «Аркуш керівника» | new domain | #65, #95, #96, #97, #98 |

Slices 6–11 are independent of each other once §6's reads exist and may be reordered
or parallelised. Slice 13 is a separate programme (three tables, an engine port, its own
brainstorm) and is listed only so the nav's four disabled items have a home.

Sources for the four heuristics: the strangler-fig write-ups by
[Thoughtworks](https://www.thoughtworks.com/en-us/insights/articles/embracing-strangler-fig-pattern-legacy-modernization-part-one)
(first slice = heavily used and not the most complex) and
[Steve Kinney](https://stevekinney.com/courses/enterprise-ui/strangler-fig-introduction)
(«visible business value, a clear owner, a low blast radius»; new work never flows into
the legacy path), [Martin Fowler on mobile apps](https://martinfowler.com/articles/strangler-fig-mobile-apps.html)
(navigation as the point of interception; adapt the new UI to existing APIs before
modernising the backend), and the shell-first sequencing described in the
[design-system migration notes](https://bootcamp.uxdesign.cc/design-systems-migration-adf117bd1912).

## 5. Screen charters

Each charter names what its first slice ports [A], which read it builds [B], which
decisions it waits for [C] (see §7), and what it deliberately does not port. Item numbers
refer to the companion audit.

### 5.0 Shell and cross-cutting
- [A] Global point scope in the top bar: owner `Select` «Усі точки» + active points, footer
  «У реєстрі, ще не відкриті: …»; operator read-only pill «{point}». Replaces the per-page
  `SelectField` on day, reception, crates, point-cash, debts (`?point=` and the localStorage
  memory stay as the storage; the widget moves). Dashboard obeys the scope too.
- [A] Business date + weekday in the top bar; sidebar subtitle «{point} · сезон 2026» for the
  operator; footer «За компʼютером · {name} · увійшов о HH:MM» (client-side timestamp at
  login) with the profile link kept.
- [A] Navigation per role exactly as the mock: «Зведення» owner-only and first in
  «Керівництву»; «Користувачі» stays (starter-only, owner). The four base items stay
  disabled until slice 13.
- [A] Sign-in: wordmark «Ягода», h1 «Вхід», lead paragraph; submit disabled until both
  fields are filled; password cleared on failure. Keep the starter's single error text,
  the eye and the hint.
- [A] `React.lazy` for owner-only routes with a per-route recovery boundary («Не вдалося
  завантажити розділ — перевірте зʼєднання і оновіть сторінку.» / «Оновити») and the
  skeleton fallback; Toaster `top-right richColors closeButton`.
- [A] Money formatting: `uahAuto` (kopecks only when present) as the default for tiles and
  rows, 2-decimal `formatUah` kept where documents demand it; «₴» suffix on prices.
- [B] `village` on `collection_points` (schema + DTO) — needed by the scope options and
  eyebrows; small, done here.
- Not ported (R3): SyncPill, DemoPanel, demo accounts, BerryMark SVG (lucide `Cherry` stays).

### 5.1 «Ціни дня»
- [A] Operator (and owner scoped to one point): the mock's **card view** grouped under
  product eyebrows — big «{n} ₴/кг», lock caption, «Історія за цей день» from the existing
  journal read (one request per card is acceptable at 14 grades).
- [A] Owner sheet: product group header rows with indented grades; «Ціна дня загальна» as
  a click-to-edit cell (hover pencil / «встановити» link) with the «не всюди · {min}» state;
  «{n} ₴» in every cell; role-dependent description; dashed lock banner with icon.
- [A] Set-price dialog copy and titles as the mock; keep the starter's three fields (base,
  markup, discount) and «Історія».
- [C] D-5 (dated prices): «Ціна за 14 днів» sparkline + delta, `PriceDelta` on cells,
  «Зміни протягом дня», date-scoped sheet, author names (needs D-8 names).
- [C] D-4 (network bounds): the «Дод. ціна» note.
- Not ported: DB-count footnote (R3).

### 5.2 «Каса точки»
- [A] «Каса за ящики» from `crate_deposits`, which `GET /point-cash` already returns and the
  frontend type omits; «У шухляді має бути» as the inverted dark block = berry + crates with
  caption «ягода X + ящики Y». Removes the two `PendingSlice` placeholders.
- [A] «Зміна і перерахунок каси» panel: shift status with times, «На ранок порахували» /
  «На кінець дня порахували», discrepancy pill, explanation; the day's counts as
  «Перерахунок о HH:MM ✓ зійшлося / ⚠ не зійшлося» (the whole-history table moves below or
  behind a toggle); **«Відкрити зміну» / «Закрити зміну» on this page** for the operator
  (reuse `features/count-shift`), with the mock's captions and the result view after a
  count («Пораховано / Розбіжність / Зміна закрита. День зійшовся.»), read back from
  `/cash-counts?shift_id=`. This is #113 and #114's home.
- [A] Disputed incoming transfers rendered as the red card (query `status: 'disputed'`,
  unresolved); the «Каса не змінилася» sentence reworded to the starter's 09.09 rule.
- [A] Ledger polish: «на початок дня» row from the opening count where one exists, negative
  cash notice, two-rows footnote, «у касі більше, ніж наділ» hint; owner select limited to
  points with a target (mock) — keep the starter's «show cash regardless» behind it.
- [A] Target dialog: current value in the description, live preview «Не хвататиме до
  наділу», mock copy and toast.
- [B] Deposit-covered crate **units** per point (for «завдатків за N ящиків») — a count on
  the point-cash row next to `crate_deposits`.
- [C] D-6 (midday count) → «Перерахувати касу»; D-8 (names) → «закрив {name}».
- Not ported: target history — «з DD.MM · {setBy}» and «Діє з» (the 03.09.2026 decision:
  a target is a plain column with no history; not reopened here).

### 5.3 «Прийомка»
- [A] Supplier picker as the mock's combobox (`features/pick-supplier`, shared with the
  crate dialogs): search, name + `KindBadge` (nothing for «Звичайний»), open balance,
  «Додати нового постачальника» inline (lift `SupplierFormDialog` into
  `features/edit-supplier`); kind hint «Це оптовик. Додайте додаткову ціну.» **without**
  the bounds line (R2); switching supplier clears committed lines with the toast.
- [A] Form behaviour: decimal masks, pallet auto-reveal at ≥20 tare, per-tare-row weight,
  tare stepper floor 0, first line auto-selects the first priced grade, instant client
  hints, line counter «{N} позицій · {kg}», lines table showing tare COUNT and bonus «+N»,
  pre-submit toasts, submit label «Прийняти {N позицій ·} {kg}».
- [A] «4 · Розрахунок» layout: «Нараховано сьогодні · N позицій», «РАЗОМ ДО ВИДАЧІ» as the
  34 px figure, right panel «Залишок за нами» / «Розраховано повністю» — computed from the
  intake preview and the balance, without the payout input until D-2.
- [A] Header: «Ціни дня» for both roles; the owner's scope chip «Пробиваємо на точці «X» —
  змінити можна в шапці» (scope comes from 5.0); no-prices empty state with the
  «Встановити ціни» action; «№ квитанції» removed (#112).
- [A] Right column: «Стан точки» panel with the two links and the tiles the wire already
  serves («У шухляді зараз», «Видано за ягоду» = Σ payouts of the shift, «Залишків
  створено» = Σ(amount) − Σ(payouts) of the shift); crate mini-bar deferred to D-3.
- [A] Receipt dialog: date with time, «{price} + {bonus} = {eff} ₴», multi-line title;
  «Приймав» via D-8.
- [B] `net_kg` (and `lines_count`) on `GET /intakes` rows — for the today-receipts rows
  «HH:MM · {supplier} · N позицій · {kg} · amount», the header tonnage and the history
  panel totals; `supplier_name` on the row too (inactive people must still render).
  This is the first and most reused read of the programme (#99).
- [B] Surcharge **clamping** (#117): the client clamps the stepper and the typed value to
  the grade's bounds; the server keeps refusing out-of-range as the safety net.
- [C] D-2 (cash at reception): «Видано готівкою» + chips «Уся сума / До сотні / Усе в
  залишок», berry-cash ceiling, «Враховувати залишок» switch, payout rows on the receipt
  (#116), success toast description. D-1 (allocations): «з {dates}» on the balance strip.
- Not ported: «Інші точки» group for the operator (R2), the offline «у черзі» marker (R3).

### 5.4 «Ящики»
- [A] Per-person documents: owner AND operator expandable row → «Документи цієї людини на
  точці» from `/crate-issuances` and `/crate-returns`, with «Сторнувати» through the
  existing `VoidDocumentDialog` kinds and the starter's role rule (R2); this is the
  largest pure-frontend win of the programme and the answer to #115.
- [A] Issue dialog: the shared picker, balance line under the person, radio cards «За
  кошти» / «За розписку» with the «P × N = T» preview (`deposit_price` is on the wire,
  add it to `TareTypeOption`), threshold auto-mode at 50 with the override warning,
  no-crate-type hint before submit, mock toasts.
- [A] Return dialog: holders-only list with counts, balance line, «із N», split rows by
  issue date (join tranches), «Лишиться в неї…».
- [A] Table header «У людей · {N} ящ. · {M} осіб», deposits sum in the total row, mock
  variants and empty copy; «Змінити наділ» button on this page opening the existing
  `target_crates` editor.
- [C] D-3 (shipments and on-hand): the standing bar «Наділ = пустих + у людей + у нас»,
  «Не хватає до наділу», «Відправлення за сьогодні» with «бій», on-hand gating in «Видати»,
  the «Сума по людях … різниця» line; #110 is this decision's ticket. Until then the
  footer note «поки не рахуються» stays, reworded to say what is coming.
- Not ported: allotment history «з {date} · {setBy}». «№ розписки» on a receipt-mode
  issuance is filed as a question for the crates owner, not scheduled.

### 5.5 «Каса за день»
- [A] Two-column body; tiles «Прийнято ягоди» (from 5.3's `net_kg`), «Нараховано», «Вийшло
  з каси», «У залишок» with the mock's hints; the reduced «Звірка каси» ledger (accrued /
  paid / to-debt, dark «Разом вийшло з каси» bar, Excel footnote); feed ascending with the
  count badge, kg per row, amber payout tint, scroll cap; native date input in the stepper
  bounded by the season; «Звіт» print button + print header; owner «усі точки» aggregate
  via the dashboard's fan-out.
- [B] Day summary by grade for «Що приймали» (`GET /intakes/summary?shift_id=…&group_by=grade`,
  kg and amount per grade) — also the seed of the season summary (§6).
- [C] D-1: «Погашено того ж дня», «Погашено за ягоду іншого пункту», «Окремо: видано за
  ягоду попередніх днів», the allocation-based «Залишків створено», «залишок DD.MM» tags.
- Keep (starter-only): shift status badge, «Переоткрити зміну», voided rows. Open/close
  stay here too, mirrored from 5.2, until the owner says otherwise.

### 5.6 «Постачальники» and the card
- [A] List: eyebrow «{n} у списку», row click → card, `KindBadge` semantics, search-miss
  empty copy, «Тільки з залишком» toggle + «Залишок за нами …» total (from
  `/supplier-balances`), paging past 100.
- [A] Card: identity line per the mock (note in «…»), «Хто це» kind picker and the phone
  «Додати» panel (`features/edit-supplier`), history rows «{berry} · {kg}» /
  «{gross} брутто − {tare} тара · {price} ₴/кг» once 5.8's line-level read exists (until
  then the row keeps code + amount + kg from 5.3), top-up rows aligned.
- [B] Supplier summary read: per supplier over a range — `intakes_count`, `kg_total`,
  `amount_total`, `top_product`, `last_intake_date` — feeds the owner table «Здавальники
  за вагою», the operator columns «Здач / Ягоди / Нараховано / Остання здача» and the card
  tile «Ягоди здано». `kind` added to the balance row.
- [B] `village` on `suppliers` (schema + DTO + form field «Село»).
- [C] D-1: «Відкриті залишки — за що саме винні», payout «закрито ягоду за …», the balance
  hint «найстаріший з DD.MM — N днів» (without allocations «oldest open» is undefined, and
  an approximation would mislead).
- Not ported: «Де саме лежить» (one supplier = one point, §3.9), the mock's single
  «Прізвище та імʼя» field (the starter keeps first/last), «Інші точки» for the operator.

### 5.7 «Залишки»
- [A] **Bug first:** the owner's «Усі точки» is swallowed by the warehouse fallback; with
  5.0 the page obeys the global scope and «Усі точки» is the owner's default. Cards with
  the mock's name cell and «Видати без ягоди»; settle dialog: live clamp to the balance,
  disabled submit, mock failure copy; «№ квитанції» removed from the payout dialog too
  (#112 applies to every generated code).
- [B] Tile «Погашено за сезон» (Σ payouts in scope) and the per-row «N здач» from 5.6's
  summary read; `kind` on the balance row for the badge.
- [C] D-1: tile «Найстаріший залишок», the per-row age chip «N днів», «Звідки взявся
  залишок» expand panel, «Що саме закриється» preview, success toast dates.

### 5.8 «Журнал»
- [A] Date range with presets «Сьогодні / 7 днів / {місяць} / Весь сезон» and from–to
  inputs (season start as a config constant until the backend has one); searchable
  supplier filter including inactive; paging «Показати ще»; empty copy; row click on the
  payouts tab too.
- [B] Line-level journal: `GET /intakes?expand=items` (or `/intake-items` with the same
  filters), a `product_grade_id` filter, range totals on the envelope (count, kg, amount),
  and a server-side CSV export with the mock's 17 columns. This is the read 5.6's history
  rows and 5.12's grade breakdowns reuse.
- [C] D-1: «Видано» and «Залишок» per line.
- Keep: point select (now global), «показувати анульовані», tabs «Квитанції | Виплати».

### 5.9 «Перекази»
- [A] Date stepper + «Сьогодні» with the past-day note (`as_of`/`from`/`to` exist);
  «Надіслати» hidden off-today; row set limited to active points with a target, warehouse
  excluded; «стан» derived from documents ≤ date; expandable row with the per-point history
  cards (voided rows via `includeVoided`, correction links via `correction_of_transfer_id`);
  dispute banner per unresolved dispute with «Сторнувати і подати заново» (void + new with
  `correction_of`) next to the starter's «Вирішити»; send dialog prefilled with the
  shortfall, clamp, «Уся заборгованість — X», «Після прийняття» cash preview, mock copy;
  lowercase badge vocabulary; footer paragraphs; «ящиків» in-field part from
  `/crate-balances`.
- [C] D-3: «у нас» crates, the standing formula in the expanded row, crates prefill.
  D-8: «прийняв {name}», «сторнував {by}» — available to the owner today via `GET /users`,
  so this screen may join client-side until D-8 lands.

### 5.10 «Точки»
- [A] Eyebrow «{n} з {N} працюють», per-point cards for active points with «Каса точки →»,
  «Залишки» (Σ balances), «Приймальник» (from `GET /users`), today's count and amount (the
  dashboard's per-point queries), «У реєстрі — ще не відкриті» dashed section; the CRUD
  dialog stays behind an «Редагувати» affordance and «Нова точка»; «Ціль каси» formatted.
- [B] Season summary per point (kg, amount, share, last intake, 14-day kg series) — the
  first consumer of the season summary read that 5.12 fully needs.
- Not ported: «основна» badge (no such concept), village comes from 5.0.

### 5.11 «Тара і сорти»
- [A] Two cards side by side; tare inline edit of weight and deposit with the blur toast
  (dialog stays for name/flags); explanatory notes; «Товар без сортів» block; all products
  visible with grouped grades (the master–detail stays for editing).
- [B] Tare usage «використано N шт за сезон» (aggregate over `intake_item_tare_types`).
- [C] D-4: the «Межі дод. ціни — тільки керівник» card. Grade season windows, «ОПТ» flag on
  grades and the computed «приймаємо / сезон закрито» status are a separate product
  question (the starter models wholesale on the supplier) — filed, not scheduled.

### 5.12 «Зведення»
- Decision first: the mock's «Зведення по сезону» is season analytics with a period
  selector; the starter's «Зведення» is today's operations. Both are wanted; the charter
  proposes **the mock's analytics as the screen and the starter's «Точки сьогодні» block
  kept inside it** (shift badges and the two shortcut buttons are the owner's morning
  check). The operator keeps their shortcut view, reachable from the point pill, not from
  the nav.
- [A] Period chips, point scope, «+N у реєстрі» card, «Найбільші здавальники» with
  `KindBadge`, layout.
- [B] Season summary grouped by day / grade / point / supplier over a range (one read,
  `GET /intakes/summary?from&to&group_by=`), plus per-day payouts; tiles «Прийнято ягоди»,
  «Середня ціна», bars «Прийнято ягоди по днях», «Сорти за тонажем», per-point
  sparklines. A chart library (recharts, as the mock, with the mock's `chart.tsx` ported
  into `shared/ui`) enters the bundle here and only here, lazy-loaded (5.0).
- [C] D-1: the stacked «Скільки виходило з каси» split «за ягоду дня / погашено старих
  залишків» (until then one series); «у т.ч. X старих залишків».
- Not ported: «Що це замінює» (R3).

### 5.13 Base subsystem
«Переважування», «Собівартість дня», «Середня ціна по мережі», «Аркуш керівника». Three
tables (`reweighs` + lines, `day_expenses`, `expense_policies`), an engine port
(`costOfDay`, `networkAverage`, `productDay`, largest-remainder allocation) to the
backend, and `kind = 'base'`'s second half (#96). Own brainstorm, own spec; the
`DocumentPage` template and 5.12's summary read are its inputs. Not part of this
programme's order beyond holding the nav slots.

## 6. Shared backend reads (register)

| Read | Built in | Consumed by |
|---|---|---|
| `village` on `collection_points` | 5.0 | scope options, eyebrows, receipt header |
| Crate deposit units per point | 5.2 | «Каса за ящики» count |
| `net_kg`, `lines_count`, `supplier_name` on `GET /intakes` rows | 5.3 | 5.3 today receipts, 5.5 tiles and feed, 5.6 history, 5.12 |
| Day summary by grade (`/intakes/summary` with `group_by=grade`) | 5.5 | «Що приймали»; 5.12 «Сорти за тонажем» |
| Supplier summary (range, per supplier) + `kind` on balance rows | 5.6 | 5.6 list/card, 5.7 tiles, 5.12 top suppliers |
| `village` on `suppliers` | 5.6 | picker, list, card, debts |
| Line-level journal (`expand=items`), grade filter, range totals, CSV | 5.8 | 5.8, 5.6 history rows |
| Season summary by day/point (+ share, last intake) | 5.10 | 5.10 cards/table, 5.12 charts and tiles |
| Tare usage count | 5.11 | «використано N шт» |
| Display names on documents (D-8) | first screen after the decision | «Приймав», «закрив», «прийняв», «сторнував», price authors |

Shape (one summary route with `group_by`, or several) is decided in the plan of the
first building slice, with the rule that the second consumer must not need a new query
for the same numbers.

## 7. Domain decisions register (D-n)

Each is an owner decision taken on its own grilling session, not inside a screen slice.
Listed with what the mock does, what production decided, who is pushing, and the owning
screen.

- **D-1 Payout allocations (FIFO per receipt).** Mock: every payout settles specific
  receipts, so screens can say «за що саме винні», «ягода 27.06 → гроші 04.08»,
  «Найстаріший залишок». Production: a balance is ONE number (§3, `supplier-balance`).
  Needs a `payout_allocations` table and a FIFO service. Owner: 5.6; also 5.3, 5.5, 5.7,
  5.8, 5.12.
- **D-2 Cash paid at reception.** Mock: «Видано готівкою» is part of «Прийняти», capped by
  the berry cash (§3.6). Production: intake and payout are two documents, the cash half of
  §3.6 is not enforced (`payouts.service.ts`). Client tickets #112 and #116 point toward
  the mock. Owner: 5.3. Candidate shape: one request creating intake + payout atomically,
  or the payout dialog embedded in the reception form.
- **D-3 Crate shipments and on-hand.** Mock: «Відправлення на базу» documents («з ягодою»
  computed, «бій» typed), giving «пустих на точці», «у нас з ягодою», «не хватає до
  наділу». Production: no table; the crates spec deliberately left it out. Ticket #110 is
  a full specification of the desired numbers. Owner: 5.4; also 5.3 mini-bar, 5.9.
- **D-4 Surcharge bounds: network-wide vs per grade-price.** Mock and #117: one pair
  «−30 … +30» for the network. Production: `max_markup`/`max_discount` per grade-price
  row. Owner: 5.11 (the setting), 5.1 (the note), 5.3 (the clamp uses whichever wins).
- **D-5 Dated prices (`business_date`).** Reversal of the 2026-09-07 decision; #104 is
  the ticket. Unlocks the 14-day trend, intraday changes and the date-scoped sheet. Owner:
  5.1.
- **D-6 Midday cash count.** Mock: «Перерахувати касу» any number of times. Production:
  counts are born only from open/close, no `POST /cash-counts`. The schema already allows
  `kind = midday`. Owner: 5.2.
- **D-7 Base subsystem.** See 5.13.
- **D-8 Display names on documents.** Every mock screen prints who did what; production
  responses carry user ids and `GET /users` is owner-only. Cheapest shape: the mapper adds
  `<verb>_by_name` next to each `<verb>_by_user_id`. Small, but it touches nine responses,
  so it is decided once. Owner: 5.3.

## 8. Not ported, ever (unless a ticket says otherwise)

R3's demo scaffolding; the mock's «Інші точки» supplier group for the operator; the mock's
owner-only crate void; the shown surcharge bounds; «основна» point badge; the single
name field for suppliers; the mock's three sign-in error texts; `store.ts` persistence
and offline queue.

## 9. Risks

- **Hybrid state that never completes.** The audit is the tracker: every slice's PR marks
  its lines; an unmarked line is unfinished work, visible to anyone.
- **Charter creep.** A screen slice that wants a second backend read splits; a screen slice
  that wants a domain fork stops and files D-n.
- **Tickets arriving mid-programme.** They attach to a charter (or a D-n) rather than
  becoming their own slice; #110–#118 already did.
- **Screenshot drift.** The seeded dataset is the fixture for before/after pairs; the
  scratch script that produced this audit's sixty screenshots is worth keeping as a dev
  tool if the pairs prove useful in review (decided in slice 0's plan).

## 10. Next step

Owner reviews this document and the companion audit. On approval, slice 0 goes to
`writing-plans`; slices 1–3 are grilled and chartered in order, each on its own branch.

# Mock parity audit: screen-by-screen divergences (companion to the 2026-09-17 programme spec)

**Date:** 2026-09-17 · **Mock:** `webspirio/yagoda-crm@468e184` · **Production:** `407fc0b`

Tags: **[visual]** same data, different rendering · **[ui-logic]** client-side, the API already has the data · **[needs-api]** the API visibly lacks the field or endpoint · **domain** a rule production decided differently (see the programme spec §7).

Each screen slice marks every line of its section `ported` / `deferred → D-n` / `not ported (rule)` in its PR description (programme spec R6). Item numbers are stable; do not renumber.

---

## Audit 1 — Прийомка / Ящики (mock vs starter), 2026-09-17

API facts: Supplier no `village`; `GET /intakes` headers only (no supplier name, kg, items, receiver name); balance = one number; Payout has no allocations, cash ceiling of §3.6 NOT enforced (payouts.service.ts:49-56); `GET /point-cash/:id` → one lifetime `cash`, no berry/crate split, no morning float; `GET /users` owner-only (operator can't resolve names); collection point has no village, `target_crates` plain field (no history); crates: no shipments table, no on-hand; issuance DTO no `receipt_no`; `CrateBalanceRow` has `has_receipt`+`deposit_held` but no per-mode unit split; `GET /suppliers/:id/crate-balance` tranches; journals + `:id/void` exist for issuances/returns; `TareTypeOption` drops `deposit_price` (it IS on the wire).

## Прийомка
- 1 eyebrow "{point} · {village} · {longDate}" — village [needs-api]
- 2 owner scope: mock amber chip "Пробиваємо на точці «X» — змінити можна в шапці" (scope in header); starter inline SelectField «Оберіть точку» [visual]
- 3 «Ціни дня» button for every role (starter owner-only) [ui-logic]
- 5 STARTER-only shift gate (ShiftBanner + open dialog); 6 STARTER-only typed «№ квитанції» (client #112 wants it gone)
- 7 no-prices EmptyState lacks «Встановити ціни» action [visual]
- 9 supplier picker: mock Popover combobox (h-12 «Обрати постачальника», CommandInput «Прізвище або село…», groups «Наша точка»/«Інші точки», item = name + KindBadge + village + amber open balance, footer «Додати нового постачальника»); starter search input + flat list of 30 + chip «Змінити» — [ui-logic] mostly; village/cross-point [needs-api]
- 10 KindBadge renders nothing for `none`; starter prints «Звичайний» [visual]
- 11 kind hint «Це оптовик. Додайте додаткову ціну.» (+ bounds line — but §2.10/#117 say DON'T show bounds) [ui-logic]
- 12 «Додати нового постачальника» inline AddSupplierDialog from picker — POST /suppliers open to both roles [ui-logic]; «Село» [needs-api]
- 14 balance strip «Попередній залишок X · з {dates}» + «додасться в «Разом» нижче» — dates [needs-api]
- 16 switching supplier clears lines + toast [ui-logic]
- 17 history panel: totals «{N} здач · {kg} · {uah}», rows date · berry · kg · amount — [needs-api]
- 19 decimal input mask (comma, 2 dec) [ui-logic]; 20 pallet auto-reveal at ≥20 tare [ui-logic]; 22 instant client hints vs server-preview errors [ui-logic]; 24 tare stepper floor 0 vs 1; 25 per-tare-row weight «{w×n} кг» [ui-logic]
- 30 first line auto-selects first priced berry [ui-logic]
- 31 bonus: bounds per grade in starter (schema of record) vs global; stepper clamps in mock [ui-logic]; out-of-range: mock keeps value + amber note + prices w/o bonus; starter server refuses BONUS_OUT_OF_RANGE — #117 wants CLAMP to bound and NO bounds shown
- 33 line counter «{N} позицій · {kg}» [ui-logic]; 34 «Ще позиція» enable rule / empty draft blocks preview [ui-logic]
- 35 lines table: Тара = unit count (mock) vs kg; Ціна shows «+N» amber; Сорт = berry short [visual]
- 36 «Нараховано сьогодні · N позицій» [visual]
- 37 «Враховувати залишок» switch + dates [needs-api dates]; 38 «РАЗОМ ДО ВИДАЧІ» big mono figure [visual]
- 39 INLINE PAYOUT in the same action: «Видано готівкою» input (default min(total, berryCash)), chips «Уся сума / До сотні / Усе в залишок», FIFO note, right panel «Залишок за нами»/«Розраховано повністю», berry-cash notice; submit disabled when paid > berry cash. Starter: intake only, payout = second document from receipt dialog with its own «№ квитанції». [needs-api: berry-cash figure, intake+payout in one write or paired writes, FIFO dates]
- 40 submit label «Прийняти {N позицій ·} {kg} · видати {uah}» [visual]; 41 success toast description [visual]; 42 pre-submit toasts [ui-logic]
- 43 «Стан точки» panel (right column): «Каса точки» 2×2 tiles (У шухляді на ранок / Видано за ягоду / У шухляді зараз / Залишків створено) + «Ящики» compact standing bar — mostly [needs-api]; «У шухляді зараз» + links [ui-logic]
- 45 today receipts header tonnage [needs-api]; 46 rows: HH:MM · supplier NAME · «N позицій»/berry · kg · «залишок X» · amount · Receipt icon — time [ui-logic], name/kg/debt [needs-api]
- 50 receipt dialog «Дата» with time [ui-logic]; 51 point village; 52 «{price} + {bonus} = {eff} ₴» [visual]; 53 payout rows on sheet (Попередній залишок / РАЗОМ / Видано готівкою / з них на попередні залишки / Залишок за нами) [needs-api] (#116 asks for this!); 54 «Приймав» name [needs-api received_by_name]
- 55 STARTER-only: Анулювати, Видати готівкою, voided banner

## Ящики
- 57 header eyebrow with village + date; owner action «Змінити наділ» (mock) vs SelectField
- 58 AllotmentDialog «Наділ ящиків» (Скільки ящиків / Діє з / Причина; history «з {date} · {setBy}») — button [ui-logic], history [needs-api]
- 61 CrateStandingBar: Наділ N + origin, 3-segment bar, Пустих на точці / У людей / У нас з ягодою, identity «800 = 341 + 195 + 264», «Не хватає до наділу: N (у людей X + у нас Y)», negative warning — [needs-api: no on-hand/at-base, no shipments] (#110 asks for exactly this)
- 63 «Відправлення за сьогодні» ShipmentDialog (з ягодою computed from receipts, «Бій» typed, «Разом відправлено», after-state, shipment list with owner void) + note «Сьогодні вже відправлено N: з ягодою X, бій Y» — [needs-api shipments] (#110)
- 65 card header «У людей · {N} ящ. · {M} осіб» visible [ui-logic]; 66 village under name; 67 «Як брала» «за кошти N · розписка M» per-mode split [needs-api or N+1]; 68 РАЗОМ «із них N за кошти» + deposits sum (Σ deposit_held [ui-logic])
- 71 owner expandable row → PersonCrateDocs (documents per person: видали/прийняли, за кошти·завдаток / за розписку № / віддали завдаток, voided trace, «Сторнувати» → VoidCrateDialog) — all endpoints + VoidDocumentDialog kinds exist [ui-logic]; ROLE: starter lets operator void at own point while shift open (not owner-only) (#115 asks for crate history per supplier!)
- 74 issue dialog person picker = SupplierPicker combobox vs plain select [ui-logic]; 75 balance line under person [ui-logic]; 76 mode radio cards «За кошти»/«За розписку» + «P × N = T» preview (needs deposit_price in TareTypeOption — on wire) [visual/ui-logic]; 77 threshold auto-mode 50 + override warning [ui-logic]; 78 «№ розписки» [needs-api]; 79 on-hand gating [needs-api]; 80 no-crate-type hint before submit [ui-logic]; 81 toasts
- 84 return dialog: holders-only list with counts + empty state [ui-logic]; 85 balance line + «із N» [ui-logic]; 86 split box rows by issue DATE (join tranches issued_at) [ui-logic]; 87 «Лишиться в неї: N · завдатку в нас X» [ui-logic]; 89 crate-cash pre-check «У касі за ящики X» [needs-api crate-book figure — backend f8d9cd9 reports it in point-cash? check]
- 91 starter footer «…поки не рахуються» to remove once 61/63 land

## Top 5
1. Reception §4 inline payout (37–41, 53) — needs API (paid/FIFO/berry-cash)
2. Crates standing + shipments (61, 63, 69, 79, 89) — [needs-api]
3. Per-person crate docs + void (71) — pure [ui-logic], biggest cheap win
4. Supplier picker everywhere (9–12, 74, 84) — mostly [ui-logic]
5. «Стан точки» panel + richer today-receipts (43, 45–46) — mixed

---

## Audit 2 — Каса за день / Каса точки / Ціни дня (mock vs starter), 2026-09-17

Kit note: StatTile/PageHeader/EmptyState/Sparkline/LedgerRow etc. are byte-equivalent ports — tile/heading divergences are CONTENT, not kit. `uah()` 0 dec on tiles + `uahAuto()` (kopecks only when present) vs starter always 2 dec [visual, global].

## Каса за день
- 2 date stepper with native `<input type=date>` + season min [ui-logic]
- 3 owner «Собівартість цього дня» button → cost screen [needs-api screen]
- 4 «Звіт» print + print-only header [ui-logic]
- 5 STARTER-only on-page point picker; mock supports aggregate «усі точки» (fan-out like useNetworkToday) [ui-logic]
- 6/7 STARTER-only shift status badge + Відкрити/Закрити/Переоткрити on this page (mock: open/close live on Каса точки; no reopen anywhere)
- 8 tile «Прийнято ягоди» tonnage + «N квитанцій» hint — needs `net_kg` on intake list row [needs-api]; 9 «Вийшло з каси»/«готівка за день, разом із залишками» vs «Видано» [visual]
- 10 tile «Залишків створено» = debt created today − same-day closures via allocations; starter accrued−paid over shift [needs-api allocations]
- 12 two-column body (Звірка каси | Що приймали + Стрічка дня) [visual]
- 13 «Звірка каси» ledger: Нараховано за ягоду цього дня / └ Видано готівкою одразу / └ Погашено того ж дня / └ Погашено за ягоду іншого пункту / └ Пішло в залишок за нами / drift pill «Розбіжність нульова» — allocation rows [needs-api]; reduced 3-row version [ui-logic]
- 14 «Окремо: видано за ягоду попередніх днів» per origin date «ягода DD.MM → гроші DD.MM» + «Разом залишків погашено» [needs-api allocations]
- 15 dark bar «Разом вийшло з каси» + Excel footnote [visual]
- 16 «Що приймали» per-grade kg·uah bars [needs-api day-by-grade summary or items on list]
- 17 feed count badge [visual]; 18 ascending order [ui-logic]; 19 scroll cap [visual]; 20 intake row time·supplier·kg·amount (kg needs-api); 21 payout row amber tint + «залишок DD.MM» tag (dates needs-api)
- 22/23 STARTER-only voided rows, states
- 24 CountDrawerDialog single dialog for open+close; no result view after saving

## Каса точки
- 25/26 title «Каса точки» + eyebrow «{point} · {longDate}, {weekday}»; description «не хватає до наділу» [visual]
- 27 STARTER-only date stepper; 28 owner select lists only points with a float (mock) [ui-logic]; 29 «Змінити/Призначити наділ каси» + Wallet icon [visual]
- 30 empty states copy incl. «{point}: каси-підзвіту немає» [visual]; 31 «Касову книгу ведемо з {date}» notice [needs-api]
- 32 «Наділ» hint «з DD.MM» [needs-api target history]; 34 «у касі більше, ніж наділ» hint branch missing [ui-logic]
- 35 DISPUTED transfers shown as red card («Заявлено «не сходиться»…») — starter queries only `sent` [ui-logic]; 36 in-transit meta copy [visual]; 37 accept toast copy; 39 dispute dialog: cash PREFILLED (mock) vs blank (starter, documented) + copy
- 41 ledger «на початок дня» row with «наділ X − борг бази Y» hint [needs-api opening-as-of]; 42 split «за сьогоднішню ягоду»/«за ягоду інших днів» by allocation origin (starter by payout business_date) [needs-api]; 43 «погашено сьогоднішній залишок» [needs-api]; 44 STARTER-only «Нараховано сьогодні» + «Повернено в касу»; 45 negative-cash notice + two-rows footnote [visual]; 46 indent/uppercase total [visual]
- 47 «Каса за ящики» card: BACKEND ALREADY RETURNS `crate_deposits` on every /point-cash row (mapper:75,103) — frontend PointCashRow omits it → [ui-logic QUICK WIN]; unit count «за N ящиків» [needs-api per-point deposit units]
- 48 «У шухляді має бути» inverted dark block = berry + crates, caption «ягода X + ящики Y» [ui-logic once 47]
- 49 shift-of-day summary box (Зміна відкрита з HH:MM до HH:MM / На ранок порахували / На кінець дня порахували / Розбіжність pill / «закрив {name}» / explanation) — [ui-logic] except closer name [needs-api]
- 50 owner settle box for awaiting_explanation vs starter «Пояснити» in table [visual]; 51 operator notice «Зміна пішла керівникові…» [visual]
- 52 counts list: day-scoped «Перерахунок о HH:MM ✓ зійшлося» vs whole-history DataTable (from/to filter exists) [ui-logic]
- 53 «Перерахувати касу» midday count — NO `POST /cash-counts` [needs-api]
- 54 «Відкрити зміну»/«Закрити зміну» on THIS page + captions/footer [ui-logic, features/count-shift reusable]
- 55 close dialog copy + RESULT VIEW (Пораховано / Розбіжність pill / «Зміна закрита. День зійшовся.» or «…Очікує пояснення») [ui-logic read counts after, or needs-api return count on close]; 56 midday dialog; 57 open dialog copy; 58 validation >0 / ≥0
- 59–65 target dialog: title, «Діючий: X з {date} · {setBy}» (history needs-api), «Діє з» field (needs-api; §6.1 decision says no), labels/placeholders, LIVE PREVIEW «У касі за ягоду зараз X / Не хвататиме до наділу Y» [ui-logic], over-target copy, toast

## Ціни дня
- 66 eyebrow = longDate vs «Ціноутворення» [visual]
- 67 DATE-SCOPED sheet (as of workDate) — no business_date (decision #104) [needs-api]
- 68 role-dependent description; 69 lock banner dashed + Lock icon [visual]
- 70 per-point CARD view (operator / owner scoped to one point): cards under product eyebrows, big «{n} ₴/кг», PriceDelta, «ціна дня · {author} о {time}», «Історія за цей день» — [ui-logic] except author name [needs-api]
- 71 «Ціна за 14 днів» sparkline + delta column [needs-api trend]
- 72 product group header rows + indented grades [visual]; 73 «ОПТ» badge on wholesale grades [needs-api flag]
- 74 «Ціна дня загальна» cell: click-to-edit with hover pencil / «встановити» link / «не всюди · min» state (starter prints «різні» for it) / «₴» [ui-logic+visual]; starter uses separate «Встановити всім» button
- 75 point cells «{n} ₴» + PriceDelta (changed today) [needs-api]; «встановити» link [visual]; STARTER-only operator click→history
- 76/77 STARTER-only warehouse «· своя ціна» marking, sticky first column
- 78 «Зміни протягом дня» panel [needs-api date filter + author + morning price]
- 79 «Дод. ціна» global note with bounds — starter bounds are per grade-per-point; #117/§2.10: don't SHOW bounds to operator
- 81–86 set-price dialog: title/description/copy; starter requires 3 fields (base + markup + discount) vs mock 1; prefill from grade base [needs-api]; footer «Історія» STARTER-only; toasts
- 87 STARTER-only PriceHistoryDialog (author column needs-api)

## Top 5
1. Day reconciliation absent (13–16, 21) — allocations [needs-api]; reduced ledger doable now
2. Crates book on Point Cash is a placeholder though API serves `crate_deposits` (47–48) — QUICK WIN
3. Point Cash has no shift/count panel, no midday count (49–57) — mostly [ui-logic]; POST /cash-counts + closer name [needs-api]
4. Prices lacks every time dimension (67, 70–71, 75, 78) — blocked by no business_date; card view + cell wording independent
5. Day loses the berry story (8, 16, 20) — net_kg + grade breakdown [needs-api]

---

## Audit 3 — Постачальники / Картка / Залишки / Журнал (mock vs starter), 2026-09-17

API facts: Supplier has no `village`; `/supplier-balances` row has no `kind`, no oldest-open date, no count; `/suppliers/:id/balance` = one number, no allocations; `GET /intakes` headers only (no kg/grade/price), no `product_grade_id` filter; no aggregate endpoint.

## Постачальники (list)
- 1a eyebrow `{n} у списку` vs "Довідник" [ui-logic]; 1b description copy [visual]
- 1d search "Прізвище або село" needs village [needs-api]
- 1e owner period toggle Сезон/День + caption [needs-api]; 1f sort "за вагою/за сумою" [needs-api]
- 1g operator "Тільки з залишком" toggle + "Залишок за нами …" total — doable via /supplier-balances [ui-logic]
- 1h owner table «Здавальники за вагою»: Населений пункт, Прізвище, Загальна вага, Основний товар, Маркер, Нараховано — needs `GET /suppliers/summary?from&to&collection_point_id` [needs-api]
- 1i operator columns Здач, Ягоди, Нараховано, Залишок, Остання здача — balance [ui-logic], rest [needs-api]
- 1j supplier cell: avatar + name + KindBadge (ОПТ/Фермер) + "{village} · {phone}" [visual]+village
- 1l row click → card (starter: edit dialog + "Картка" link) [ui-logic]; 1n operator scope (mock includes anyone who delivered here) — domain, don't fix
- 1o/1p/1q starter-only: Стан column, spinner/error, hard cap 100 with no paging hint [ui-logic]
- 1r search-miss empty state copy [ui-logic]
- Create dialog: 1t single "Прізвище та імʼя" field vs two; 1v "Село" [needs-api]; 1w KindChoice buttons "Без позначки/ОПТ/Фермер" + hint vs select [visual]; starter has Нотатка/Точка/Активний/edit mode (richer)

## Картка постачальника
- 2b identity: h1 + KindBadge; meta phone · village · point; note «…» [visual]; 2c `uahAuto` (kopecks only when present) vs always 2 dec — applies everywhere [visual]
- 2d tiles: mock Здач за сезон / Ягоди здано (kg) / Нараховано / Залишок; starter Здач / Нараховано / Видано / Залишок — kg tile [needs-api]
- 2e balance hint "найстаріший з DD.MM — N днів" [needs-api oldest_open_date]
- 2g "Де саме лежить" per-point chips — domain n/a (§3.9 one supplier = one point)
- 2h "Хто це" kind picker on card [ui-logic, lift PATCH supplier into features/edit-supplier]; 2i phone add panel [ui-logic]
- 2j "Відкриті залишки — за що саме винні" per-receipt open amounts — needs allocations [needs-api]+domain
- 2k history intake row: "{berry} · {kg}" / "{gross} брутто − {tare} тара · {price} ₴/кг" / amount / "у залишок x" — one row per line — items on list [needs-api]
- 2l payout row "Видано залишок · закрито ягоду за DD.MM…" tint [visual], dates need allocations
- 2m starter-only: top-ups rows + Додати залишок (#61); top-up rows have empty date cell (misalign) [visual]
- 2q–2t receipt dialog: mock rows Попередній залишок/РАЗОМ/Видано готівкою/з них на попередні залишки/Залишок за нами — domain; date+time [ui-logic]; "Приймав" name [needs-api received_by name]; header "{point} · {village}"

## Залишки
- 3c tiles: mock Всього винні / Найстаріший залишок (N днів) / Погашено за сезон; starter Всього винні / Постачальників із залишком — two tiles [needs-api]
- 3e BUG: owner "Усі точки" falls back to warehouse via useWorkingPoint — owner can never see the network [ui-logic]
- 3f cards with expandable rows vs DataTable [visual]; 3g name + KindBadge + "{village} · {point} · N здач" [needs-api kind/village/count]; 3h age chip "N днів" destructive >7 [needs-api]
- 3k expand panel "Звідки взявся залишок" — allocations [needs-api]+domain
- Settle dialog: 3o starter-only "№ квитанції" (client wants it gone, #112); 3q preview "Що саме закриється" — allocations; 3r clamp live to [0,total] + disabled submit vs on-submit validation [ui-logic]; 3s failure copy; 3t success toast with dates

## Журнал
- 4b "Вивантажити CSV" 17 cols — [needs-api] line-level/server export
- 4c date range presets Сьогодні/7 днів/Липень/Весь сезон + from–to vs month picker [ui-logic]; season start constant
- 4d grade filter "Усі сорти" grouped product→grades — no `product_grade_id` filter [needs-api]
- 4e supplier filter text vs select (100 active only) [ui-logic combobox incl. inactive]
- 4f starter-only: point select, "показувати анульовані", tabs Квитанції|Виплати, URL-backed filters
- 4g summary strip Квитанцій/Ягоди/Нараховано/Видано/У залишок over WHOLE filtered set vs 2 tiles per page — [needs-api] range totals + kg
- 4h 13 columns per LINE (Сорт, Брутто, Піддон, Тара, Нетто, Ціна ± дод., Сума, Видано, Залишок) vs 7 per document — [needs-api] items on list
- 4i supplier name fallback prints id slice [ui-logic weakness]; 4j paging "Показати ще" vs pages of 20 [visual]

## Top 5
1. Per-supplier aggregates endpoint (+ kind on balances) — closes 1h,1i,1m,2d,2e,3c,3g,3h
2. Journal line-level (items on list + grade filter + range totals + CSV)
3. `village` on suppliers (schema + DTO + 4 render sites)
4. Per-receipt allocation is a DOMAIN FORK — decide (payout_allocations + FIFO) or drop 2j,3k,3q,3t
5. Cheap ui-logic wins: 2h,2i,1a,1g,1l,1r,3e bug,4c,4e

---

## Audit 4 — Shell / Зведення / Перекази / Точки / Тара і сорти / mock-only owner screens, 2026-09-17

Ported 1:1 (not divergences): Eyebrow, PageHeader, StatTile, EmptyState, Sparkline, ShareBar, Dot, print CSS, light palette (every shared :root hex identical). Starter ADDS dark mode (own neutral palette; designed mock-dark deferred), self-hosted variable fonts (same 3 faces), extra tokens.

## Shell
- 1.1 POINT SCOPE: mock = global top-bar selector (owner Select «Усі точки» + active points «{name} {village}» + footer «У реєстрі, ще не відкриті: …»; operator read-only pill «MapPin {point} {village}») persisted, scopes every screen. Starter = static pill «усі точки/ваша точка» + per-page SelectField on day/reception/crates/point-cash/debts (`?point=` + localStorage), warehouse-first fallback; dashboard unscoped. [ui-logic] biggest shell gap; village [needs-api]
- 1.2.1 business date + weekday in top bar [ui-logic]; 1.2.2 user block caption «керівник · усі точки» + initials badge [visual]; SyncPill «Дані збережено» = demo, don't port; starter-only ThemeToggle + header «Вийти»; hamburger lg vs md
- 1.3.6 BerryMark SVG vs lucide Cherry [visual]; 1.3.7 subtitle «{point} · {village}» for operator [ui-logic]; 1.3.8 nav: «Зведення» first in «Робота на точці» for both roles (mock: owner-only, first in «Керівництву»); starter «Користувачі» extra; 4 disabled items; 1.3.9 active bar; 1.3.10 footer «За компʼютером · увійшов о HH:MM» vs profile link [ui-logic]; DemoPanel = demo
- 1.4 sign-in: wordmark «Ягода» + h1 «Вхід» + lead paragraph [visual]; starter has hint + eye; submit disabled until filled [ui-logic]; clear password on failure [ui-logic]; demo accounts = demo; keep starter's single error text
- 1.5.21 React.lazy per owner screen + per-route ErrorBoundary «Не вдалося завантажити розділ…» + skeleton PageFallback [ui-logic]; 1.5.22 Toaster top-right richColors closeButton — verify
- 1.6 tokens identical; mock has NO dark palette; fonts same faces; title «Ягода — прийомка»

## Зведення (dashboard) — concept differs: mock = SEASON analytics; starter = TODAY ops
- 1 period selector 7/14/30/Весь сезон [needs-api summary endpoint grouped by day/grade/point/supplier]; 2 point scope [ui-logic]
- 4 tiles: Прийнято ягоди (т) [needs-api]; Нараховано ✓; Видано з каси «у т.ч. X старих залишків» (domain differs); Залишок за нами amber/leaf; Середня ціна ₴/кг [needs-api]; STARTER-only «Точок працює», «Квитанцій сьогодні»
- 5 bar chart «Прийнято ягоди по днях» (recharts; badge «Пік»; legend) [needs-api + chart lib]; 6 stacked bar «Скільки виходило з каси» [needs-api]
- 7 points block: mock cards (name, «основна», tonnage, uah, 14-day sparkline, «+N у реєстрі» dashed card) vs starter «Точки сьогодні» cards with shift badge + Каса за день/Прийомка buttons — sparkline/tonnage/«основна» [needs-api]; «+N у реєстрі» [ui-logic]
- 8 «Сорти за тонажем» bars [needs-api]; 9 «Найбільші здавальники» top 8 by amount (rank, KindBadge, «N здач · kg») vs «Найбільші залишки» top 5 by debt [needs-api]
- 10 «Що це замінює» — drop; 11 STARTER-only operator view (own point + shortcuts); 13 layout/number formats

## Перекази
- 1 date stepper + «Сьогодні» + past-day note; «Надіслати» hidden off-today — `as_of`/`from`/`to` exist [ui-logic]
- 3 summary «Заборгованість перед точками · разом X · ящиків N» vs StatTile «Винні точкам»; crates total [needs-api]
- 4 row set: mock only active points with a float, excl. Склад; starter every /point-cash row [ui-logic]
- 5 «ящиків» = −(inField + atBase): inField [ui-logic Σ outstanding_units], atBase [needs-api shipments]; headers lowercase [visual]
- 6 «стан» derived from documents ≤ date (dispute > in-transit > acceptance if today) [ui-logic]
- 7 expandable row → PointTransferHistory: crate standing formula (needs-api), per-point history cards with «прийняв {name} о HH:MM», «точка нарахувала…», «сторнував {by}», «подано замість переказу від dd.mm» — names [ui-logic owner via GET /users]; voided rows [ui-logic includeVoided]; starter has network-wide TransferHistory table instead
- 8 disputes: mock red banner per dispute + «Сторнувати і подати заново» (void + new with correctionOf); starter «Вирішити» → ResolveTransferDialog (POST /resolve) — STARTER HAS resolve; banner [ui-logic]; void-and-resend [ui-logic]
- 9 void: starter «Сторнувати» on every history row; mock only via correction dialog
- 10 send dialog: copy; cash PREFILL with shortfall + clamp + «Уся заборгованість — X» [ui-logic]; crates prefill by atBase [needs-api]; preview «Після прийняття: у касі X · не хватає Y» [ui-logic cash]; hint under carrier; toasts
- 11 badges lowercase «у дорозі/прийняв/не сходиться/сторновано»; starter adds «Врегульовано»; 12 two footer paragraphs [visual]

## Точки — mock = per-point season overview; starter = CRUD registry
- 1 eyebrow «{n} з {N} працюють · сезон 2026» [ui-logic]; 2 description
- 3 point cards for ACTIVE points: «основна» [needs-api is_main], village [needs-api], «N постачальників» [needs-api delivered], «Каса точки →» [ui-logic], «За сезон» т+₴ [needs-api], «Сьогодні» kg+«N квитанцій» (count ui-logic, kg needs-api), «Залишки» [ui-logic Σ balances], 14-day sparkline [needs-api], «приймає {operators}» [ui-logic GET /users]
- 4 table: Приймальник [ui-logic], Частка тонажу/Ягоди/Нараховано/Остання здача [needs-api], Залишки [ui-logic]
- 5 «У реєстрі — ще не відкриті» dashed section with chips vs Активна/Неактивна badge [ui-logic]
- 6 STARTER-only CRUD («Нова точка», PointFormDialog: Назва/Код/Тип/Ціль каси/Ціль ящиків/Активна); 7 «Ціль каси» raw decimal string [visual]

## Тара і сорти
- 1 two cards side by side («Види тари» / «Товар → сорт») vs Tabs + master-detail [visual]
- 3 tare inline edit (кг/₴ with toast on blur) vs dialog [ui-logic]; 4 «використано N шт за сезон» [needs-api]; 5 STARTER-only «Нова тара», Ящик/Стан columns
- 6 explanatory notes under cards [visual]
- 7 all products as uppercase group headings with all grades visible vs master-detail [visual]
- 8 per grade: «ОПТ» badge [needs-api flag — starter models wholesale on SUPPLIER kind, domain], season window [needs-api], base price [ui-logic if point chosen], status «приймаємо/виведено/сезон ще не почався/сезон закрито» [needs-api]
- 9 «Товар без сортів» dashed block [visual]
- 10 «Межі Дод. ціни — тільки керівник» global −30/+30 — starter per grade-price (max_markup/max_discount); network default [needs-api settings] — DOMAIN; #117 says «Межа мережі: −30 … +30»
- 11 STARTER-only product/grade CRUD dialogs

## Starter-only: users (registry + «око»), profile (avatar), ui-kit (gallery)

## Mock-only owner screens
- CostOfDay (Н8, 759 lines): per point/day; «Ягода» table with недостача/★ наша вага from reweigh; manual «Витрати за день»; «Пул на розподіл»; policy по вазі/по сумі/усе на товар; «Середня ціна після витрат» (4-dec rates); checks; violations; «Очікує переважування». Needs reweighs, day_expenses, expense_policies — NOT in DBML.
- Reweigh (Н9, 878 lines): base select, berry date, from-point; draft lines (gross/pallet/tare count/sort) → «Провести переважування»; «Звірка з пунктом» by product; posted list with void. Entity Reweigh/ReweighLine absent.
- NetworkAverage (Н10, 459): matrix product × point cost/kg + наша вага/сума/середня; check line; period strip day only.
- OwnerSheet (Н13, 286): PROVISIONAL printable one-pager (row per berry: вага/середня ціна/сума + РАЗОМ); reads networkAverage; DocumentPage template exists.
Engine to port: costOfDay/networkAverage/productDay/allocateByLargestRemainder (~700 lines calc.ts) → backend.

## Top 5
1. Dashboard analytics absent [needs-api + chart lib]
2. Four owner screens need 3 new tables + engine port [needs-api, new domain]
3. Point scope per page not in shell; no date in top bar; no lazy chunks [ui-logic] (+village)
4. Transfers thinner in every interaction — mixed
5. Points is a registry not an overview — mostly [needs-api]

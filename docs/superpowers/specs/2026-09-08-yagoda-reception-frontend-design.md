# Yagoda Reception Frontend — Design Spec

**Date:** 2026-09-08
**Builds on:** the intakes & payouts slice (PR #42, `docs/superpowers/specs/2026-09-08-yagoda-intakes-payouts-slice.md`) and the frontend migration stack (#41 → #43 → #44, `2026-09-08-yagoda-frontend-migration.md`).
**Source of the UI:** the mock `yagoda-crm` screens `ReceptionPage`, `DayPage`, `DebtsPage`, `SupplierPage` and their components, read in full on 2026-09-08 (see §3 for what maps and what does not).
**Mode:** written autonomously at the owner's instruction («виконай автономно, приймай на кожному кроці найкращі рішення»); every decision below is stated as a decision, with its reason, so it can be reversed by name.

## 0. Governing seam (unchanged)

Structure and how code is written → the starter (FSD, TanStack Query hooks per slice, `httpClient` + `ApiError`, `RequireAuth`/`RequireRole`, server-error-to-field mapping, url-state, i18n keys with `uk` default). UI, copy and layout language → the mock, in full. The API is the authority on money: **nothing on the client computes an amount that is sent to the server**; the client computes only *display* totals, in integer kopiykas, never floats (§4.6).

## 1. Goal

Wire the three money screens the API can already serve, in the mock's identity, so an operator can run a day on a point end to end: open the shift, receive berries, pay out, close the shift, and see the day's cash movements; and an owner can read balances and settle them.

1. **«Каса за день»** — the shift and the day's documents.
2. **«Прийомка ягоди»** — the intake form with live server-computed preview, the receipt, the supplier's history and balance, an optional payout right after the receipt.
3. **«Залишки за нами»** + **картка постачальника** — balances per point, settlement, a supplier's timeline.

Not in scope (§8): everything that needs `cash_counts`, crates or transfers — the cash ceiling, «Каса точки», «Ящики», «Перекази», «Собівартість», «Зведення», «Аркуш».

## 2. API this design consumes

From PR #42: `POST/GET /shifts…`, `POST/GET /intakes…`, `POST /intakes/:id/void`, `POST/GET /payouts…`, `POST /payouts/:id/void`, `POST /payouts/:id/settle-return`, `GET /suppliers/:id/balance` (shapes in that spec's §4). Money and weights are strings.

Added by the prep portion of this stack (§7.1):

- `POST /intakes/preview` — the same body as `POST /intakes` without `code`; the same refusals; returns `{ collection_point_id, supplier_id, business_date, amount, items[] }` with every computed line field. **This is how the form shows numbers while typing** — the server's `buildIntake()` is the only implementation of §2.4/§2.8/§2.9.
- `GET /supplier-balances?collection_point_id=&include_zero=&page=&limit=` — every supplier's `debt` at a point in one call; deactivated suppliers with a balance included; zero balances hidden unless asked.
- `collection_points.code` on the points screen and in the dev seed (SHP, KON, HAI, POP, MYK, BASE, …).
- Dev seed: shifts, receipts and payouts for the demo season, computed by the server's own functions.

## 3. Mock → API: what maps, what changes

| Mock behaviour | API reality | Decision |
|---|---|---|
| One `Reception` row per line, a `visitId` groups a visit; codes `Ч-0001` auto-generated per line | One **intake document** with nested items; **the operator types the receipt number from the paper book**, the server composes `SHP-IN-20260908-00412` (§6.2) | The form has a required **«№ квитанції»** field (2–16 chars `A-Z0-9-`, upper-cased). The receipt shows the composed code. A visit = one document; «N позицій» is `items.length`. |
| «Видано готівкою» inside the intake, with «Враховувати залишок», FIFO allocations and per-receipt open remainders | No payment on an intake; a **payout is its own document**, ceiling = supplier debt; balance is one number (Σ intakes − Σ payouts), no per-receipt breakdown | The intake form saves the receipt first. The receipt dialog then offers **«Видати готівкою»**, which opens the payout dialog pre-filled with `min(amount, debt)`. The «Попередній залишок» banner shows the one number from `/balance`. No FIFO dates anywhere. |
| Cash ceiling (`berryCash`) on payouts | Not built (no `cash_counts`) | Not shown. The only ceiling is debt, enforced by the server (`PAYOUT_EXCEEDS_DEBT`), mirrored client-side for UX only. |
| Live `weigh()` on every keystroke | No client arithmetic | `POST /intakes/preview`, debounced 250 ms, on every change to lines/supplier. Previous numbers stay visible (dimmed) while a preview is in flight; a 400 from preview is shown inline on the line it names. |
| Дод. ціна bounds from global settings (±30) | Per grade from the current price row (`max_markup`/`max_discount`) | The bound shown next to the field is the selected grade's; out-of-range is refused by the server (and by preview) — the field turns amber and the line reads «поза межею». No silent clamp, no «рахуємо без Дод. ціни». |
| `config.businessToday`, no shift on the reception screen | A document needs an **open shift** at the point; operator opens/closes, owner reopens | «Каса за день» owns the shift. «Прийомка» shows a banner with **«Відкрити зміну»** when none is open (operator) or «Зміну не відкрито» (owner) and disables the form. |
| Retired grades hidden; only grades priced today | Server refuses `GRADE_NOT_PRICED`; prices carry over until changed | Grade select lists grades with a current price at the point (`/grade-prices/current`), showing the price; unpriced grades are not offered. |
| 5-line ceiling | Not enforced server-side (§8.7) | Kept as a **UI cap** at 5 lines, with the mock's copy — it matches the paper book. |
| Operator/owner point scope via `activePointId` | Operator's point comes from the token; owner passes `collection_point_id` | Operator screens use `me.collection_point_id`. Owner screens start with a point picker (as the prices page does); nothing is written for the owner without a chosen point. |
| Void / corrections | `POST /intakes/:id/void`, `POST /payouts/:id/void` with a reason; author or owner | Added to the receipt/payout dialogs as **«Анулювати»** with a reason field (§6.5 of the intakes spec: a correction is void + new document). |
| `workDate` browsing of past days | `GET /shifts?collection_point_id&from&to` lists shifts by date | «Каса за день» navigates by **shift**: prev/next/date input over the point's shifts; today is the current shift. |
| Supplier history season-wide | `GET /intakes?supplier_id=` + `GET /payouts?supplier_id=` | Same, merged by `created_at`, newest first. |

## 4. Architecture and FSD mapping

### 4.1 New slices

```
entities/shift/            useCurrentShiftQuery(pointId) · useShiftsQuery · Shift type      ← day, reception
entities/supplier/         useSuppliersQuery(pointId, search) · Supplier type · balance     ← reception, debts, supplier card, suppliers page
entities/intake/           types (Intake, IntakeDetail, IntakeItem) · useIntakeQuery(id)    ← reception, day, supplier card, receipt widget
entities/payout/           types · usePayoutsQuery                                          ← day, debts, supplier card
features/settle-payout/    PayoutDialog (amount ≤ debt, typed code, reason-less) + mutation ← reception (after receipt), debts, supplier card
features/void-document/    VoidDialog (reason) + mutations for intake / payout               ← receipt widget, day, supplier card
widgets/receipt/           ReceiptDialog — composes intake detail + names (grade/product/tare/supplier/point) + print + actions (payout, void)
pages/day/                 «Каса за день» (/day)
pages/reception/           «Прийомка ягоди» (/reception) — form, preview, history panel, today's receipts
pages/debts/               «Залишки за нами» (/debts)
pages/supplier-card/       картка постачальника (/suppliers/:id)
shared/lib/money/          format: uah(str) · kg(str) · decimal-string sum/sub/cmp in integer kopiykas (display only)
```

`widgets/` is created here because the receipt is one composed block used by three pages; `frontend/CLAUDE.md`'s «add it when something needs it» clause applies now. `pages/suppliers` keeps its own mutations/dialog; its list query moves to `entities/supplier` because four slices now read suppliers.

### 4.2 Server state

Every read is a `useQuery` with `queryKeys` prefixes: `shifts`, `intakes`, `payouts`, `supplierBalances`. Writes invalidate by prefix: creating an intake invalidates `intakes`, `supplierBalances`, and the supplier's `balance`; a payout invalidates `payouts` and balances; opening/closing a shift invalidates `shifts` and `intakes`/`payouts` for that point. Preview is a `useMutation` (POST, no cache) driven by a debounced form snapshot; the last successful preview is kept in page state.

### 4.3 Forms

`react-hook-form` with a `useFieldArray` for lines and nested tare lines. Server errors map to fields through the page's `apiErrorToFields` (codes: `NO_OPEN_SHIFT`, `SUPPLIER_INACTIVE`, `GRADE_NOT_PRICED`, `TARE_REQUIRED`, `TARE_TYPE_DUPLICATED`, `TARE_TYPE_UNKNOWN`, `BONUS_OUT_OF_RANGE` (whatever the server names it — read from the source), `NET_NOT_POSITIVE`, `DUPLICATE_CODE`, `PAYOUT_EXCEEDS_DEBT`).

### 4.4 Point scope on screens

`usePointScope()` (in `entities/user`): returns `{ pointId, canPick }` — the operator's own point, or the owner's picked point from `?point=` (url-state) with `canPick: true`. All four pages use it; the owner sees the picker in the page toolbar.

### 4.5 Routing and nav

`/day` («Каса за день»), `/reception` («Прийомка»), `/debts` («Залишки»), `/suppliers/:id`. All `RequireAuth`, no role gate (both roles use them; owner-only actions are gated by `me.role` inside). Nav items in the «Робота на точці» / «Люди та гроші» groups get their `to`.

### 4.6 Money on the client

`shared/lib/money/decimal.ts`: `add`, `sub`, `sum`, `cmp`, `min` over decimal strings via `BigInt` kopiykas — the same contract as the backend's `common/money.ts`, tested with the same cases. Used for **display totals only** (day tiles, «N позицій · кг»). Never for a value that goes to the server; the form sends what the operator typed and shows what the server previewed. `shared/lib/money/format.ts`: `uah('12658.50') → '12 658,50 ₴'`, `kg('40.60') → '40,60 кг'`, `num` — string formatting, no parsing back.

## 5. Screens

Copy is the mock's, verbatim where it still applies (Ukrainian keys in `uk.json`, English in `en.json`).

### 5.1 «Каса за день» (`pages/day`)

- Header: eyebrow `{point} · {weekday}`, title **«Каса за {longDate}»**, description as in the mock. Toolbar: **‹ / date / › / «Сьогодні»** over the point's shifts; shift status chip (`Відкрита` leaf / `Закрита` / `Потребує пояснення` amber).
- Actions by role and state: operator — **«Відкрити зміну»** (no shift today) / **«Закрити зміну»** (open); owner — **«Переоткрити»** (closed, reason dialog). All confirm with `ConfirmDialog`; toasts «Зміну відкрито/закрито/переоткрито».
- Tiles: **«Квитанцій»** (count), **«Нараховано»** (Σ intake amounts, display sum), **«Видано»** (Σ payouts, tone berry), **«У залишок»** (нараховано − видано, tone amber when > 0). No kg tile (headers carry no weights; not worth N detail calls).
- **«Стрічка дня»**: intakes and payouts of the shift merged by `created_at` desc; intake rows open the receipt widget; payout rows show code, supplier, amount; voided documents are struck through with the reason on hover.
- Empty states: «Зміну ще не відкрито», «Цього дня рухів не було.»

### 5.2 «Прийомка ягоди» (`pages/reception`)

Two columns `xl:[1.35fr_1fr]` as the mock; one card on the left with the four numbered sections, right column = today's receipts.

- **Shift banner** at the top when no open shift (see §3).
- **1 · Постачальник** — the mock's combobox (search by name/phone, «Наша точка» only — the API scopes suppliers to the point; the «Інші точки» group is gone because a supplier belongs to one point), **«Додати нового постачальника»** reuses `pages/suppliers`' dialog via `features`? No — the create dialog stays where it is; the picker offers a link «Додати у Постачальниках» (keeps the slice boundary; revisit if it hurts). Balance banner «Попередній залишок {uah}» from `/balance` (amber) or «Переплата за нами» when negative. **Історія здач**: last 5 intakes/payouts of the supplier with «Картка постачальника» link.
- **№ квитанції** — required, mono, upper-cased, pattern `^[A-Z0-9][A-Z0-9-]{0,15}$`; hint «Номер із паперової книги — система додасть точку й дату». A 409 `DUPLICATE_CODE` lands on this field.
- **2 · Вага з тарою** — Брутто (decimal, 2 places, mask), Піддон (revealed by «+ Піддон»), tare lines (type select from active tare types with weight, stepper units ≥ 1, «Інша тара» adds a type not yet used, trash when > 1). Tare is required (server `TARE_REQUIRED`).
- **3 · Товар, сорт і ціна дня** — product select → grade select (only grades with a current price at the point; shows «{price} ₴/кг»); **Дод. ціна** stepper with the grade's bound «межі: −{max_discount} … +{max_markup} ₴/кг».
- Line preview (from the server): `тара {tare_weight_kg} · нетто {net_kg} · {price}+{bonus} → {amount}`; hints from the mock kept as **client-side warnings only** (gross > 750, per-crate outside 2–14) — they never block.
- **«Ще позиція»** (cap 5) commits the draft into the lines table (Сорт · Брутто · Піддон · Тара · Нетто · Ціна · Сума, trash per row).
- **4 · Розрахунок** — **«Нараховано»** = preview `amount`; **«Разом до видачі»** = нараховано + залишок (display sum, shown when balance > 0). Submit **«Прийняти {N позицій · } {кг}»** → `POST /intakes` → receipt widget opens with the stored document; toast «Прийнято {кг} — {uah}».
- Receipt widget actions: **«Друк»**, **«Видати готівкою»** (payout dialog, prefilled `min(amount, debt)`), **«Анулювати»** (owner or author, reason).
- Right column **«Сьогоднішні квитанції»**: this shift's intakes, newest first, count badge; rows open the receipt.

### 5.3 «Залишки за нами» (`pages/debts`)

- Tiles: **«Всього винні»** (display Σ), **«Постачальників із залишком»**, **«Погашено за сезон»** is dropped (needs a date-ranged aggregate; not worth a client scan) — two tiles, not three.
- Search field; list rows (card list, not accordion — there is no per-receipt breakdown to expand): name + kind badge + «неактивний» badge when applicable, balance (amber, mono), **«Видати без ягоди»** → payout dialog. Link to the supplier card.
- Owner: point picker; «усі точки» lists all with the point name in the row.

### 5.4 Картка постачальника (`pages/supplier-card`, `/suppliers/:id`)

- Header: name, kind badge, phone or «телефон не вказано», point; **«Видати залишок {uah}»** when debt > 0.
- Tiles: **«Здач за сезон»**, **«Нараховано»** (display Σ over the loaded pages), **«Видано»**, **«Залишок»** (from `/balance`).
- **«Історія — здачі та виплати»**: intakes + payouts merged, newest first, paginated «Показати ще»; intake rows open the receipt widget; voided rows struck through.
- Kind and phone editing stays on the suppliers page (edit dialog); the card links to it.

### 5.5 Payout dialog (`features/settle-payout`)

Title **«Видати залишок — {імʼя}»**, description from the mock. Fields: **№ квитанції** (typed, required, same rules as intakes — payouts have their own paper book), **«Сума видачі»** (decimal, prefilled with the debt or the passed default, «Усе — {uah}» button). Client check `amount ≤ debt` mirrors the server; `PAYOUT_EXCEEDS_DEBT` lands on the amount with the server's debt in the message. Success toast «Видано {uah}».

## 6. Testing

Per page: interaction tests with mocked slice hooks (as every existing admin page), plus axe; `features` and `widgets` get render + interaction tests; `shared/lib/money` gets exhaustive unit tests mirroring the backend's `money.spec.ts` cases. The preview flow is tested with a mocked mutation asserting the debounce collapses keystrokes and the last preview wins.

## 7. Delivery — one stack, four portions

```
main (after #45 and #42 merge)
 └─ feat/yagoda-reception-prep      backend: /intakes/preview, /supplier-balances · points code · seed documents · this spec
     └─ feat/yagoda-day-screen      entities/shift, money lib, pages/day, routes + nav
         └─ feat/yagoda-reception-screen   entities/supplier·intake·payout·tare options, widgets/receipt, features/settle-payout·void-document, pages/reception
             └─ feat/yagoda-debts-screen   pages/debts, pages/supplier-card
```

Until #45 and #42 are merged, the prep branch carries a merge of `feat/13-backend-api-intake-payouts`; it is rebased onto `main` before its PR is opened (`git rebase --onto main <merge-commit>`).

## 8. Out of scope, recorded

- Cash ceiling on payouts, «Каса точки», crates, transfers, cost of day, network average, owner sheet, dashboard — the money tables behind them do not exist yet.
- FIFO allocation of payouts to receipts and «за що саме винні» — the API has no allocations; the balance is one number by design (intakes spec §6.7).
- Offline queue / «у черзі» sync pill — the starter is online-only.
- Client-side re-implementation of `weigh()` — replaced by the preview endpoint; revisit only if offline becomes a requirement.
- Rounding suggestions on payouts («до сотні») — kept as a convenience button that rounds the *typed* amount down to whole hundreds (no arithmetic beyond integer division of kopiykas); no system suggestion.

## 9. Decisions taken autonomously (reversible by name)

1. Typed receipt numbers are a required field on both documents (the API composes; there is no auto-numbering).
2. Payment after an intake is a separate payout document offered from the receipt, not a field in the intake form.
3. Balances are a single number per supplier; no per-receipt breakdown, no FIFO dates.
4. Preview via `POST /intakes/preview`; no client money arithmetic except display sums in kopiykas.
5. Owner picks a point on every money screen; operator is bound to their own.
6. Day navigation is by shift, not by an arbitrary date.
7. `widgets/receipt` is the first widget; `entities/supplier` absorbs the suppliers list query.

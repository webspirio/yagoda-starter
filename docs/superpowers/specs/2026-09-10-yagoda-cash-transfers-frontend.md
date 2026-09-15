# Каса точки і Перекази — фронтенд (design)

*2026-09-10. Слайс фронтенду поверх бекенду з PR #62 (`feat/yagoda-transfers-cash-slice`).*

## 1. Що це і чому саме це

З 18 екранів мока `webspirio/yagoda-crm` перенесено 11. З семи, що лишились, **рівно два
годуються бекендом, який уже написаний**: `TransfersPage` (Н18, «Перекази») і
`PointCashPage` (Н17, «Каса точки»). Решта п'ять чекають або бекенд-слайсу (`CratesPage`),
або взагалі схеми (`CostOfDayPage`, `ReweighPage`, `NetworkAveragePage`, `OwnerSheetPage` —
уся Частина 8 правил, якої в `28-db-schema.dbml` немає).

Тому обсяг цього слайсу — ці два екрани, і нічого більше.

### 1.1 Третя, обов'язкова частина: ремонт «Каси за день»

PR #62 робить `counted_amount` **обов'язковим** у `POST /shifts` (`OpenShiftDto`) і
`POST /shifts/:id/close` (`CloseShiftDto`). Наявний
`frontend/src/pages/day/api/shiftActions.ts` шле обидва запити **без тіла**. Отже мердж #62
в main ламає вже поставлений екран: відкриття й закриття зміни почнуть віддавати 400.

Це не побічний ефект нашої роботи, а наслідок #62 — тому ремонт їде **окремим дрібним PR
між #62 і цим слайсом**, щоб main ніколи не стояв червоним.

## 2. Розкладка по PR

```
main
 └─ #62  feat/yagoda-transfers-cash-slice        (бекенд, чужий draft)
     └─ feat/yagoda-day-counted-amount           PR-A · ремонт «Каси за день»
         └─ feat/yagoda-cash-transfers-frontend  PR-B · два екрани
```

Дві ланки над чужою чернеткою — свідомо мінімум. #62 ще не злитий і може переписатися;
кожна зайва ланка в стеку — це ще один ребейз на кожну його правку. Фірмовий для цього репо
розклад «prep + екран + екран» (як у `reception-prep` → `day-screen` → …) тут дав би чотири
ланки над чернеткою, і це коштувало б більше, ніж виграло.

**PR-A і PR-B обидва draft**, поки #62 не злитий.

## 3. Межа даних: половина обох екранів — про ящики, і її джерела немає

Розділяється чисто, і межа проходить не там, де здається:

| Що на екрані | Джерело | Стан |
|---|---|---|
| Ящики **всередині переказу** — відправлено / нараховано / вирішено / розбіжність | `transfers.crates`, `reported_crates`, `resolved_crates` | ✅ є |
| Колонка «ящиків» у списку точок — скільки в мінусі | `crateStanding()` ← `crate_issuances` / `crate_returns` / `crate_shipments` | ❌ таблиць у бекенді немає |
| Секція «Каса за ящики», «завдатків за N ящиків» | те саме + `crateBalance()` | ❌ немає |
| `cash_counts.book = 'crates'` | enum є, але відкрите рішення №2 у #62 каже, що розділення шухляди не вирішене | ⚠️ пишеться лише `berry` |

**Рішення: заглушка з підписом.** Не «—» і не порожнеча.

- `—` уже зайнятий: у моку він означає «наділу не призначали». Той самий символ у двох
  значеннях зробив би екран тихо брехливим.
- Порожнеча вчить читача, що ящиків у продукті немає взагалі.

Тому там, де мок малює число за ящики, ми малюємо блок із явним текстом
**«Ще не рахується — ящики будуть у наступному слайсі»**. Користувач бачить, що це не баг,
а межа даних, і місце на екрані лишається зарезервованим під слайс ящиків.

Ящики **всередині переказу** малюються повністю: вони справжні.

## 4. Що вміє бекенд #62 — повний перелік

```
GET  /transfers                 ?collection_point_id&status&from&to&include_voided&page
GET  /transfers/:id
POST /transfers                 {collection_point_id, cash, crates, carrier, correction_of_transfer_id?}  owner
POST /transfers/:id/accept                                                                                 точка
POST /transfers/:id/dispute     {reported_cash, reported_crates, dispute_note}                             точка
POST /transfers/:id/resolve     {resolved_cash, resolved_crates}                                           owner
POST /transfers/:id/void        {reason}                                                                   owner

GET  /point-cash                ?collection_point_id&as_of&page   → [{collection_point_id, name,
                                  target_cash, cash, shortfall, unexplained_difference, latest_transfer}]
GET  /point-cash/:pointId       ?as_of                            → {collection_point_id, cash}

GET  /cash-counts               ?collection_point_id&shift_id&from&to&only_discrepancies&page
                                  → [{…, book, kind, counted_amount, expected_amount,
                                       discrepancy, is_open, explanation}]

POST /shifts                    {counted_amount}                  оператор  ← ЗМІНЕНО
POST /shifts/:id/close          {counted_amount}                  оператор  ← ЗМІНЕНО
PUT  /shifts/:id/explanation    {explanation}                     owner     ← НОВЕ
```

`TransferStatus` = `sent | accepted | disputed`. `ShiftStatus` = `open |
awaiting_explanation | closed`, де `awaiting_explanation` **недосяжний за рішенням клієнта**
(§7.7 скасовано: розбіжність ніколи не блокує закриття). Фронт обробляє його захисно, але
ніколи на нього не розраховує.

**`POST /cash-counts` не існує.** Підрахунок каси народжується лише при відкритті й закритті
зміни. Окремої дії «перерахувати зараз» (`midday`) немає — і `CashCountPanel` з моку тому
стає панеллю *навколо* відкриття/закриття, а не самостійним інструментом.

## 5. PR-A — ремонт «Каси за день»

Мінімальний і навмисно мінімальний.

- `pages/day/ui/OpenShiftDialog.tsx`, `CloseShiftDialog.tsx` — по одному грошовому полю
  (`text-input` + маска з `shared/lib/money`), кнопка підтвердження.
- `pages/day/api/shiftActions.ts` — `useOpenShiftMutation` і `useCloseShiftMutation`
  приймають `counted_amount`; інвалідація додатково чіпає `cashCounts` і `pointCash`.
- `entities/shift/model/shift.ts` — додати `explanation: string | null` (є в `ShiftResponse`
  після #62).

**Чому діалог не показує «очікувано» перед підрахунком.** Спокуса показати `expected_amount`
поруч із полем велика, і вона знищує сенс дії: підрахунок — це контроль, а людина, яка
бачить очікуване число, вписує його. Очікуване й розбіжність з'являються **після** запису —
у тості й на «Касі точки».

> **Розбіжність із кодом, зафіксовано 2026-09-10.** Тут спершу стояло, що ремонт додає
> `pages/day/ui/OpenShiftDialog.tsx`, `CloseShiftDialog.tsx` і що `pages/day/api/shiftActions.ts`
> несе `useOpenShiftMutation`/`useCloseShiftMutation`. Так і вийшло — доти, доки в цього
> діалогу не з'явився другий споживач: `pages/reception` теж дає оператору відкрити зміну
> (коміт `bb961d8`). Сторінка не ділиться UI напряму з іншою сторінкою, тому
> обидва діалоги об'єдналися в один `CountDrawerDialog` (`features/count-shift/ui/`), а
> `useOpenShiftMutation`/`useCloseShiftMutation` переїхали в `features/count-shift/api/shiftActions.ts`
> поруч із ним. `pages/day/api/shiftActions.ts` лишився лише під `useReopenShiftMutation` —
> вона нікуди не переїжджала, бо лишається owner-only з одним споживачем (`ReopenShiftDialog`).

## 6. PR-B — entity-зрізи

Три нові зрізи, кожен рівно `model` + `api`, як `entities/shift`:

| Зріз | Модель | Хуки |
|---|---|---|
| `entities/transfer` | `Transfer`, `TransferStatus` | `useTransfersQuery(filters)`, `useTransferQuery(id)` |
| `entities/point-cash` | `PointCashRow` | `usePointCashQuery({as_of})`, `usePointCashForPointQuery(pointId, as_of)` |
| `entities/cash-count` | `CashCount`, `CashBook`, `CashCountKind` | `useCashCountsQuery(filters)` |

`shared/api/queryKeys.ts` += `transfers`, `pointCash`, `cashCounts` — кожен префіксом, за
взірцем `intakes`/`payouts`.

**Інвалідація.** Будь-яка дія над переказом чіпає `transfers` **і** `pointCash` разом:
прийнятий переказ змінює касу точки. Відкриття/закриття зміни чіпає `shifts`, `cashCounts`,
`pointCash`.

## 7. PR-B — features

| Feature | Дія | Роль |
|---|---|---|
| `features/send-transfer` | `POST /transfers` | owner |
| `features/receive-transfer` | `accept` / `dispute` | точка |
| `features/resolve-transfer` | `resolve` | owner |
| `features/set-cash-explanation` | `PUT /shifts/:id/explanation` | owner |
| `features/set-point-target` | `PATCH /collection-points/:id {target_cash, reason}` | owner |

Сторнування переказу **розширює наявний `features/void-document`**: там уже є діалог із
обов'язковою причиною і `apiErrorToBanner`, а `useVoidDocumentMutation` розрізняє документи
за `kind`. Додаємо `kind: 'transfer'` і третій шлях інвалідації — це чесніше, ніж четвертий
діалог-близнюк.

## 8. PR-B — сторінки

### 8.1 `pages/transfers` — «Перекази», лише owner

Маршрут `/transfers` під `RequireRole role="network_owner"`. Приймальникові не малюється
жодного числа: заборгованість перед *іншими* точками — не його справа (§7, `G16`), тому це
роль-гейт маршруту, а не приховані кнопки.

Таблиця з `GET /point-cash`, рядок на точку:

| Колонка | Джерело |
|---|---|
| Точка | `name` |
| наділ | `target_cash`, `null` → `—` |
| у касі | `cash` |
| не хватає | `shortfall`, `null` → `—` |
| ящиків | **заглушка** (§3) |
| стан | `latest_transfer` → `TransferStateBadge` |

Під таблицею — історія переказів обраної точки (`GET /transfers?collection_point_id`), з
розкриттям спірного переказу: відправлено / точка нарахувала / розбіжність, і кнопка
«Вирішити» для owner.

### 8.2 `pages/point-cash` — «Каса точки», обидві ролі

Маршрут `/point-cash` під `RequireAuth` без роль-гейту. Приймальник прибитий до своєї точки
токеном; owner обирає точку через наявний `usePointScope`.

- Три `StatTile`: **Наділ** (`target_cash`), **У касі за ягоду** (`cash`), **Не хватає до
  наділу** (`shortfall`). Бурштин на shortfall > 0 означає «база винна».
- **Вхідні перекази** — `GET /transfers?collection_point_id&status=sent`; кнопки «Прийняв» і
  «Не сходиться» лише в приймальника.
- **Розклад каси** (`CashLedger`) — на `shared/ui/ledger-row`, який уже є.
- **«Каса за ящики»** — заглушка (§3).
- **«У шухляді має бути»** — у моку це `ягода + ящики`. Ящиків немає, тому плитка показує
  `cash` із підписом «лише ягода — ящики ще не рахуються». Складати з невідомим не можна.
- **`CashCountPanel`** — історія `GET /cash-counts` для точки: `kind`, `counted_amount`,
  `expected_amount`, `discrepancy`, `explanation`. Рядок із `is_open: true` підсвічений; у
  owner на ньому кнопка «Пояснити» (§7).
- **`CashFloatDialog`** — зміна `target_cash`. Причина обов'язкова, **окрім найпершого**
  цільового значення точки: попереднього рівня не існувало, пояснювати нема чого
  (§6.1). Порожня причина не відправляється як `''` — поле опускається з тіла запиту,
  інакше бекендівський `@Length(1, 500)` віддає 400.

> **Виправлено 2026-09-10.** Тут спершу стояло просто «з обов'язковою причиною».
> `26-rules-by-example.md:857` каже прямо: «Для **першого** цільового значення точки причина
> не потрібна — попереднього рівня не існувало», і :878 підтверджує, що правило чинне й після
> правки схеми 03.09.2026. `update-collection-point.dto.ts:75` теж має `reason` як
> `@IsOptional()`. Помилку знайшло рев'ю задачі 17, а порожній рядок проти `@Length(1, 500)` —
> імплементер, уже роблячи виправлення.

**§10.2 — у приймальника кнопки наділу НЕ ІСНУЄ, а не «є, але сіра».** Різниця несуча:
заблокована кнопка вчить шукати обхід, відсутня не вчить нічого.

**Точка без жодного підрахунку читається як `0.00`.** Це правильно (перший підрахунок *і є*
початковий залишок, §7.3), але на деплої виглядатиме як регресія — тому при нулі підрахунків
під плиткою стоїть підпис «Каса ще не рахована: перший підрахунок при відкритті зміни задасть
початковий залишок».

## 9. Звідки беруться числа розкладу

`GET /point-cash` дає **авторитетне** `cash` — одна SQL-формула на бекенді. Рядки розкладу
(«вчорашній залишок», «нараховано сьогодні», «видано за минулі дні», «приїхало переказом»)
виводяться на клієнті з `intakes` + `payouts` + `transfers` через `shared/lib/money`
(`add`/`sub`/`sum`/`cmp` на копійках у `bigint`) — рівно тим прийомом, яким це вже робить
«Каса за день».

**Підсумок під розкладом — це число бекенду, а не сума показаних рядків.** Якщо вони
розійдуться, ми показуємо бекендове число і не замазуємо різницю: тиха розбіжність гірша за
видиму. Розклад — пояснення, джерело істини — сервер.

## 10. Помилки

`features/void-document/lib/apiErrorToBanner.ts` і `pages/day/lib/apiErrorToBanner.ts` — це
вже дві копії того самого. Третій і четвертий споживач з'являються в цьому слайсі, тому
функція піднімається в `shared/lib/api-error` одним рухом, а обидві копії стають реекспортом
і зникають. Це той самий файл, у якому ми й так працюємо, — не стороннє прибирання.

Окремо обробляються стани, які бекенд #62 віддає навмисно:
- прийняти переказ **без відкритої зміни** — 409; банер каже відкрити зміну, бо
  `accepted_date` береться зі зміни;
- вирішити спір може лише owner — 403;
- сторнувати **вже сторнований** переказ — 409 `ALREADY_VOIDED`.

> **Виправлено 2026-09-10.** Тут спершу стояло «сторнувати відкритий/прийнятий переказ —
> правила #62». Це було неправильно: `TransfersService.void` відмовляє РІВНО в одному
> випадку — коли переказ уже сторновано. Сторнувати **прийнятий** переказ дозволено, і це
> не лазівка, а сам механізм §9.3: виправлення це сторно плюс новий документ. Помилку
> знайшов імплементер задачі 11, звіривши текст із кодом.

## 11. Тести

Взірець — наявні `DayPage.test.tsx` і `useShifts.test.tsx` (vitest + RTL + мок `httpClient`).

- **Кожен entity-хук** — тест на шлях і на форму параметрів запиту.
- **Кожен feature** — тест на тіло мутації й на набір інвалідованих ключів.
- **`pages/transfers`** — рядок точки без наділу показує `—`, а не `0`; заглушка ящиків
  присутня; приймальник на маршрут не потрапляє.
- **`pages/point-cash`** — приймальник не бачить кнопки наділу **взагалі** (`queryBy…` →
  `null`, не `toBeDisabled`); точка без підрахунків показує підпис, а не голий нуль;
  підсумок розкладу дорівнює `point-cash.cash`, а не сумі рядків.
- **PR-A** — відкриття й закриття шлють `counted_amount`; порожнє поле не відправляється.

Рядки — через i18n (`uk`/`en`), як усюди в проєкті.

## 12. Чого в цьому слайсі свідомо немає

- **Ящики** в будь-якому вигляді, крім тих, що всередині переказу (§3).
- **`midday`-підрахунок** — бекенд його не приймає (§4).
- **Екран `CratesPage`** — потребує бекенд-слайсу.
- **Частина 8** (переважування, собівартість, середня по мережі, аркуш керівника) — потребує
  спершу схеми, а `OwnerSheetPage` до того ж не погоджений із клієнтом (`A-14`, ризик `R-13`).

## 13. Ризик координації

В описі #62 сказано: «The frontend. Entity slices and two screens exist in the working tree,
deliberately uncommitted». Це рівно ці два екрани. У самому PR frontend-файлів немає
(перевірено списком файлів), тобто робота існує лише локально в hlibVasylevskyi.

**Дію треба узгодити з ним до мерджу PR-B**, інакше два фронтенди на один бекенд.

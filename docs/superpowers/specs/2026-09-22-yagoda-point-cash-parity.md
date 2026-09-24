# «Каса точки» parity slice — spec (programme slice 2, 2026-09-22)

Programme: `docs/superpowers/specs/2026-09-17-yagoda-mock-parity-programme.md` §5.2 (charter), audit items 25–65 in `…-mock-parity-audit.md`. Rules: `26-rules-by-example.md` §7.1–7.10, §10.3, §10.6, the 20:50 story and its «Правка». Mock: `~/work/yagoda-crm/src/pages/PointCashPage.tsx` + `components/cash/*`. One branch from `main` (`feat/point-cash-parity`, independent of the reception stack), backend tasks first, then the screen — one PR, as the reception slice shipped.

## 1. Rulings (the grilling, answered from the documents)

- **R1 Two books, no combined figure.** The mock's dark block «У шухляді має бути = ягода + ящики» is NOT ported. The client's «Правка» under the 20:50 story says the berry money and the crate money do not lie in one drawer, and `point-cash.service.ts` already refuses to add the two books. The screen shows «У касі за ягоду» (the existing headline) and a «Каса за ящики» card side by side, with the mock's footnote «Ці гроші лежать окремо від ягідних…». Audit 48 is therefore *not ported (rule)*.
- **R2 D-6 resolved: a midday count exists.** `POST /cash-counts` `{ book: 'berry', counted_amount }` — operator only, at their own point, only while that point's shift is open; kind `midday`; `expected_amount` is the drawer at that instant (`PointCashService.cashFor` under the same transaction), frozen; the response is the count row. §7.6 permits any number of recounts; the 10.09 note's concern is honoured by leaving the owner's `only_discrepancies`/`is_open` logic unchanged (midday never opens an incident — the closing count carries the day's discrepancy), and by saying so in the controller comment. The crates book is never counted (crates spec §4.3): the DTO accepts only `berry` today.
- **R3 D-8 for this slice: names on the two responses this screen prints.** `ShiftResponse` gains `opened_by_name` and `closed_by_name`; `CashCountResponse` gains `counted_by_name` (`displayNameOf`, the one definition). Nine-response rollout stays deferred; the reception slice already did `received_by_name`.
- **R4 Open/close/recount live on this page for the operator, today only** (§10.3; the day view keeps its own controls). `features/count-shift`'s `CountDrawerDialog` is reused for open and close (close still asks `broken_crates`, #110); a new `RecountDrawerDialog` in the same feature for midday. After each, the panel reads the counts back from `GET /cash-counts?shift_id=` and shows the mock's result view — «Пораховано / Розбіжність». A non-zero closing discrepancy says «Зміна закрита. Розбіжність X — керівник побачить її у своєму списку» (the 09.09 rule: nothing blocks; `awaiting_explanation` is unreachable and its mock copy is not ported).
- **R5 Disputed transfers are visible** as the red card (`status: 'disputed'`, unresolved only), with the mock's copy except the footer, which reads «Каса не змінилася ні на копійку. Керівник врегулює переказ — на точці цю цифру не правлять» (the starter has `resolve`, not void-and-resend).
- **R6 Ledger polish**: a «на початок дня» row from the day's opening count (berry book) when one exists; the negative-cash notice; the mock's two-rows footnote rewritten without the demo numbers; «у касі більше, ніж наділ» on the shortfall tile; the owner's point select lists points with a target first («З наділом» / «Без наділу» groups) and still shows cash for any point.
- **R7 Target dialog**: description «Діючий: X» when a target exists; live preview «У касі за ягоду зараз X / Не хвататиме до наділу Y» while typing; the over-target sentence; the mock's toast. No «Діє з», no history, no reason history (03.09.2026 decision: a target is a plain column).
- **R8 Deposit-covered crate units** on the point-cash row (`crate_deposit_units`, an integer): units issued «за кошти» whose deposit is still held, the same base `crateBookSql` reads; the card's caption «завдатків за N ящиків».
- **R9 Not ported**: the combined drawer total (R1); target history / «Діє з»; «Касову книгу ведемо з {date}» (no book-opening date in the schema); every `awaiting_explanation` branch; the SyncPill; the mock's void-and-resend on disputes.
- **R10 Laptop-first layout as the mock**: stats row; the notice; `IncomingTransfers` full width (in-transit + disputed); then `lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]` — ledger left; right column = «Каса за ящики» card, then «Зміна і перерахунок каси» panel. The whole-history count table moves behind a «Уся історія перерахунків» toggle below.

## 2. Backend — PR 1 (`feat(cash-counts): recount, names, deposit units`)

1. `POST /cash-counts` — `CreateCashCountDto { book: 'berry'; counted_amount: string }` (`@Matches(/^\d{1,10}(\.\d{1,2})?$/)`, canonicalised); `@Auth(UserRole.PointOperator)`; service: find the operator's open shift (`NO_OPEN_SHIFT` → 409 `code`, aligned with `intakes`/`payouts`/`transfers`/`crates` — the same fact everywhere else in this backend), `expected = cashFor(pointId, undefined, m)`, save `CashCount { shift_id, book, kind: midday, counted_amount, expected_amount, counted_by_user_id, counted_at }`, audit entry, return the mapped row. Lock: the shift's `IN`? No — a count is a witness (§7.6), it takes no document lock; it reads the drawer at its instant. db-spec: two recounts on one shift both land (no unique clash), `expected` equals `GET /point-cash` at that moment, a closed shift refuses, an owner gets 403, a foreign point's operator cannot count it (proven while point A's own shift is still open, so the refusal is shown to come from the foreign operator's own point).
2. `ShiftResponse.opened_by_name / closed_by_name` (nullable), `CashCountResponse.counted_by_name` — mappers join `users` (one query per list via a name map, no N+1); unit tests + the existing db-specs extended.
3. `PointCashRowResponse.crate_deposit_units` (integer) on the list row and on `GET /point-cash/:id`; derived next to `crateBookSql` from deposit-mode issuances minus returned units; db-spec against a seeded issuance + partial return.
4. `backend/CLAUDE.md` lines for cash-counts (write route now exists, why), shifts (names), point-cash (units). DBML note unchanged (no schema change).

## 3. Frontend — PR 2 (`feat(point-cash): the mock's «Каса точки»`)

Entities: `PointCashRow/One` gain `crate_deposits`, `crate_deposit_units`; `CashCount.counted_by_name`; `Shift.opened_by_name/closed_by_name`; `features/count-shift` gains `useRecountMutation` (`POST /cash-counts`) and `RecountDrawerDialog`.

Page composition (R10): header eyebrow «{point} · {longDate}, {weekday}», title «Каса точки», description «Скільки грошей на точці має бути просто зараз і скільки не хватає до наділу. Гроші за ягоду й завдатки за ящики — дві окремі книги, вони не позичають одна в одної.»; owner select grouped (R6); «Змінити/Призначити наділ каси» owner-only. Stats: Наділ (hint «наділу цій точці ще не призначали»), У касі за ягоду (hint «готівка, якою можна платити за ягоду»), Не хватає до наділу (hints: «без наділу порівнювати нема з чим» / «керівник ще не переказав» / «у касі більше, ніж наділ» / «наділ на точці відновлено»). `IncomingTransfers`: in-transit (existing) + disputed red card (R5). Ledger (R6). «Каса за ящики» card (R1, R8). «Зміна і перерахунок каси» panel (R4): shift line «Зміна відкрита/закрита · з HH:MM до HH:MM», «На ранок порахували», «На кінець дня порахували», discrepancy pill, «закрив {closed_by_name}», italic explanation; the day's counts «Перерахунок о HH:MM ✓ зійшлося / ⚠ не зійшлося»; actions per the mock's four states; footnote «Рахувати можна скільки завгодно разів…». Dialog copy = the mock's, adapted per R4. Target dialog (R7).

Copy in `uk.json` verbatim from the mock where quoted here; `en.json` twins. Tests per component; page test for each role and each panel state; axe.

## 4. Definition of done
Backend: `npm test`, `npm run test:db`, `verify:full`. Frontend: suite, lint, tsc, `verify:full`; the two-window comparison at `/point-cash` for both roles. §5 audit marks appended by the last frontend task.

## 5. Audit marks — «Каса точки» (items 25–65)

Source: `docs/superpowers/specs/2026-09-17-yagoda-mock-parity-audit.md`, Audit 2, «Каса точки» (items 25–65 — item numbers are continuous within Audit 2, not reset per screen). Every number in the range gets its own mark, even where the audit folds several numbers into one bullet. Marks: `ported` (shipped, task cited), `not ported (rule)` (an explicit ruling says so), `deferred → D-n` (needs a domain decision this slice did not make), `already at parity (audit)` (the audit itself records no gap — a starter-only addition, or a pre-existing accepted difference this slice did not revisit).

- **25** ported — bare title «Каса точки» (Task 3, folded-in 1: dropped the date suffix once the eyebrow carried it).
- **26** ported — eyebrow «{point} · {longDate}, {weekday}» and the description copy (Task 2).
- **27** already at parity (audit) — the date stepper is starter-only; the mock has nothing to port it from.
- **28** not ported (rule) — R6: the owner's select groups points «З наділом» / «Без наділу» instead of filtering to only points with a float, and still shows cash for any point.
- **29** ported — the button copy («Change the target» / «Assign a target») matches the mock's intent; the Wallet icon was not carried over (decorative, and absent from the spec's own §3 composition text).
- **30** ported — empty-state copy covers the same ground (`pointCash.stats.neverCounted`, `pointCash.panel.recountsEmpty`, `pointCash.panel.actions.noShiftNote`, `pointCash.countHistory.empty`), worded to this codebase's own convention rather than the mock's literal string.
- **31** not ported (rule) — R9: «Касову книгу ведемо з {date}» has no book-opening date anywhere in the schema.
- **32** not ported (rule) — R9: the «Наділ» stat's «з DD.MM» needs target history, which §6.1's 03.09.2026 decision rules out (a target is a plain column, not a history).
- **33** folded into 32 — same «Наділ»-hint cluster; no separate sub-point survives in the audit's own bullet text.
- **34** ported — Task 2's `shortfallOver` hint branch («у касі більше, ніж наділ»).
- **35** ported — R5 (Task 4): a second `status: 'disputed'` read renders the red card, filtered to unresolved disputes.
- **36** ported — Task 4 rewrote the in-transit caption («{{carrier}} · sent {{date}} at {{time}} · …»).
- **37** ported — Task 4's accept-toast detail line (`toastAcceptedDetail`).
- **38** folded into 39 — same dispute-dialog cluster; no separate sub-point survives.
- **39** already at parity (audit) — the prefilled-cash-vs-blank divergence is recorded in the audit itself as an already-accepted, pre-existing difference; R5's scope was the card and its footer, not the dispute dialog's own copy.
- **40** folded into 39 — same dispute-dialog cluster.
- **41** ported — R6 (Task 5): the «на початок дня» row from the day's opening berry count; its hint captions the target alone — the mock's «− борг бази» subtraction is not derivable from anything this page reads (`buildLedger`'s own comment) and was not attempted.
- **42** deferred → D-1 — the «за сьогоднішню ягоду» / «за ягоду інших днів» split by allocation origin needs `payout_allocations` (FIFO per receipt); the starter still splits by a payout's own `business_date`.
- **43** deferred → D-1 — «погашено сьогоднішній залишок» needs the same allocations table D-1 defers.
- **44** already at parity (audit) — `accruedToday`/`returnedToday` are starter-only rows with nothing in the mock to port.
- **45** ported — R6 (Task 5): the negative-cash notice and a two-rows footnote rewritten without the mock's demo numbers.
- **46** ported — the total row is bold (`strong`) and right-aligned mono, reading as the mock's emphasis intends; not literally indented/uppercase — a cosmetic simplification (`LedgerRow` already carries an unused `indent` prop for a future pass).
- **47** ported — R1/R8 (Task 3 + the backend PR): `crate_deposit_units` on the row, the card's «завдатків за N ящиків» caption.
- **48** not ported (rule) — R1: no combined «У шухляді має бути» figure; the two books sit side by side and are never summed.
- **49** ported — R4 (Task 6): the shift line, opening/closing counts, discrepancy pill, `closed_by_name` (R3/D-8), and the explanation line.
- **50** not ported (rule) — R9: `awaiting_explanation` is unreachable under the 09.09 rule, so there is no state left for an owner settle box to render; the day page's own «Пояснити» flow is untouched by this slice.
- **51** not ported (rule) — R9: same 09.09 rule — there is no "sent to the manager" state to notify the operator about; the closing result's own sentence supersedes it (deviations, below).
- **52** ported — R4 (Task 6): a day-scoped «Перерахунок о HH:MM ✓/⚠» list inside the panel, alongside the pre-existing whole-history table (now behind R10's toggle).
- **53** ported — R2/D-6 (backend PR 1): `POST /cash-counts` + `RecountDrawerDialog`.
- **54** ported — R4 (Task 6): open/close live on this page via the shared `CountDrawerDialog`, with the panel's own captions and footnote.
- **55** ported — R4 (Task 6): `CountResultView` shows the counted figure and a discrepancy pill; the mock's «Очікує пояснення» branch does not exist (09.09 rule — deviations, below).
- **56** ported — R4 (Task 6): `RecountDrawerDialog`.
- **57** ported — reuses the existing `CountDrawerDialog` open-mode copy.
- **58** ported — `>0` / `≥0` validation (`recount.errors.amount`, the existing close-count rules).
- **59** not ported (rule) — R9: the mock's history-framed title has no target history to title itself with.
- **60** not ported (rule) — R9: «Діючий: X з {date} · {setBy}» — only «Діючий: X» ported (Task 7); the date/author half needs target history, which is ruled out.
- **61** not ported (rule) — R9: «Діє з» field — explicitly ruled out (§6.1, 03.09.2026: a target is a plain column).
- **62** ported — Task 7: field label «Скільки грошей, ₴» / "How much money, ₴".
- **63** ported — Task 7: the live preview («У касі за ягоду зараз X» / «Не хвататиме до наділу Y»).
- **64** ported — Task 7: the over-target sentence, replacing the old amber warning.
- **65** ported — Task 7: the two-part toast (title + description).

### Deviations from the mock

1. **R1 — no combined drawer.** The mock's «У шухляді має бути» dark block (berry + crates summed) is not ported. `CratesBookCard`'s «Дві книги» line prints both figures but never their sum — `point-cash.service.ts` already refuses to add the two books, and the client's «Правка» under the 20:50 story is why.
2. **R4's closing copy under the 09.09 rule.** A non-zero closing discrepancy reads «Зміна закрита. Розбіжність X — керівник побачить її у своєму списку» (`pointCash.result.closedDiscrepancy`), not the mock's «…Очікує пояснення»: nothing blocks the close, and `awaiting_explanation` never occurs in production.
3. **R5's footer.** The disputed-transfer red card's footer reads «Каса не змінилася ні на копійку. Керівник врегулює переказ — на точці цю цифру не правлять» (`transfer.incoming.disputed.footer`), not the mock's void-and-resend flow — the starter's own remedy for a disputed transfer is the owner's `resolve`, not a void plus a resend.
4. **The error code `NO_OPEN_SHIFT`.** A midday recount against a closed or nonexistent shift refuses with `NO_OPEN_SHIFT` / 409 (aligned with intakes, payouts, transfers and crates), surfaced by `RecountDrawerDialog` through `apiErrorToBanner`'s per-call override (`recount.errors.amount`) rather than the shared `transfer.errors.noOpenShift` wording — a starter-only refusal with no mock equivalent, since the mock imposes no shift-status gate on «Перерахувати касу».
5. **The units caption.** The crates card's unit count reads «завдатків за N ящиків» (deposit-covered units specifically, `pointCash.crates.caption`), not the mock's generic «за N ящиків»: R8 counts only issuances whose deposit is still held, not every crate at the point — D-3's fuller crate-shipments picture is still open.

### Note — the backend plan's recount refusal code was superseded

The backend plan (`docs/superpowers/plans/2026-09-22-yagoda-point-cash-backend.md`, Task 1) originally specified `SHIFT_NOT_OPEN` / 400 for a midday recount against a shift that is not open. The shipped code is `NO_OPEN_SHIFT` / 409 instead, aligned with every other document's refusal in this backend (intakes, payouts, transfers, crates) — recorded on the plan itself as «Deviation, recorded (2026-09-22, final review)». The frontend's `RecountDrawerDialog` (deviation 4, above) was built against the shipped code, not the plan's original text.

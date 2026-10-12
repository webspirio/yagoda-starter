# One money input — thousands spaces, one rule, one message (#72)

**Date:** 2026-10-12
**Source:** issue #72 (review of PRs #64 and #66, 2026-09-10); field inventory of `origin/main`
taken the same day. Related: #77 (the same «lift it into `shared`» move).

**Position in the schema:** none. Frontend only — no endpoint, DTO or migration changes.

---

## 1. Goal

Every money and weight field in the app accepts and refuses the same text, says the same thing
when it refuses, and is built from one shared component, so the next form gets the rule by using
that component rather than writing its own regex.

### The decision the issue left open

Issue point 1 is **accepted**: a space inside a number is a thousands separator and nothing else.
The alternative (any space ignored, «980 40» → 98 040,00) is the hundred-fold silent error the
issue exists to remove.

### Success (the issue's acceptance criteria, unchanged)

| Typed | Result |
|---|---|
| `12 000` | accepted, saved as 12 000,00 |
| `1 234 567,50` | accepted, saved as 1 234 567,50 |
| `980,40` / `980.40` | accepted, saved as 980,40 |
| `980 40` | **refused**, with the same message on every form |

The forms: day price, point target (point card and «Наділ каси»), tare, reception (gross,
pallet, surcharge, «Видано готівкою»), payout, transfer (send, dispute, resolve), drawer count
(open, close, recount), top-up, day expenses, reweigh. Crates fields (integers) do not change.
Already-saved amounts display as before (`format.ts` is not touched).

---

## 2. The rule

One grammar, in `shared/lib/money/input.ts`:

```
trim → every whitespace char (space, U+00A0, U+202F, U+2009) counts as a space
^-?  ( \d+  |  \d{1,3}( \d{3})+ )  ( [.,] \d{1,2} )?  $
and the integer part, spaces removed, is 1–8 digits
```

`12.` and a bare `.` are refused (the typing mask may hold them mid-keystroke; submit may not).

- At most **8 integer digits and 2 decimals**, for every field. This is today's `DECIMAL_INPUT`.
  Prices and weights mirror the backend exactly. For cash columns it is two digits narrower
  than the backend's 10, on purpose: `input.ts` already says that 99 999 999,99 ₴ is never a
  real figure, and an extra zero there is usually a slip of the finger. `PointFormDialog` and
  the tare deposit drop from 10 to 8, which brings them into line.
- A grouped integer part has exactly one space per group of three. `12 000` and `12000` are both
  valid. `980 40`, `1 2345` and `12  000` are not.
- A negative sign is allowed only where the field opts in. Reception's surcharge is the only
  field that does, mirroring the backend's `bonus`.
- The U+202F that `formatUah` prints is a valid separator, so a figure copied back out of the app
  pastes cleanly.

### API (`shared/lib/money`)

| Export | Behaviour |
|---|---|
| `parseDecimal(raw, { allowNegative? })` → `string \| null` | The canonical dot form without spaces (`'12 000'` → `'12000'`, `'980,40'` → `'980.40'`), or `null` when the rule refuses it. This is the one place the grammar lives. |
| `normalizeAmount(raw)` | **Changed.** Returns `parseDecimal(raw) ?? raw.trim()` with the comma turned into a dot. It **no longer deletes every space**, so `'980 40'` stays `'980 40'` and fails any later shape check instead of turning into `98040`. Existing callers keep working unchanged. |
| `DECIMAL_INPUT` | Kept as the canonical-form check (no spaces), for callers that test an already-normalized value. |
| `maskDecimalInput(raw, opts)` | **Changed.** While typing, it keeps one space after a digit in the integer part, so `980 40` stays visible and gets refused rather than quietly becoming `98040`. It also caps the integer part at 8 digits. Letters and second separators are still dropped. |
| `decimalRules({ required?, allowNegative? })` | **Replaces `amountRules(key)`.** Returns `{ required, validate }` as an RHF rule, always using the single key `common.errors.decimalFormat`. Taking no key is the point: a form cannot ask for a different message. |
| `cratesRules` | Unchanged. |

### The one message

The `common.errors.decimalFormat` key:
- uk: «Введіть число, напр. 980,40 або 12 000 — пробіл лише між тисячами»
- en: «Enter a number, e.g. 980.40 or 12 000 — a space only between thousands»

The same key serves the «empty» case of a required field, as `amountRules` does today. The
per-form format keys this replaces are deleted: `prices.errors.priceFormat`,
`points.errors.cashFormat`, `catalog.errors.weightFormat`, `catalog.errors.depositFormat`,
`payout.errors.amountFormat`, `transfer.errors.cashFormat`, `pointTarget.errors.cashFormat`,
`day.errors.countFormat`, `recount.errors.amount` and `topUp.errors.amountFormat`.

Keys the server maps stay, because they are a different failure:
`reception.errors.decimalFormat`, `reception.errors.paidFormat` and `apiErrorToFields`. Semantic
checks also keep their own messages: «більше за нуль», «не більше за залишок», «каса» and the
others.

---

## 3. The component — `shared/ui/decimal-input.tsx`

```tsx
<DecimalInput {...a11y} {...register('amount', decimalRules())} />          // RHF, uncontrolled
<DecimalInput value={v} onChange={(e) => setV(e.target.value)} />            // controlled
<DecimalInput allowNegative ... />                                           // surcharge
```

- A `forwardRef` wrapper over `TextInput`, so it keeps the `.fld` chrome, the 16px floor and the
  `ghost` variant. It sets `type="text"`, `inputMode="decimal"` and `autoComplete="off"`.
- `onChange` writes `maskDecimalInput(e.target.value)` back to the element **only when the masked
  text differs**, so the caret stays put on ordinary keystrokes, and then calls the caller's
  `onChange`. This is the pattern `SetTargetCashDialog` and `RecountDrawerDialog` already use,
  moved into the component. It works for both `register` and a controlled `value`.
- The component holds no validation state. Validation stays with the form, through
  `decimalRules` (RHF) or `parseDecimal` (controlled). A form that owns its state keeps owning it.
- Added to `/ui-kit`, per the kit-hygiene rule.

---

## 4. Per-form changes

| Form | Today | After |
|---|---|---|
| SetPriceDialog (3 fields) | local regex, rejects `,` and spaces | `DecimalInput` + `decimalRules()`; submit `normalizeAmount` |
| PointFormDialog target_cash | local regex (10 digits), no spaces | `DecimalInput` + `decimalRules({ required: false })` |
| TareTypeDialog weight, deposit | local regexes + `setValueAs` | `DecimalInput` + `decimalRules()`; `setValueAs` removed |
| Payout, Send/Dispute/Resolve transfer, CountDrawer, Recount, SetTargetCash, TopUp | `amountRules(own key)`, some unmasked | `DecimalInput` + `decimalRules()`; semantic checks unchanged |
| Reception gross, pallet, surcharge, paid | mask strips spaces; server-only errors | `DecimalInput`; an invalid non-empty value shows the shared message under the field and is left out of the preview body, the same way an empty value is today. `intakeForm.normalizeDecimal` uses `normalizeAmount`. |
| ExpensesPanel add and edit amount | mask; invalid only disables the button | `DecimalInput`; an invalid non-empty value shows the shared message |
| WeighingForm gross, pallet | no mask; invalid silently counted as 0 | `DecimalInput`; an invalid non-empty value shows the shared message and blocks saving |

Crates inputs (`cratesRules`, ReturnedCratesField, tare units, WeighingForm tare count) are out of
scope and stay as they are.

---

## 5. Testing

- **Unit:** `input.test.ts` / `rules.test.ts` cover the grammar as one table: every row of the
  §1 success table, plus `12  000`, `1 2345`, ` 12 000 `, NBSP and U+202F separators, 8 vs 9
  digits, `1.234`, `-5` with and without `allowNegative`, and `'.'`. Existing cases that expected
  `normalizeAmount` to delete every space are rewritten to the new rule. They are not deleted.
- **Component:** `decimal-input.test.tsx` covers masking, caret-safe no-op writes, `register` and
  controlled use. Each form in §4 gains one case: type `980 40`, submit, and read the shared
  message. `SetPriceDialog` gains `12 000` and `980,40` accepted.
- **Verify:** `npm run verify` (frontend-only change; no build, browser, DB or money-SQL proof
  needed at the gate). The production build is still checked by CI's «Build nginx image».
- **Playwright trace (review aid, not a verify row):** a scratchpad script drives the real app
  (local compose backend plus this branch's frontend) through four of the §4 forms: the price,
  transfer, payout and reception fields. It types the five inputs from the §1 table into each
  and records a trace (`reports/72-money-input/trace.zip`, opened with
  `npx playwright show-trace`) plus a result screenshot. The screenshot is committed under
  `docs/issues/img/` and linked from the issue and the PR. It is not added to `e2e/`: the
  `smoke` row is one path by design.

## 6. Out of scope

- Auto-formatting while typing (inserting the spaces for the user).
- Raising the client cap to the backend's 10 digits.
- Crates and integer fields.
- #77's other hygiene items.

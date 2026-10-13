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

Settled by the owner on 2026-10-12, in review of this spec: **a money or weight field never
holds a space.** Neither of the issue's two options is used. A space is not a thousands
separator (point 1), and it is not silently ignored at submit either (the old behaviour). The
field drops it the moment it is typed or pasted. What the operator sees in the field is exactly
what gets saved, so «980 40» can no longer hide a hundred-fold error. It shows as `98040`, in
plain sight, before submit.

### Success

| Typed or pasted | Field shows | Saved |
|---|---|---|
| `12 000` | `12000` | 12 000,00 |
| `1 234 567,50` | `1234567.50` | 1 234 567,50 |
| `980,40` / `980.40` | `980.40` | 980,40 |
| `980 40` | `98040`, visibly, with no hidden conversion | whatever the field shows |
| `12 000` copied from the app (U+202F) | `12000` | 12 000,00 |
| `abc` | letters never get in | — |
| `1,234`, `12,000.00` (a second separator), `123456789` | `1.234`, `12.000.00`, `123456789` — **kept, never cut** | refused with the shared message |
| empty, `.`, `12.` at submit | refused with the shared message | — |

The mask removes only characters that cannot belong to a number. It never drops a digit or a
separator: cutting `12,000.00` to `12.00` or a 9th digit away would be the same silent
hundred- or thousand-fold change, found in review (2026-10-12). The format message appears once
the operator leaves the field (`useDecimalField`, review of #233), not mid-keystroke on `980.`; a blocked button
stays live.

This amends the issue's criterion «"980 40" відхиляється». The aim behind it, «a stray space
must not change the sum a hundredfold without anyone seeing», is met by making the space
impossible rather than refused.

The forms: day price, point target (point card and «Наділ каси»), tare, reception (gross,
pallet, surcharge, «Видано готівкою»), payout, transfer (send, dispute, resolve), drawer count
(open, close, recount), top-up, day expenses, reweigh. Crates fields (integers) do not change.
Already-saved amounts display as before (`format.ts` is not touched).

---

## 2. The rule

One grammar, in `shared/lib/money/input.ts`. It applies to the field's text after every
whitespace character has been removed:

```
^-?  \d{1,8}  ( [.,] \d{1,2} )?  $
```

- At most **8 integer digits and 2 decimals**, for every field. This is the old `DECIMAL_INPUT`'s limit.
  Prices and weights mirror the backend exactly. For cash columns it is two digits narrower
  than the backend's 10, on purpose: `input.ts` already says that 99 999 999,99 ₴ is never a
  real figure, and an extra zero there is usually a slip of the finger. `PointFormDialog` and
  the tare deposit drop from 10 to 8, which brings them into line.
- A negative sign is allowed only where the field opts in. Reception's surcharge is the only
  field that does, mirroring the backend's `bonus`.
- `12.` and a bare `.` are refused at submit. The typing mask may hold them mid-keystroke.

### API (`shared/lib/money`)

| Export | Behaviour |
|---|---|
| `parseDecimal(raw, { allowNegative? })` → `string \| null` | The canonical dot form (`'980,40'` → `'980.40'`), or `null` when the rule refuses it. This is the one place the grammar lives. It also strips whitespace, as a defence for values that did not come through the mask, such as a default value. |
| `normalizeAmount(raw)` | **Deleted** (review of #233). `decimalRules`' `setValueAs` already stores the canonical form, so the submit-time second pass had nothing left to do. |
| `DECIMAL_INPUT` | **Deleted.** Every gate that tested it now calls `parseDecimal`, which validates and canonicalises in one call (automated review of #233). |
| `maskDecimalInput(raw, { allowNegative? })` | **Changed.** Keeps digits, separators (comma → dot) and an opted-in leading minus; drops whitespace of every kind and letters. It no longer cuts the fraction or drops a second separator — those stay visible and `parseDecimal` refuses them. |
| `decimalRules({ required?, allowNegative? })` | **Replaces `amountRules(key)`.** Returns `{ required, validate, setValueAs }` as an RHF rule, always using the single key `errors.decimalFormat`. Taking no key is the point: a form cannot ask for a different message. `setValueAs` stores `parseDecimal`'s canonical form, or a refused text as typed so `validate` still refuses it. A submit sends `values.x` as it is. |
| `cratesRules` | Unchanged. |

### The one message

The `errors.decimalFormat` key:
- uk: «Введіть число, напр. 12000 або 980,40»
- en: «Enter a number, e.g. 12000 or 980.40»

The same key serves the «empty» case of a required field, as `amountRules` does today. The
per-form format keys this replaces are deleted: `prices.errors.priceFormat`,
`points.errors.cashFormat`, `catalog.errors.weightFormat`, `catalog.errors.depositFormat`,
`payout.errors.amountFormat`, `transfer.errors.cashFormat`, `pointTarget.errors.cashFormat`,
`day.errors.countFormat`, `recount.errors.amount` and `topUp.errors.amountFormat`.

Reception's server-mapped shape errors move to the same key (§4). `reception.errors.paidFormat`
stays only for `PAYOUT_AMOUNT_ZERO`. Semantic
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
- Added to `/ui-kit`, per the kit-hygiene rule. The demo uses real locale keys only, so the page's `plain-text` exemption count does not move.

### The controlled-field hook — `shared/ui/use-decimal-field.ts` (review of #233)

```tsx
const amount = useDecimalField(value, { allowNegative?, errorId?, onBlur? });
// → { parsed, error, isMalformed, inputProps }
<DecimalInput {...a11y} {...amount.inputProps} value={value} onChange={…} />
<Field … error={amount.error ?? serverError} />
```

A controlled form (reception, expenses, reweigh) used to assemble five or six pieces by hand:
- the focus state;
- the condition «non-empty, refused, not focused», written four times under four names;
- `allowNegative` twice, once for the mask and once for the grammar;
- the aria wiring outside a `Field`;
- an `onBlur` glued onto the focus handler.

The hook owns all of these. `error` waits until the field is left, while `isMalformed` does not wait, so a button can refuse at once. `aria-*` is set only with an `errorId`, because inside a `Field` the `Field` owns it and a second, `undefined` copy would overwrite a server error.

`register()` fields keep `decimalRules()`. Their message timing is react-hook-form's (on submit, then live). A controlled field's timing is «once left».

---

## 4. Per-form changes

| Form | Today | After |
|---|---|---|
| SetPriceDialog (3 fields) | local regex, rejects `,` and spaces | `DecimalInput` + `decimalRules()`; submit `values.x` as is |
| PointFormDialog target_cash | local regex (10 digits), no spaces | `DecimalInput` + `decimalRules({ required: false })` |
| TareTypeDialog weight, deposit | local regexes + `setValueAs` | `DecimalInput` + `decimalRules()`; `setValueAs` removed |
| Payout, Send/Dispute/Resolve transfer, CountDrawer, Recount, SetTargetCash, TopUp | `amountRules(own key)`, some unmasked | `DecimalInput` + `decimalRules()`; semantic checks unchanged |
| Reception gross, pallet, surcharge, paid | mask; server-only shape errors (`reception.errors.decimalFormat` / `paidFormat`) | `DecimalInput`. Lines are still sent to the preview verbatim (the index correspondence `apiErrorToFields` relies on). The server's class-validator shape errors on these four fields map to `errors.decimalFormat`. «Видано готівкою», which is never sent while invalid, shows `errors.decimalFormat` client-side when non-empty and unparsable, and «Прийняти» refuses to submit — otherwise the receipt would be recorded without the payout. `reception.errors.decimalFormat` is deleted; `paidFormat` stays for `PAYOUT_AMOUNT_ZERO` only |
| ExpensesPanel add and edit amount | mask; invalid only disables the button | `DecimalInput`; an invalid non-empty value shows the shared message |
| WeighingForm gross, pallet | no mask; invalid silently counted as 0 | `DecimalInput`; an invalid non-empty value shows the shared message and blocks saving |

Crates inputs (`cratesRules`, ReturnedCratesField, tare units, WeighingForm tare count) are out of
scope and stay as they are.

---

## 5. Testing

- **Unit:** `input.test.ts` / `rules.test.ts` cover the grammar and the mask as one table: every
  row of the §1 success table, plus NBSP and U+202F, 8 vs 9 digits, `1.234`, `-5` with and
  without `allowNegative`, and `'.'`.
- **Component:** `decimal-input.test.tsx` covers masking, caret-safe no-op writes, `register` and
  controlled use. Each form in §4 gains one case: type `980 40` and see `98040` in the
  field; submit `12.` and read the shared message. `SetPriceDialog` gains `12 000` and `980,40`
  accepted.
- **Verify:** `npm run verify` (frontend-only change; no build, browser, DB or money-SQL proof
  needed at the gate). The production build is still checked by CI's «Build nginx image».
- **Playwright trace (review aid, not a verify row):** a scratchpad script drives the real app
  (local compose backend plus this branch's frontend) through four of the §4 forms: the price,
  transfer, payout and reception fields. It types the §1 table's inputs into each
  and records a trace (`reports/72-money-input/trace.zip`, opened with
  `npx playwright show-trace`) plus a result screenshot. The screenshot is committed under
  `docs/issues/img/` and linked from the issue and the PR. It is not added to `e2e/`: the
  `smoke` row is one path by design.

## 6. Out of scope

- Showing thousands grouping inside the field (the field never holds a space).
- Raising the client cap to the backend's 10 digits.
- Crates and integer fields, with one exception from the review of #233: reception's tare count. It reached the body through `parseInt`, which read «1 2» as 1, «12abc» as 12 and «2,5» as 2. That is the same silent change of a number this ticket removes, because the tare decides the net weight and therefore the sum. The count now takes the money mask (spaces and letters never get in, a separator stays visible) and its own grammar, `parseCrateCount` (`''` is 0, a whole number of up to 7 digits is itself, anything else is refused). A count that is not whole («0,5», «2,0») is refused under the tare at once with `crates.errors.unitsFormat`, and the preview is not asked while it stands; every reader of the field (stepper, totals, the body) goes through the same function. `returned_crates` keeps its own `\D` strip and `parseCount` until the follow-up below.
- Unifying the four ways integer fields are written today (`cratesRules`, WeighingForm's keystroke filter, `ReturnedCratesField`'s `\D` strip, PointFormDialog's `INTEGER`). This is a follow-up.
- #77's other hygiene items.

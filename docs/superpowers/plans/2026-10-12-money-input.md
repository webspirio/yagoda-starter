# One money input (#72) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every money and weight field takes the same text, refuses the same text with the same
message, and never holds a space, through one shared `DecimalInput` + `parseDecimal` + `decimalRules`.

**Architecture:** The grammar lives once in `shared/lib/money/input.ts` (`parseDecimal`). The
typing mask (`maskDecimalInput`) keeps whitespace out of the field. `decimalRules()` is the RHF
rule with a fixed message key. `shared/ui/decimal-input.tsx` wraps `TextInput` and applies the
mask on every change, for both `register` and controlled use. Each form swaps its local regex or
`amountRules(key)` for these.

**Tech Stack:** React 19, react-hook-form, Vitest + Testing Library (`user-event`), i18next.

**Spec:** `docs/superpowers/specs/2026-10-12-money-input-design.md`

## Global Constraints

- Grammar, applied after every whitespace char is removed: `^-?\d{1,8}([.,]\d{1,2})?$`. The minus
  sign is allowed only with `allowNegative` (reception surcharge only).
- A money or weight field never holds a space: the mask drops it on type and on paste.
- One message key for every format and empty-required failure: `errors.decimalFormat`.
  - uk: «Введіть число, напр. 12000 або 980,40»
  - en: «Enter a number, e.g. 12000 or 980.40»
- Semantic messages stay per form (`amountZero`, `exceedsDebt`, `amountPositive`, overCap and the
  like).
- Crates and integer fields are not touched (`cratesRules`, `CRATES_INPUT`, `ReturnedCratesField`,
  tare units, the WeighingForm tare count).
- `format.ts` is not touched.
- No user-visible literal outside the locale files (the `plain-text` verify row). Every key exists
  in both `uk.json` and `en.json` (the `locales` row).
- Frontend tests: `npm test -w frontend -- <path>`. Lint: `npm run lint -w frontend`.
  Type-check: `npx tsc -b frontend` (the test and lint runs skip `tsc`).

## Review Focus

1. A value pasted from the app's own formatting (`12 000,00` with U+202F) lands as `12000.00`. Pinned in Task 1 (mask) and Task 2 (paste).
2. A form whose default value arrives from the server canonical (`'1500.00'`, Resolve's `reported_cash`, Payout's debt) still passes validation untouched. Pinned in Task 3.
3. Typing a 9th integer digit is cut by the mask, so the field cannot hold a value it will then refuse. Pinned in Task 1.
4. An optional field (point `target_cash`) accepts empty and still refuses `12.`. Pinned in Task 4.
5. Reception surcharge keeps its minus sign through the shared component. Pinned in Task 5.

---

### Task 1: Grammar, mask cap, rule and message (`shared/lib/money`)

**Files:**
- Modify: `frontend/src/shared/lib/money/input.ts`
- Modify: `frontend/src/shared/lib/money/rules.ts`
- Modify: `frontend/src/shared/lib/money/index.ts`
- Modify: `frontend/src/shared/lib/i18n/locales/uk.json`, `en.json` (top-level `errors` namespace)
- Test: `frontend/src/shared/lib/money/input.test.ts`, `rules.test.ts`

**Interfaces:**
- Produces:
  - `parseDecimal(raw: string, opts?: { allowNegative?: boolean }): string | null`
  - `decimalRules(opts?: { required?: boolean; allowNegative?: boolean }): { required: string | false; validate: (v: string) => true | string }`
  - the `errors.decimalFormat` key
  - `maskDecimalInput`, which now caps the integer part at 8 digits
- `amountRules` stays exported for now. Task 3 removes it.

- [ ] **Step 1: Write failing tests** in `input.test.ts`:

```ts
describe('parseDecimal', () => {
  it.each([
    ['12000', '12000'],
    ['12 000', '12000'],
    ['1 234 567,50', '1234567.50'],
    ['980,40', '980.40'],
    ['980.40', '980.40'],
    ['980 40', '98040'],
    ['12 000,00', '12000.00'],
    ['12 000', '12000'],
    [' 7 ', '7'],
    ['99999999.99', '99999999.99'],
  ])('accepts %j as %s', (raw, out) => {
    expect(parseDecimal(raw)).toBe(out);
  });
  it.each(['', '.', '12.', '1.234', 'abc', '123456789', '1,2,3', '-5'])('refuses %j', (raw) => {
    expect(parseDecimal(raw)).toBeNull();
  });
  it('allows a minus only when asked', () => {
    expect(parseDecimal('-5,5', { allowNegative: true })).toBe('-5.5');
  });
});
```

Add to the existing `maskDecimalInput` describe:

```ts
  it('never lets a space of any kind into the field', () => {
    expect(maskDecimalInput('12 000')).toBe('12000');
    expect(maskDecimalInput('980 40')).toBe('98040');
    expect(maskDecimalInput('12 000,00')).toBe('12000.00');
  });
  it('caps the integer part at 8 digits', () => {
    expect(maskDecimalInput('123456789')).toBe('12345678');
    expect(maskDecimalInput('123456789,5')).toBe('12345678.5');
  });
```

In `rules.test.ts`, add:

```ts
describe('decimalRules', () => {
  it('uses the one shared key for required and for the shape', () => {
    const rules = decimalRules();
    expect(rules.required).toBe('errors.decimalFormat');
    expect(rules.validate('12.')).toBe('errors.decimalFormat');
    expect(rules.validate('')).toBe('errors.decimalFormat');
    expect(rules.validate('12 000')).toBe(true);
    expect(rules.validate('980,40')).toBe(true);
  });
  it('lets an optional field be empty but not malformed', () => {
    const rules = decimalRules({ required: false });
    expect(rules.required).toBe(false);
    expect(rules.validate('')).toBe(true);
    expect(rules.validate('  ')).toBe(true);
    expect(rules.validate('12.')).toBe('errors.decimalFormat');
  });
  it('allows a minus only when asked', () => {
    expect(decimalRules().validate('-5')).toBe('errors.decimalFormat');
    expect(decimalRules({ allowNegative: true }).validate('-5')).toBe(true);
  });
});
```

- [ ] **Step 2: Run** `npm test -w frontend -- src/shared/lib/money`. Expected: FAIL (`parseDecimal` and `decimalRules` are not exported; the mask cap fails).

- [ ] **Step 3: Implement.** In `input.ts`, after `CRATES_INPUT`:

```ts
const DECIMAL_SHAPE = /^(-?)(\d{1,8})(?:[.,](\d{1,2}))?$/;

/**
 * THE grammar of a money or weight field (#72): whitespace of any kind removed
 * (the field's mask never lets it in; this is the backstop for a default value
 * or a paste that bypassed the mask), then up to 8 integer digits, comma or dot,
 * up to 2 decimals. Returns the canonical dot form, or `null` when refused.
 */
export function parseDecimal(
  raw: string,
  { allowNegative = false }: { allowNegative?: boolean } = {},
): string | null {
  const match = DECIMAL_SHAPE.exec(raw.replace(/\s/g, ''));
  if (!match || (match[1] === '-' && !allowNegative)) return null;
  const [, sign, int, frac] = match;
  return `${sign}${int}${frac === undefined ? '' : `.${frac}`}`;
}
```

In `maskDecimalInput`, change the int line so the integer part is capped. Update its doc comment
to say «at most 8 integer digits; whitespace of any kind never gets in (#72)»:

```ts
  const [rawInt, frac = ''] = body.split('.');
  const int = rawInt.slice(0, 8);
```

In `rules.ts`, add the following, change the `MoneyFieldRules.required` type to `string | false`,
and keep `amountRules` / `cratesRules` as they are:

```ts
/**
 * The ONE rule every money or weight `register()` field uses (#72). It takes no
 * message key on purpose: the message is the same on every form, so a form
 * cannot ask for a different one. Semantic checks (> 0, ≤ debt) stay in the
 * form and keep their own keys.
 */
export function decimalRules({
  required = true,
  allowNegative = false,
}: { required?: boolean; allowNegative?: boolean } = {}): MoneyFieldRules {
  return {
    required: required ? 'errors.decimalFormat' : false,
    validate: (value: string) =>
      (!required && value.trim() === '') ||
      parseDecimal(value, { allowNegative }) !== null ||
      'errors.decimalFormat',
  };
}
```

Export `parseDecimal` and `decimalRules` from `index.ts`. Add `"decimalFormat"` to the top-level
`errors` object in both locale files, with the texts from Global Constraints.

- [ ] **Step 4: Run** `npm test -w frontend -- src/shared/lib/money`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(money): parseDecimal, decimalRules and the one format message (#72)`.

### Task 2: `DecimalInput` component

**Files:**
- Create: `frontend/src/shared/ui/decimal-input.tsx`, `frontend/src/shared/ui/decimal-input.test.tsx`
- Modify: `frontend/src/pages/ui-kit/ui/UiKitPage.tsx` (one demo next to the other inputs)

**Interfaces:**
- Consumes: `maskDecimalInput` from Task 1.
- Produces: `DecimalInput` (a `forwardRef` to `HTMLInputElement`) with props
  `Omit<TextInputProps, 'type' | 'inputMode'> & { allowNegative?: boolean }`.

- [ ] **Step 1: Failing test** `decimal-input.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DecimalInput } from './decimal-input';
import { decimalRules } from '@/shared/lib/money';

function Controlled({ allowNegative }: { allowNegative?: boolean }) {
  const [v, setV] = useState('');
  return <DecimalInput aria-label="sum" value={v} allowNegative={allowNegative} onChange={(e) => setV(e.target.value)} />;
}

function Registered({ onValid }: { onValid: (v: string) => void }) {
  const { register, handleSubmit, formState } = useForm({ defaultValues: { amount: '' } });
  return (
    <form onSubmit={handleSubmit((d) => onValid(d.amount))}>
      <DecimalInput aria-label="sum" {...register('amount', decimalRules())} />
      <span>{formState.errors.amount?.message}</span>
      <button type="submit">go</button>
    </form>
  );
}

describe('DecimalInput', () => {
  it('is a decimal text field', () => {
    render(<Controlled />);
    const input = screen.getByLabelText('sum');
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveAttribute('inputmode', 'decimal');
  });
  it('never holds a space — typed or pasted', async () => {
    render(<Controlled />);
    const input = screen.getByLabelText('sum');
    await userEvent.type(input, '980 40');
    expect(input).toHaveValue('98040');
    await userEvent.clear(input);
    await userEvent.click(input);
    await userEvent.paste('12 000,00');
    expect(input).toHaveValue('12000.00');
  });
  it('drops a minus unless allowNegative', async () => {
    const { unmount } = render(<Controlled />);
    await userEvent.type(screen.getByLabelText('sum'), '-5');
    expect(screen.getByLabelText('sum')).toHaveValue('5');
    unmount();
    render(<Controlled allowNegative />);
    await userEvent.type(screen.getByLabelText('sum'), '-5');
    expect(screen.getByLabelText('sum')).toHaveValue('-5');
  });
  it('works with register: masked value submits, a half-typed one shows the shared key', async () => {
    const seen: string[] = [];
    render(<Registered onValid={(v) => seen.push(v)} />);
    const input = screen.getByLabelText('sum');
    await userEvent.type(input, '12.');
    await userEvent.click(screen.getByRole('button', { name: 'go' }));
    expect(await screen.findByText('errors.decimalFormat')).toBeInTheDocument();
    await userEvent.type(input, '5');
    await userEvent.click(screen.getByRole('button', { name: 'go' }));
    expect(seen).toEqual(['12.5']);
  });
});
```

- [ ] **Step 2: Run** `npm test -w frontend -- src/shared/ui/decimal-input`. Expected: FAIL (the module is not found).
- [ ] **Step 3: Implement** `decimal-input.tsx`:

```tsx
import * as React from 'react';
import { maskDecimalInput } from '@/shared/lib/money';
import { TextInput, type TextInputProps } from './text-input';

export interface DecimalInputProps extends Omit<TextInputProps, 'type' | 'inputMode'> {
  /** Lets a leading minus through the mask — reception's surcharge only. */
  allowNegative?: boolean;
}

/**
 * The ONE money/weight field (#72). The mask runs on every change, typed or
 * pasted, so the field never holds a space, a letter or a second separator.
 * What the operator sees is exactly what gets saved. It writes the masked text
 * back only when it differs, so ordinary keystrokes keep the caret, then hands
 * the event on, so it works with RHF `register` and with a controlled `value`
 * alike. Validation is the form's: `decimalRules()` or `parseDecimal`.
 */
export const DecimalInput = React.forwardRef<HTMLInputElement, DecimalInputProps>(
  function DecimalInput({ allowNegative = false, onChange, ...props }, ref) {
    return (
      <TextInput
        ref={ref}
        autoComplete="off"
        {...props}
        type="text"
        inputMode="decimal"
        onChange={(e) => {
          const masked = maskDecimalInput(e.target.value, { allowNegative });
          if (masked !== e.target.value) e.target.value = masked;
          onChange?.(e);
        }}
      />
    );
  },
);
```

Add a `DecimalInput` demo in `UiKitPage.tsx`, next to the existing `TextInput` demo, following
its labelling pattern.

- [ ] **Step 4: Run** the test. Expected: PASS. Then run `npx tsc -b frontend`.
- [ ] **Step 5: Commit** `feat(ui): DecimalInput — the one money/weight field (#72)`.

### Task 3: Feature dialogs onto `DecimalInput` + `decimalRules`; remove `amountRules`

**Files (modify each one along with its `*.test.tsx`):**
- `frontend/src/features/settle-payout/ui/PayoutDialog.tsx` (`amount`)
- `features/send-transfer/ui/SendTransferDialog.tsx` (`cash`)
- `features/receive-transfer/ui/DisputeTransferDialog.tsx` (`reported_cash`)
- `features/resolve-transfer/ui/ResolveTransferDialog.tsx` (`resolved_cash`)
- `features/set-point-target/ui/SetTargetCashDialog.tsx` (`target_cash`)
- `features/count-shift/ui/CountDrawerDialog.tsx` (`amount`), `RecountDrawerDialog.tsx` (`amount`)
- `features/top-up-intake/ui/TopUpDialog.tsx` (`amount`)
- `shared/lib/money/rules.ts`, `rules.test.ts`, `index.ts` (delete `amountRules`)

**Interfaces:** Consumes `DecimalInput` and `decimalRules`, both from Tasks 1–2.

- [ ] **Step 1: Failing tests.** In each dialog's test file, add a case in that file's own style,
  rendering the dialog the way its neighbouring cases do:

```tsx
it('never holds a space and refuses a half-typed sum with the shared message (#72)', async () => {
  // render as the file's other cases do; `input` = the money field by its label
  await userEvent.clear(input);
  await userEvent.type(input, '980 40');
  expect(input).toHaveValue('98040');
  await userEvent.clear(input);
  await userEvent.type(input, '12.');
  await userEvent.click(submitButton);
  expect(await screen.findByText(<uk or en text of errors.decimalFormat as the file's i18n setup renders>)).toBeInTheDocument();
});
```

Rewrite the existing cases that typed spaces into the field so they expect the masked value:
`CountDrawerDialog.test.tsx:50` (`'1 500,50'` → field `1500.50`, onConfirm `'1500.50'`) and
`RecountDrawerDialog.test.tsx:51`. Rewrite any assertion on the old per-form format text to
the shared text.

- [ ] **Step 2: Run** `npm test -w frontend -- src/features`. Expected: the new cases FAIL.
- [ ] **Step 3: Implement.** In each dialog:
  - Replace `<TextInput … inputMode="decimal" {...register('x', amountRules('<ns>.errors.<key>'))} />`
    with `<DecimalInput … {...register('x', decimalRules())} />`.
  - Drop the now-redundant `inputMode` and `autoComplete` props.
  - In `SetTargetCashDialog` and `RecountDrawerDialog`, delete the hand-written
    `onChange` override that called `maskDecimalInput`. Spread the `register` result straight into
    `DecimalInput`.
  - In `TopUpDialog`, keep the override that checks `> 0`, but build it on
    `decimalRules().validate`. In `PayoutDialog`, keep the `> 0` and `≤ debt` checks.
  - Delete `amountRules` and its tests from `rules.ts`, `rules.test.ts` and `index.ts`.
    `git grep amountRules frontend/src` must return nothing.
  - **Do not edit the locale files.** Report each old key that no longer has any reference
    (`git grep -n '<key>' frontend/src`). The controller deletes them.
- [ ] **Step 4: Run** `npm test -w frontend -- src/features src/shared`, then `npx tsc -b frontend`. Expected: PASS.
- [ ] **Step 5: Commit** `refactor(money): every feature dialog on DecimalInput + decimalRules (#72)`.

### Task 4: Pages with local regexes — prices, points, tare

**Files (modify each one along with its test):**
- `frontend/src/pages/prices/ui/SetPriceDialog.tsx`: `base_price`, `max_markup`, `max_discount`. Delete the local `DECIMAL`. Submit `normalizeAmount(values.x)` instead of `.trim()`.
- `pages/points/ui/PointFormDialog.tsx`: `target_cash`. Delete the local `DECIMAL`. Use `decimalRules({ required: false })`. Submit the empty value as `null`, otherwise `normalizeAmount`. `target_crates` is untouched.
- `pages/catalog/ui/TareTypeDialog.tsx`: `weight_kg`, `deposit_price`. Delete `WEIGHT_PATTERN`, `DEPOSIT_PATTERN` and `setValueAs`. Normalize with `normalizeAmount` at submit.

- [ ] **Step 1: Failing tests:**
  - SetPriceDialog:
    - `12 000` typed → the field shows `12000` and submits `'12000'`.
    - `980,40` submits `'980.40'`.
    - `12.` → shared message, no request.
  - PointFormDialog:
    - an empty target saves `null`.
    - `12.` → shared message.
    - `15 000,50` submits `'15000.50'`.
  - TareTypeDialog:
    - `1,2` weight submits `'1.2'`.
    - `12.` → shared message.
- [ ] **Step 2: Run** `npm test -w frontend -- src/pages/prices src/pages/points src/pages/catalog`. Expected: FAIL.
- [ ] **Step 3: Implement** the replacements listed above. **Do not edit the locale files.** Report the keys that became unreferenced (`prices.errors.priceFormat`, `points.errors.cashFormat`, `catalog.errors.weightFormat`, `catalog.errors.depositFormat`), checking that `apiErrorToFields` no longer uses any of them first.
- [ ] **Step 4: Run** the tests and `npx tsc -b frontend`. Expected: PASS.
- [ ] **Step 5: Commit** `refactor(money): prices, points and tare on DecimalInput (#72)`.

### Task 5: Reception

**Files (modify each one along with its test):**
- `frontend/src/pages/reception/ui/LineEditor.tsx`:
  - `gross_kg` and `pallet_kg` become `DecimalInput`; `onChange` is `setValue(…, e.target.value, …)`, since the mask has already run.
  - `bonus` becomes `DecimalInput allowNegative`. Keep `variant="ghost"`, the clamp on blur and the stepper.
- `pages/reception/ui/TotalsSection.tsx`:
  - paid becomes `DecimalInput`.
  - When `paid.trim() !== ''` and `parseDecimal(paid) === null`, pass `error="errors.decimalFormat"` to its `Field`. The amber over-cap hint stays.
- `pages/reception/model/intakeForm.ts`: `normalizeDecimal` uses `normalizeAmount`, which also covers a stray NBSP.
- `pages/reception/lib/apiErrorToFields.ts`: shape `details` on any field map to `'errors.decimalFormat'`, paid included. `PAID_FIELD.PAYOUT_AMOUNT_ZERO` keeps `reception.errors.paidFormat`.

- [ ] **Step 1: Failing tests** (in the existing `LineEditor`, `TotalsSection` and `apiErrorToFields` tests):
  - gross typed `1 200,5` → `1200.5`.
  - bonus typed `-2` → `-2`.
  - paid `12.` → the shared message is shown.
  - `apiErrorToFields` maps a 400 detail on `items.0.gross_kg` to `errors.decimalFormat`.
- [ ] **Step 2: Run** `npm test -w frontend -- src/pages/reception`. Expected: FAIL.
- [ ] **Step 3: Implement** as listed. **Do not edit the locale files.** Report whether `reception.errors.decimalFormat` is now unreferenced.
- [ ] **Step 4: Run** the reception tests and `npx tsc -b frontend`. Expected: PASS.
- [ ] **Step 5: Commit** `refactor(money): reception fields on DecimalInput, one shape message (#72)`.

### Task 6: Day expenses and reweigh

**Files (modify each one along with its test):**
- `frontend/src/pages/cost-of-day/ui/ExpensesPanel.tsx`:
  - the add and edit amounts become `DecimalInput`.
  - `isAmount = (v) => parseDecimal(v) !== null`.
  - When the amount is non-empty and invalid, wrap or annotate it so `errors.decimalFormat` shows. Use the `Field` `error` prop if the input already sits in a `Field`. Otherwise add a `<p role="alert">` with `t('errors.decimalFormat')`, styled like `Field`'s error.
  - Send `parseDecimal(v)` rather than the raw text.
- `pages/reweigh/ui/WeighingForm.tsx`:
  - gross and pallet become `DecimalInput`.
  - `toCalcAmount` uses `parseDecimal(raw) ?? '0.00'`.
  - A non-empty invalid value shows `errors.decimalFormat` under its field and blocks save. Follow the form's existing `block` mechanism: add a block reason that maps to `errors.decimalFormat`.
  - The tare count is untouched.
- [ ] **Step 1: Failing tests:**
  - ExpensesPanel: `12.` shows the shared message and keeps add disabled; `1 500` is added as `'1500'`.
  - WeighingForm: gross `12.` shows the shared message and blocks save; `1 200,5` computes as `1200.50`.
- [ ] **Step 2: Run** `npm test -w frontend -- src/pages/cost-of-day src/pages/reweigh`. Expected: FAIL.
- [ ] **Step 3: Implement.** **Do not edit the locale files.**
- [ ] **Step 4: Run** the tests and `npx tsc -b frontend`. Expected: PASS.
- [ ] **Step 5: Commit** `refactor(money): expenses and reweigh on DecimalInput (#72)`.

### Task 7 (controller): Locale cleanup, gate, evidence, hand-off

- [ ] Delete the old keys reported in Tasks 3–6 from both `uk.json` and `en.json`, once `git grep` confirms they are unreferenced. Commit.
- [ ] Check that no local copies remain: `git grep -nE "\\\\d\{1,(8|10)\}\(\\\\\.\\\\d\{1,2\}\)" frontend/src -- ':!*.test.*'` hits only `input.ts`, and `git grep -n "inputMode=\"decimal\"" frontend/src` hits only `decimal-input.tsx`.
- [ ] Run `npm run verify`, then `npm run build -w frontend` (see the frontend-gate-needs-build memory) and `rm -rf frontend/dist`.
- [ ] Run a fresh-context code review (superpowers:requesting-code-review) and fix what it finds.
- [ ] Run the Playwright script (scratchpad, not `e2e/`) against the local backend plus this branch's frontend:
  - it covers the price, transfer, payout, reception and expenses fields;
  - it types the spec §1 inputs into each;
  - it records a trace to `reports/72-money-input/trace.zip` and a result screenshot.
- [ ] Commit the screenshot to `docs/issues/img/72-result.png`. Comment on #72 and PR #233 with it, then run `gh pr ready 233`.

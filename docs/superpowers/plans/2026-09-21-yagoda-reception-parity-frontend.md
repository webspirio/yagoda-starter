# «Прийомка» parity — PR 2 (frontend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The reception screen looks and behaves like the mock's «Прийомка ягоди» on a laptop: the mock's searchable supplier picker with the §2.11 marker hint, the mock's form ergonomics (masks, auto-pallet, instant hints, clamped surcharge), «4 · Розрахунок» with «РАЗОМ ДО ВИДАЧІ» and «Видано готівкою» written with the receipt, the «Стан точки» panel and richer today's receipts on the right, and a receipt that says what was paid.

**Architecture:** Two new features — `features/pick-supplier` (a hand-rolled, dependency-free combobox: the bundle budget has no room for cmdk + a popover) and `features/edit-supplier` (the existing supplier form lifted out of `pages/suppliers` so the picker can create a person inline). `pages/reception` keeps its shape (RHF form, live server preview) and gains a `paid_amount` field; `widgets/receipt` prints the linked payouts and drops its own payout button. Every number still comes from the server; the only client arithmetic is display totalling through `shared/lib/money`.

**Tech Stack:** React 19, react-hook-form, TanStack Query, Tailwind v4 + the repo's `shared/ui` kit, i18next (`uk` default), Vitest + Testing Library + vitest-axe.

**Spec:** `docs/superpowers/specs/2026-09-21-yagoda-reception-parity.md` §3; audit lines: `docs/superpowers/specs/2026-09-17-yagoda-mock-parity-audit.md` «Audit 1 — Прийомка» items 1–56. Backend contract: PR 1 (`…-backend.md`) must be merged into this branch first (it is — same branch).

## Global Constraints

- FSD import direction only: `shared < entities < features < widgets < pages < app` (ESLint enforces). A feature never imports another feature; a page composes them.
- **No new npm dependency.** `bundle` reports the budget is within one ordinary commit of red; the picker is built from `shared/ui` primitives and plain DOM.
- Copy is Ukrainian in `uk.json` and English in `en.json`, always both, via `t()` keys; the mock's exact Ukrainian wording where the spec quotes it. Never show surcharge bounds to the operator (§2.10, #117).
- Money and weight values are STRINGS; client arithmetic only through `shared/lib/money` (`add`, `sub`, `sum`, `cmp`, `div`, `mulInt` added here). No `Number()` on a money string except inside the money seam.
- React Compiler lint: no `setState` directly inside an effect body, no refs read during render; derive during render instead (memory `react-compiler-lint-bans-effects`).
- Controls keep the kit's 46 px height; weight and money inputs carry `inputMode="decimal"`.
- Laptop-first: two columns from `lg` (1024 px); below that a single column, the right column after the form.
- Verification: `npm run verify` after every task (fast tier; it runs the frontend suite), `npm run verify:full` once at the end (build + bundle). Report verdict lines; name skips.
- Commit after every task with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. No push, no PR — the owner reviews in the two-window comparison first (`scripts/compare-with-mock.sh` from the docs branch; the MAIN worktree must have `feat/reception-parity` checked out for the left window).
- Test fixtures: any test that builds an `Intake` literal must gain the four new row fields (Task 1 lists the files).

---

### Task 1: Wire types — `Intake` rows, `IntakeDetail`, `Payout.intake_id`

**Files:**
- Modify: `frontend/src/entities/intake/model/intake.ts`
- Modify: `frontend/src/entities/intake/index.ts`
- Modify: `frontend/src/entities/payout/model/payout.ts`
- Modify (fixtures): every test that builds an `Intake` — find them with `grep -rln "received_by_user_id:" frontend/src --include=*.test.tsx --include=*.test.ts` (today: `pages/reception/ui/ReceptionPage.test.tsx`, `pages/day/ui/DayPage.test.tsx`, `pages/journal/**`, `pages/supplier-card/**`, `pages/dashboard/api/useNetworkToday.test.tsx`, `widgets/receipt/ui/ReceiptDialog.test.tsx`, `pages/point-cash/**` — trust the grep, not this list).

**Interfaces:**
- Produces:

```ts
export interface Intake {
  // …existing…
  /** Σ items.net_kg, a decimal string — the row can show kilograms. */
  net_kg: string;
  lines_count: number;
  /** «first last», present even for a deactivated supplier. */
  supplier_name: string;
  /** Σ live payouts handed over with this receipt; '0.00' when none. */
  paid_amount: string;
}
export interface IntakePayout { id: string; code: string; amount: string; voided_at: string | null }
export interface IntakeDetail extends Intake {
  items: IntakeItem[];
  payouts: IntakePayout[];
  received_by_name: string | null;
}
// entities/payout: Payout gains `intake_id: string | null`.
```

- [ ] **Step 1: Add the fields** (code above, with the doc comments; export `IntakePayout` from `entities/intake/index.ts`).

- [ ] **Step 2: Fix the fixtures**

Run: `cd frontend && npx tsc -p tsconfig.app.json --noEmit`
Expected: errors listing every fixture missing the new fields. In each, add `net_kg: '36.90', lines_count: 2, supplier_name: 'Ніна Ільчук', paid_amount: '0.00'` (and for `IntakeDetail` fixtures `payouts: [], received_by_name: 'Оксана Гнатюк'`), until tsc is clean.

- [ ] **Step 3: Run the frontend suite**

Run: `cd frontend && npx vitest run`
Expected: PASS (nothing behavioural changed).

- [ ] **Step 4: Commit**

```bash
git add frontend/src
git commit -m "feat(entities): the intake row's kilograms, lines, supplier name and paid amount

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Money helpers — `maskDecimalInput`, `clampDecimal`, `floorToHundreds`, `mulInt`

**Files:**
- Modify: `frontend/src/shared/lib/money/input.ts`
- Modify: `frontend/src/shared/lib/money/decimal.ts`
- Modify: `frontend/src/shared/lib/money/index.ts`
- Create: `frontend/src/shared/lib/money/input.test.ts` (extend if it exists)
- Modify: `frontend/src/shared/lib/money/decimal.test.ts` (extend)

**Interfaces:**
- Produces:

```ts
/** Keeps what a decimal field may hold WHILE TYPING: digits, one separator
 *  (comma or dot, stored as dot), at most `decimals` places, an optional
 *  leading minus when `allowNegative`. Never adds digits. */
export function maskDecimalInput(raw: string, opts?: { decimals?: number; allowNegative?: boolean }): string;
/** `value` clamped into [min, max]; a malformed value is returned unchanged. */
export function clampDecimal(value: string, min: string, max: string): string;
/** '5497.37' → '5400.00'; '87.50' → '0.00'. */
export function floorToHundreds(value: string): string;
/** decimal × integer count, exact in kopiykas: mulInt('1.20', 3) === '3.60'. */
export function mulInt(value: string, n: number): string;
```

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/shared/lib/money/input.test.ts (add)
import { describe, expect, it } from 'vitest';
import { maskDecimalInput, clampDecimal, floorToHundreds } from './input';

describe('maskDecimalInput', () => {
  it('drops letters and a second separator, keeps two decimals', () => {
    expect(maskDecimalInput('12a,5')).toBe('12.5');
    expect(maskDecimalInput('12.5.6')).toBe('12.56');
    expect(maskDecimalInput('12.345')).toBe('12.34');
  });
  it('allows a leading minus only when asked', () => {
    expect(maskDecimalInput('-5')).toBe('5');
    expect(maskDecimalInput('-5', { allowNegative: true })).toBe('-5');
    expect(maskDecimalInput('--5', { allowNegative: true })).toBe('-5');
  });
  it('lets a half-typed value through untouched', () => {
    expect(maskDecimalInput('12.')).toBe('12.');
    expect(maskDecimalInput('')).toBe('');
  });
});

describe('clampDecimal', () => {
  it('clamps into the range and leaves a malformed value alone', () => {
    expect(clampDecimal('31', '-20', '30')).toBe('30.00');
    expect(clampDecimal('-25', '-20', '30')).toBe('-20.00');
    expect(clampDecimal('5', '-20', '30')).toBe('5.00');
    expect(clampDecimal('12.', '-20', '30')).toBe('12.');
  });
});

describe('floorToHundreds', () => {
  it('rounds DOWN to whole hundreds', () => {
    expect(floorToHundreds('5497.37')).toBe('5400.00');
    expect(floorToHundreds('100.00')).toBe('100.00');
    expect(floorToHundreds('87.50')).toBe('0.00');
  });
});
```

```ts
// frontend/src/shared/lib/money/decimal.test.ts (add)
describe('mulInt', () => {
  it('multiplies by an integer count without a float', () => {
    expect(mulInt('1.20', 3)).toBe('3.60');
    expect(mulInt('0.30', 7)).toBe('2.10');
    expect(mulInt('1.20', 0)).toBe('0.00');
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `cd frontend && npx vitest run src/shared/lib/money` → FAIL (not exported).

- [ ] **Step 3: Implement**

```ts
// input.ts (append)
import { cmp } from './decimal';

export function maskDecimalInput(
  raw: string,
  { decimals = 2, allowNegative = false }: { decimals?: number; allowNegative?: boolean } = {},
): string {
  const negative = allowNegative && raw.trimStart().startsWith('-');
  let seen = false;
  let body = '';
  for (const ch of raw) {
    if (ch >= '0' && ch <= '9') body += ch;
    else if ((ch === '.' || ch === ',') && !seen) {
      seen = true;
      body += '.';
    }
  }
  const [int, frac = ''] = body.split('.');
  const fraction = seen ? `.${frac.slice(0, decimals)}` : '';
  return `${negative ? '-' : ''}${int}${fraction}`;
}

export function clampDecimal(value: string, min: string, max: string): string {
  const normalized = normalizeAmount(value);
  if (!/^-?\d{1,10}(\.\d{1,2})?$/.test(normalized)) return value;
  // Re-canonicalise through add(x, '0') so '5' becomes '5.00' like the server would store it.
  const canonical = add(normalized, '0');
  if (cmp(canonical, min) === -1) return add(min, '0');
  if (cmp(canonical, max) === 1) return add(max, '0');
  return canonical;
}

export function floorToHundreds(value: string): string {
  const int = normalizeAmount(value).split('.')[0].replace(/^-/, '');
  const hundreds = int.length > 2 ? `${int.slice(0, -2)}00` : '0';
  return `${hundreds}.00`;
}
```

(`add` comes from `./decimal`; import it. If `decimal.ts`'s `fromKopiykas`/`toKopiykas` are not exported, export them or implement `mulInt` next to them:)

```ts
// decimal.ts (append)
export const mulInt = (value: string, n: number): string =>
  fromKopiykas(toKopiykas(value) * BigInt(Math.trunc(n)));
```

Export all four from `index.ts`.

- [ ] **Step 4: Run** — `npx vitest run src/shared/lib/money` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(money): maskDecimalInput, clampDecimal, floorToHundreds, mulInt"` (with trailer).

---

### Task 3: `KindBadge` and the §2.11 hint in `entities/supplier`

**Files:**
- Create: `frontend/src/entities/supplier/ui/KindBadge.tsx`
- Create: `frontend/src/entities/supplier/ui/KindBadge.test.tsx`
- Create: `frontend/src/entities/supplier/lib/kindHint.ts`
- Modify: `frontend/src/entities/supplier/index.ts`
- Modify: `frontend/src/shared/lib/i18n/locales/uk.json`, `en.json` (`suppliers.kindBadge.*`, `suppliers.kindHint.*`)

**Interfaces:**
- Produces: `KindBadge({ kind, className })` — renders nothing for `'none'`, a `Badge` `secondary` «ОПТ» for `wholesale`, `outline` «Фермер» for `farmer`. `kindHintKey(kind): string | null` → `'suppliers.kindHint.wholesale' | 'suppliers.kindHint.farmer' | null`.

- [ ] **Step 1: Failing test**

```tsx
// KindBadge.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KindBadge } from './KindBadge';
import { kindHintKey } from '../lib/kindHint';

describe('KindBadge', () => {
  it('renders nothing for a plain supplier', () => {
    const { container } = render(<KindBadge kind="none" />);
    expect(container).toBeEmptyDOMElement();
  });
  it('labels wholesale and farmer', () => {
    render(<KindBadge kind="wholesale" />);
    expect(screen.getByText(/suppliers\.kindBadge\.wholesale|ОПТ/)).toBeInTheDocument();
  });
  it('hints only for the two marked kinds', () => {
    expect(kindHintKey('none')).toBeNull();
    expect(kindHintKey('wholesale')).toBe('suppliers.kindHint.wholesale');
    expect(kindHintKey('farmer')).toBe('suppliers.kindHint.farmer');
  });
});
```

- [ ] **Step 2: Run to fail**, then **Step 3: implement**

```tsx
// KindBadge.tsx
import { useTranslation } from 'react-i18next';
import { Badge } from '@/shared/ui/badge';
import type { SupplierKind } from '../model/supplier';

/** §2.11 — the marker on the PERSON. One look everywhere it appears; nothing
 *  at all for «Звичайний», so the common case carries no label. */
export function KindBadge({ kind, className }: { kind: SupplierKind; className?: string }) {
  const { t } = useTranslation();
  if (kind === 'none') return null;
  return (
    <Badge variant={kind === 'wholesale' ? 'secondary' : 'outline'} className={className}>
      {t(`suppliers.kindBadge.${kind}`)}
    </Badge>
  );
}
```

```ts
// lib/kindHint.ts
import type { SupplierKind } from '../model/supplier';
/** §2.11: «Це оптовик. Додайте додаткову ціну.» — a hint, never a number (§2.10). */
export const kindHintKey = (kind: SupplierKind): string | null =>
  kind === 'none' ? null : `suppliers.kindHint.${kind}`;
```

i18n (`uk.json` under `suppliers`): `"kindBadge": { "wholesale": "ОПТ", "farmer": "Фермер" }`, `"kindHint": { "wholesale": "Це оптовик. Додайте додаткову ціну.", "farmer": "Це фермер. Додайте додаткову ціну." }`; `en.json`: `"kindBadge": { "wholesale": "WHOLESALE", "farmer": "Farmer" }`, `"kindHint": { "wholesale": "A wholesaler — add an extra price.", "farmer": "A farmer — add an extra price." }`.

Export from `entities/supplier/index.ts`: `export { KindBadge } from './ui/KindBadge'; export { kindHintKey } from './lib/kindHint';`

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat(supplier): KindBadge and the §2.11 hint key`.

---

### Task 4: Lift the supplier form into `features/edit-supplier`

**Files:**
- Move: `frontend/src/pages/suppliers/api/suppliers.ts` → `frontend/src/features/edit-supplier/api/suppliers.ts`
- Move: `frontend/src/pages/suppliers/lib/apiErrorToFields.ts` (+ `.test.ts`) → `frontend/src/features/edit-supplier/lib/`
- Move: `frontend/src/pages/suppliers/model/supplier.ts` → `frontend/src/features/edit-supplier/model/supplier.ts`
- Move: `frontend/src/pages/suppliers/ui/SupplierFormDialog.tsx` → `frontend/src/features/edit-supplier/ui/SupplierFormDialog.tsx`
- Create: `frontend/src/features/edit-supplier/index.ts`
- Modify: `frontend/src/pages/suppliers/ui/SuppliersPage.tsx` (imports), `frontend/src/pages/suppliers/ui/SuppliersPage.test.tsx` (`vi.mock` paths)

**Interfaces:**
- Produces: `SupplierFormDialog({ supplier, open, onClose, onCreated?, defaultPointId? })`. `onCreated(created: Supplier)` fires after a successful CREATE (not edit) before `onClose`. `defaultPointId` pre-selects the owner's point select on create.
- Re-exports `useCreateSupplierMutation`, `useUpdateSupplierMutation`, `CreateSupplierInput`, `UpdateSupplierInput`.

- [ ] **Step 1: Move with `git mv`** (four files + the test), fix relative imports inside them (`../api/suppliers`, `../lib/apiErrorToFields`, `../model/supplier` stay valid after the move since the folder shape is preserved).

- [ ] **Step 2: Add the two props**

In `SupplierFormDialog`: extend the props type with `onCreated?: (created: Supplier) => void; defaultPointId?: string;`. In `toDefaults`, `collection_point_id: supplier?.collection_point_id ?? defaultPointId ?? ''` (pass `defaultPointId` in). In the create branch of `onSubmit`, after the mutation resolves: `onCreated?.(created);` before the toast/close.

- [ ] **Step 3: Index and consumers**

```ts
// features/edit-supplier/index.ts
export { SupplierFormDialog } from './ui/SupplierFormDialog';
export { useCreateSupplierMutation, useUpdateSupplierMutation } from './api/suppliers';
export type { CreateSupplierInput, UpdateSupplierInput, SupplierFormValues } from './model/supplier';
```

`SuppliersPage.tsx`: `import { SupplierFormDialog } from '@/features/edit-supplier';`. In `SuppliersPage.test.tsx`, any `vi.mock('../api/suppliers', …)` becomes `vi.mock('@/features/edit-supplier/api/suppliers', …)` (or mock the index if that is what it mocks — read the file).

- [ ] **Step 4: Test the new prop**

Add to `features/edit-supplier/ui/SupplierFormDialog.test.tsx` (create if none; mock `./api/suppliers`' hooks and `@/entities/user`, `@/entities/collection-point` as `SuppliersPage.test.tsx` does):

```tsx
it('hands the created supplier to onCreated before closing', async () => {
  const created = { id: 's-new', first_name: 'Марія', last_name: 'Ковальчук', kind: 'none', phone: null, note: null, is_active: true, collection_point_id: 'p1', created_at: '' };
  createMock.mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue(created), isPending: false });
  const onCreated = vi.fn();
  const onClose = vi.fn();
  render(<SupplierFormDialog supplier={null} open onClose={onClose} onCreated={onCreated} />);
  await userEvent.type(screen.getByLabelText(/Ім'я|First name/), 'Марія');
  await userEvent.type(screen.getByLabelText(/Прізвище|Last name/), 'Ковальчук');
  await userEvent.click(screen.getByRole('button', { name: /Зберегти|Save/ }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
  expect(onClose).toHaveBeenCalled();
});
```

- [ ] **Step 5: Run** `npx vitest run src/features/edit-supplier src/pages/suppliers` → PASS; `npm run lint` → clean (import boundaries). **Step 6: Commit** `refactor(suppliers): lift the supplier form into features/edit-supplier`.

---

### Task 5: `features/pick-supplier` — the mock's combobox, without a dependency

**Files:**
- Create: `frontend/src/features/pick-supplier/ui/SupplierPicker.tsx`
- Create: `frontend/src/features/pick-supplier/ui/SupplierPicker.test.tsx`
- Create: `frontend/src/features/pick-supplier/index.ts`
- Modify: `uk.json` / `en.json` (`pickSupplier.*`)

**Interfaces:**
- Produces:

```tsx
export interface SupplierPickerHandle { focus(): void }
export const SupplierPicker: React.ForwardRefExoticComponent<{
  /** The point the visit is at (owner's pick, or the operator's own — may be null while resolving). */
  pointId: string | null;
  /** Owner mode groups «Наша точка» / «Інші точки» by collection_point_id === pointId. */
  ownerMode: boolean;
  value: Supplier | null;
  onChange: (supplier: Supplier) => void;
  disabled?: boolean;
} & React.RefAttributes<SupplierPickerHandle>>;
```

Behaviour: closed = a 48 px full-width `button[role=combobox]` showing «Обрати постачальника» or `name · KindBadge · phone`; open = an absolutely positioned panel (inside a `relative` wrapper, `z-20`, `Card` styling) with a `searchbox` («Прізвище або телефон…», autofocused), a `listbox` (rows: `option` with name, `KindBadge`, phone or «телефон не вказано», amber balance when the supplier is owed money), group headings in owner mode, an empty row «Нікого не знайшли.», and a footer button «Додати нового постачальника» that opens `SupplierFormDialog` (create, `defaultPointId = pointId`, `onCreated` → `onChange(created)` + close). Keyboard: ArrowDown/ArrowUp move the active option (`aria-activedescendant`), Enter picks it, Escape closes and refocuses the trigger; click outside closes. Under the trigger, when `value` is wholesale/farmer: a destructive line with `TriangleAlert` and `t(kindHintKey(kind))` — no bounds text. Data: `useSuppliersQuery(debouncedSearch, ownerMode ? null : pointId)` — for the owner the server returns all points and the component groups; for the operator the server scopes; `useSupplierBalancesQuery({ pointId, includeZero: false })` → `Map<supplier_id, debt>`; active rows only.

- [ ] **Step 1: Failing tests**

```tsx
// SupplierPicker.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../../test-axe';
import { SupplierPicker } from './SupplierPicker';

const { suppliersMock, balancesMock } = vi.hoisted(() => ({ suppliersMock: vi.fn(), balancesMock: vi.fn() }));
vi.mock('@/entities/supplier', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/entities/supplier')>()),
  useSuppliersQuery: (...args: unknown[]) => suppliersMock(...args),
  useSupplierBalancesQuery: () => balancesMock(),
}));
vi.mock('@/features/edit-supplier', () => ({
  SupplierFormDialog: ({ open, onCreated }: { open: boolean; onCreated?: (s: unknown) => void }) =>
    open ? <button onClick={() => onCreated?.(nina)}>create-nina</button> : null,
}));

const nina = { id: 's1', collection_point_id: 'p1', first_name: 'Ніна', last_name: 'Ільчук', phone: '+380671000003', note: null, kind: 'wholesale', is_active: true, created_at: '' };
const vasyl = { id: 's2', collection_point_id: 'p2', first_name: 'Василь', last_name: 'Яремчук', phone: null, note: null, kind: 'none', is_active: true, created_at: '' };

beforeEach(() => {
  suppliersMock.mockReturnValue({ data: { data: [nina, vasyl], total: 2 }, isPending: false });
  balancesMock.mockReturnValue({ data: { data: [{ supplier_id: 's1', debt: '10944.00', first_name: 'Ніна', last_name: 'Ільчук', is_active: true, collection_point_id: 'p1' }], total: 1 } });
});

describe('SupplierPicker', () => {
  it('opens on click, lists people with badge, phone and balance, picks with Enter', async () => {
    const onChange = vi.fn();
    render(<SupplierPicker pointId="p1" ownerMode={false} value={null} onChange={onChange} />);
    await userEvent.click(screen.getByRole('combobox'));
    const list = screen.getByRole('listbox');
    expect(within(list).getByText('Ніна Ільчук')).toBeInTheDocument();
    expect(within(list).getByText(/10.944,00|10 944,00/)).toBeInTheDocument();
    expect(within(list).getByText(/телефон не вказано|no phone/)).toBeInTheDocument();
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith(nina);
  });

  it('filters by the search box and shows the empty row', async () => {
    render(<SupplierPicker pointId="p1" ownerMode={false} value={null} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.type(screen.getByRole('searchbox'), 'zzz');
    expect(suppliersMock).toHaveBeenLastCalledWith('zzz', 'p1');
  });

  it('groups by point for the owner', async () => {
    render(<SupplierPicker pointId="p1" ownerMode value={null} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole('combobox'));
    expect(screen.getByText(/Наша точка|Our point/)).toBeInTheDocument();
    expect(screen.getByText(/Інші точки|Other points/)).toBeInTheDocument();
  });

  it('shows the §2.11 hint for a wholesaler, without any bounds', () => {
    render(<SupplierPicker pointId="p1" ownerMode={false} value={nina} onChange={vi.fn()} />);
    expect(screen.getByText(/Це оптовик|wholesaler/)).toBeInTheDocument();
    expect(screen.queryByText(/₴\/кг|Межі/)).not.toBeInTheDocument();
  });

  it('creates a person inline and picks them', async () => {
    const onChange = vi.fn();
    render(<SupplierPicker pointId="p1" ownerMode={false} value={null} onChange={onChange} />);
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(screen.getByRole('button', { name: /Додати нового|Add a new/ }));
    await userEvent.click(screen.getByText('create-nina'));
    expect(onChange).toHaveBeenCalledWith(nina);
  });

  it('has no axe violations open', async () => {
    const { container } = render(<SupplierPicker pointId="p1" ownerMode={false} value={null} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole('combobox'));
    await expectNoAxeViolations(container);
  });
});
```

- [ ] **Step 2: Run to fail.** **Step 3: Implement**

```tsx
// SupplierPicker.tsx
import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import { ChevronsUpDown, Plus, TriangleAlert, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { TextInput } from '@/shared/ui/text-input';
import { cn } from '@/shared/lib/cn';
import { cmp, formatUah } from '@/shared/lib/money';
import { useDebouncedValue } from '@/shared/lib/useDebouncedValue';
import {
  KindBadge,
  kindHintKey,
  supplierName,
  useSupplierBalancesQuery,
  useSuppliersQuery,
  type Supplier,
} from '@/entities/supplier';
import { SupplierFormDialog } from '@/features/edit-supplier';

export interface SupplierPickerHandle {
  focus(): void;
}

/**
 * §2.1 step ① as the mock draws it: one button that reads like a field, a
 * search box the moment it opens, every person on one list with their marker
 * (§2.11) and what is still owed to them, and «Додати нового постачальника»
 * at the bottom so a first-time visitor never sends the operator to another
 * screen. Built on plain DOM roles rather than a popover library: the bundle
 * budget has no room for one, and a listbox is small.
 */
export const SupplierPicker = forwardRef<SupplierPickerHandle, {
  pointId: string | null;
  ownerMode: boolean;
  value: Supplier | null;
  onChange: (supplier: Supplier) => void;
  disabled?: boolean;
}>(function SupplierPicker({ pointId, ownerMode, value, onChange, disabled }, ref) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => triggerRef.current?.focus() }));

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [active, setActive] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const debounced = useDebouncedValue(search);

  const suppliers = useSuppliersQuery(debounced, ownerMode ? null : pointId);
  const balances = useSupplierBalancesQuery({ pointId, includeZero: false });
  const owed = new Map((balances.data?.data ?? []).map((row) => [row.supplier_id, row.debt]));

  const rows = (suppliers.data?.data ?? []).filter((s) => s.is_active);
  const home = ownerMode ? rows.filter((s) => s.collection_point_id === pointId) : rows;
  const others = ownerMode ? rows.filter((s) => s.collection_point_id !== pointId) : [];
  const flat = [...home, ...others];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = (s: Supplier) => {
    onChange(s);
    setOpen(false);
    setSearch('');
    triggerRef.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, flat.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (flat[active]) pick(flat[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); triggerRef.current?.focus(); }
  };

  const hint = value ? kindHintKey(value.kind) : null;

  const renderRow = (s: Supplier, index: number) => {
    const debt = owed.get(s.id);
    return (
      <li
        key={s.id}
        id={`${id}-opt-${s.id}`}
        role="option"
        aria-selected={value?.id === s.id}
        className={cn(
          'flex cursor-pointer items-center gap-2 px-3 py-2 text-sm',
          index === active && 'bg-muted',
        )}
        onMouseEnter={() => setActive(index)}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => pick(s)}
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate">{supplierName(s)}</span>
            <KindBadge kind={s.kind} className="shrink-0 text-[10px]" />
          </span>
          <span className="block truncate font-mono text-xs text-muted-foreground">
            {s.phone ?? t('pickSupplier.noPhone')}
          </span>
        </span>
        {debt && cmp(debt, '0') === 1 ? (
          <span className="shrink-0 font-mono text-xs text-amber">{formatUah(debt, locale)}</span>
        ) : null}
      </li>
    );
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={`${id}-list`}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="flex h-12 w-full items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 text-left text-base disabled:opacity-50"
      >
        {value ? (
          <span className="flex min-w-0 items-center gap-2">
            <UserRound className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium">{supplierName(value)}</span>
            <span className="hidden truncate font-mono text-sm text-muted-foreground sm:inline">
              {value.phone ?? t('pickSupplier.noPhone')}
            </span>
            <KindBadge kind={value.kind} className="shrink-0 text-[10px]" />
          </span>
        ) : (
          <span className="flex items-center gap-2 text-muted-foreground">
            <UserRound className="size-4" />
            {t('pickSupplier.placeholder')}
          </span>
        )}
        <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
      </button>

      {hint ? (
        <p className="mt-1.5 flex items-start gap-1.5 text-sm font-medium text-destructive">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>{t(hint)}</span>
        </p>
      ) : null}

      {open ? (
        <div className="absolute left-0 right-0 z-20 mt-1 rounded-xl border border-line2 bg-card shadow-lg" onKeyDown={onKey}>
          <div className="border-b border-border p-2">
            <TextInput
              role="searchbox"
              autoFocus
              value={search}
              onChange={(e) => { setSearch(e.target.value); setActive(0); }}
              placeholder={t('pickSupplier.search')}
              aria-label={t('pickSupplier.search')}
              aria-controls={`${id}-list`}
              aria-activedescendant={flat[active] ? `${id}-opt-${flat[active].id}` : undefined}
            />
          </div>
          <ul id={`${id}-list`} role="listbox" className="max-h-[320px] overflow-y-auto py-1">
            {flat.length === 0 ? (
              <li role="presentation" className="px-3 py-4 text-center text-sm text-muted-foreground">
                {t('pickSupplier.empty')}
              </li>
            ) : null}
            {ownerMode && home.length ? (
              <li role="presentation" className="px-3 pt-2 pb-1 text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
                {t('pickSupplier.ourPoint')}
              </li>
            ) : null}
            {home.map((s, i) => renderRow(s, i))}
            {ownerMode && others.length ? (
              <li role="presentation" className="px-3 pt-2 pb-1 text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
                {t('pickSupplier.otherPoints')}
              </li>
            ) : null}
            {others.map((s, i) => renderRow(s, home.length + i))}
          </ul>
          <div className="border-t border-border p-1.5">
            <Button type="button" variant="ghost" className="h-9 w-full justify-start" onClick={() => { setOpen(false); setAddOpen(true); }}>
              <Plus className="size-4" />
              {t('pickSupplier.addNew')}
            </Button>
          </div>
        </div>
      ) : null}

      <SupplierFormDialog
        key={String(addOpen)}
        supplier={null}
        open={addOpen}
        onClose={() => setAddOpen(false)}
        defaultPointId={pointId ?? undefined}
        onCreated={(created) => pick(created)}
      />
    </div>
  );
});
```

i18n `pickSupplier`: uk `{ "placeholder": "Обрати постачальника", "search": "Прізвище або телефон…", "empty": "Нікого не знайшли.", "noPhone": "телефон не вказано", "ourPoint": "Наша точка", "otherPoints": "Інші точки", "addNew": "Додати нового постачальника" }`; en `{ "placeholder": "Pick a supplier", "search": "Last name or phone…", "empty": "Nobody found.", "noPhone": "no phone", "ourPoint": "Our point", "otherPoints": "Other points", "addNew": "Add a new supplier" }`.

`index.ts`: `export { SupplierPicker } from './ui/SupplierPicker'; export type { SupplierPickerHandle } from './ui/SupplierPicker';`

- [ ] **Step 4: Run** `npx vitest run src/features/pick-supplier` → PASS; `npm run lint` clean. If the axe test complains about `aria-activedescendant` pointing at an id outside the searchbox's owned tree, keep `aria-controls` on the searchbox (it is) — that is the combobox pattern axe accepts.

- [ ] **Step 5: Commit** `feat(pick-supplier): the mock's searchable supplier combobox, dependency-free`.

---

### Task 6: `SupplierSection` on the picker

**Files:**
- Modify: `frontend/src/pages/reception/ui/SupplierSection.tsx`
- Modify: `frontend/src/pages/reception/ui/ReceptionPage.tsx` (the `SupplierSection` call: pass `supplier` object and `onChange(supplier)`), `ReceptionPage.test.tsx` (mock `@/features/pick-supplier` with a stub that calls `onChange(nina)` on click)
- Modify: `uk.json`/`en.json` (`reception.supplier.*`)

**Interfaces:**
- Produces: `SupplierSection({ pointId, ownerMode, supplier: Supplier | null, onChange(s: Supplier), debt, disabled, pickerRef })`. History: last 3 rows `formatShortDate(business_date) · formatKg(net_kg) · formatUah(amount)`.

- [ ] **Step 1: Failing test** (in `ReceptionPage.test.tsx`, replacing the old search-box test(s)): the picker stub renders `<button onClick={() => onChange(nina)}>pick-nina</button>`; after clicking it the balance strip reads «Попередній залишок 10 944,00 ₴» and «додасться в «Разом» нижче», the history panel lists `36,90 кг` for the mocked intake row.

- [ ] **Step 2: Implement**

Replace the search input + list block with `<SupplierPicker ref={pickerRef} pointId={pointId} ownerMode={ownerMode} value={supplier} onChange={onChange} disabled={disabled} />`. Remove `VISIBLE`, `search`, `chosen`, `changing` state and the «Змінити» chip (the trigger itself is the change control). Balance strip:

```tsx
{supplier && debt !== null && cmp(debt, '0') === 1 ? (
  <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber/10 px-3 py-2 text-sm">
    <span className="flex items-center gap-2"><HandCoins className="size-4 shrink-0 text-amber" />{t('reception.supplier.debt', { uah: formatUah(debt, locale) })}</span>
    <span className="text-xs text-muted-foreground">{t('reception.supplier.debtNote')}</span>
  </div>
) : null}
```

History rows:

```tsx
<li key={row.id} className={cn('flex items-center gap-2 text-xs', row.voided_at !== null && 'text-muted-foreground line-through')}>
  <span className="shrink-0 text-muted-foreground">{formatShortDate(row.business_date, locale)}</span>
  <span className="min-w-0 flex-1 truncate">{row.voided_at !== null ? t('reception.today.voided') : formatKg(row.net_kg, locale)}</span>
  <span className="shrink-0 font-mono font-medium">{formatUah(row.amount, locale)}</span>
</li>
```

with `HISTORY = 3`. i18n add `reception.supplier.debtNote`: uk «додасться в «Разом» нижче», en «added to “Total” below».

- [ ] **Step 3: Run the reception tests** → PASS. **Step 4: Commit** `feat(reception): the supplier step on the mock's picker`.

---

### Task 7: Line editor ergonomics — masks, auto-pallet, per-row weight, floor 0, clamp, no bounds text

**Files:**
- Modify: `frontend/src/pages/reception/ui/LineEditor.tsx`
- Modify: `frontend/src/pages/reception/ui/ReceptionPage.tsx` (auto-select the first priced grade for line 0)
- Modify: `frontend/src/pages/reception/ui/ReceptionPage.test.tsx`
- Modify: `uk.json`/`en.json` (remove `reception.grade.bounds` and `reception.grade.outOfRange`; add `reception.weight.rowWeight`, `reception.line.tareMissing`, `reception.line.gradeMissing`)

**Interfaces:** unchanged props; `gross_kg`, `pallet_kg`, `bonus` become CONTROLLED inputs (`useWatch` value + `setValue` with `maskDecimalInput`), `units` stays registered.

- [ ] **Step 1: Failing tests** (add to `ReceptionPage.test.tsx`):

```tsx
it('masks the gross weight while typing and never shows the surcharge bounds', async () => {
  // …render with shift open + a picked supplier…
  const gross = screen.getByLabelText(/Брутто/);
  await userEvent.type(gross, '12a,3x45');
  expect(gross).toHaveValue('12.34');
  expect(screen.queryByText(/межі/i)).not.toBeInTheDocument();
});

it('clamps the surcharge to the grade\'s bounds on blur and by the stepper', async () => {
  const bonus = screen.getByLabelText(/Дод\. ціна — на цю позицію/);
  await userEvent.clear(bonus);
  await userEvent.type(bonus, '31');
  await userEvent.tab();
  expect(bonus).toHaveValue('30.00'); // max_markup 30.00 in the grades fixture
  await userEvent.click(screen.getByRole('button', { name: /Дод\. ціна більше/ }));
  expect(bonus).toHaveValue('30.00');
});

it('reveals the pallet field on its own at twenty crates', async () => {
  const units = screen.getByLabelText(/Кількість тари 1/);
  await userEvent.clear(units);
  await userEvent.type(units, '20');
  expect(screen.getByLabelText(/^Піддон/)).toBeInTheDocument();
});

it('shows the row weight beside the tare stepper and warns at zero units', async () => {
  expect(screen.getByText(/1,20 кг/)).toBeInTheDocument(); // 1 × Чешка 1.20
  const units = screen.getByLabelText(/Кількість тари 1/);
  await userEvent.clear(units);
  await userEvent.type(units, '0');
  expect(screen.getByText(/Вкажіть кількість тари/)).toBeInTheDocument();
});

it('pre-selects the first priced grade on the first line', () => {
  expect(screen.getByLabelText(/Сорт і ціна дня/)).toHaveValue('g1');
});
```

- [ ] **Step 2: Implement in `LineEditor`**

- `const pallet = useWatch({ control, name: \`items.${index}.pallet_kg\` }) ?? '0.00';`
- Controlled gross: replace `{...register(...gross_kg)}` with `value={gross} onChange={(e) => setValue(\`items.${index}.gross_kg\`, maskDecimalInput(e.target.value), { shouldDirty: true })}`; same for pallet; bonus with `{ allowNegative: true }` plus `onBlur={() => grade && setValue(\`items.${index}.bonus\`, clampDecimal(bonus, bonusFloor, grade.max_markup), { shouldDirty: true })}`.
- `stepBonus`: after computing, `clampDecimal(next, bonusFloor, grade.max_markup)` when a grade is chosen.
- Delete the `bounds` paragraph and the `bonusOutOfRange` paragraph and border class; keep `bonusError` (server refusal) rendering.
- Units total: `const totalUnits = tareRows.reduce((n, r) => n + (Number.parseInt(r.units, 10) || 0), 0);` (integer counts, not money). Pallet visibility: `showPallet || palletError !== null || totalUnits >= 20 || cmp-safe pallet !== '0.00'`.
- Per-row weight: after the stepper, `<span className="w-16 shrink-0 text-right font-mono text-xs text-muted-foreground">{t('reception.weight.rowWeight', { kg: formatKg(mulInt(type.weight_kg, units), locale) })}</span>` where `type = tareTypes.find(t => t.id === row.tare_type_id)` and `units = Number.parseInt(tareRows[rowIndex].units, 10) || 0`.
- `stepUnits` floor `Math.max(0, …)`.
- Instant hints under the tare block: `grossPositive && totalUnits === 0` → `t('reception.line.tareMissing')` («Вкажіть кількість тари — без неї брутто пішло б у чисту вагу цілком.»); `grossPositive && totalUnits > 0 && gradeId === ''` → `t('reception.line.gradeMissing')` («Оберіть сорт для цієї позиції — інакше вона не потрапить у квитанції.»). Amber text, `AlertTriangle`.

In `ReceptionPage`, extend the existing tare-default effect: when `grades.data.length > 0` and `form.getValues('items.0.product_grade_id') === ''`, `setValue('items.0.product_grade_id', grades.data[0].id)` (same effect, same guard style). `emptyLine` for LATER lines keeps `''` (the mock pre-selects only the first).

- [ ] **Step 3: Run** the reception suite → PASS. **Step 4: Commit** `feat(reception): the mock's line ergonomics — masks, auto-pallet, row weight, clamped surcharge (#117)`.

---

### Task 8: Lines table — unit counts, signed bonus, the «N позицій · kg» counter

**Files:**
- Modify: `frontend/src/pages/reception/ui/LinesTable.tsx`
- Modify: `frontend/src/pages/reception/ui/ReceptionPage.tsx` (pass `lineCount`, `netKg`)
- Modify: `uk.json`/`en.json` (`reception.lines.counter`)

**Interfaces:** `LinesTable` gains `lineCount: number; netKg: string | null;` props; the «Тара» column shows the unit count (`row.item.tare.reduce((n, t) => n + t.units, 0)`), the «Ціна» cell shows `price` then an amber `+N` / `−N` when the bonus is non-zero (reuse `formatBonusSign` — move it from `LineEditor` to `pages/reception/lib/formatBonusSign.ts` and import in both).

- [ ] **Step 1: Failing test**: with two committed lines mocked in the preview, the table's tare cell reads `3` (units) not `3,60`, the price cell contains `−2,00` amber for the discounted line, and the row above the table reads «2 позиції · 55,70 кг».

- [ ] **Step 2: Implement** — counter on the «Ще позиція» row: `<span className="ml-auto font-mono text-xs text-muted-foreground">{t('reception.lines.counter', { count: lineCount, kg: formatKg(netKg, locale) })}</span>` when `netKg !== null` (plural keys `counter_one/few/many/other`: «{{count}} позиція · {{kg}}» / «{{count}} позиції · {{kg}}» / «{{count}} позицій · {{kg}}»).

- [ ] **Step 3: Run → PASS. Step 4: Commit** `feat(reception): lines table reads like the mock's`.

---

### Task 9: «4 · Розрахунок» — «РАЗОМ ДО ВИДАЧІ», «Видано готівкою», the two-tone panel

**Files:**
- Modify: `frontend/src/pages/reception/model/intakeForm.ts` (`paid_amount` in values and body)
- Modify: `frontend/src/pages/reception/ui/TotalsSection.tsx` (rewrite)
- Modify: `frontend/src/pages/reception/ui/ReceptionPage.tsx` (cash read, default paid amount, submit)
- Modify: `frontend/src/pages/reception/api/intakes.ts` (invalidate `payouts`, `pointCash` too)
- Modify: `frontend/src/pages/reception/lib/apiErrorToFields.ts` (+ test) — `PAYOUT_EXCEEDS_CASH` / `PAYOUT_EXCEEDS_DEBT` / `PAYOUT_AMOUNT_ZERO` land on `paid_amount`; a class-validator detail starting with `paid_amount` too
- Modify: `ReceptionPage.test.tsx`; create `TotalsSection.test.tsx`
- Modify: `uk.json`/`en.json` (`reception.totals.*`, `reception.submitPay*`, `reception.toast.*`, `reception.errors.paid*`)

**Interfaces:**
- `IntakeFormValues.paid_amount: string` (typed value, '' allowed). `toCreateBody` adds `paid_amount` only when `DECIMAL_INPUT.test(normalizeAmount(v)) && cmp(v,'0') === 1`.
- `TotalsSection` props:

```ts
{
  accrued: string | null; netKg: string | null; lineCount: number;
  debt: string | null;          // supplier balance; only a positive one is carried in
  cash: string | null;          // GET /point-cash/:id .cash — the drawer for berries
  paid: string;                 // the value shown in «Видано готівкою»
  onPaidChange: (v: string) => void;
  paidError: string | null;     // i18n key from apiErrorToFields, if any
  disabled: boolean; isPreviewing: boolean; isSubmitting: boolean;
  formErrorKey: string | null; showDraftHint: boolean;
}
```
  Internals: `carried = debt && cmp(debt,'0')===1 ? debt : '0.00'`; `total = accrued ? add(accrued, carried) : null`; `cap = total ? (cash && cmp(cash,'0')===1 ? (cmp(total, cash)===1 ? cash : total) : '0.00') : null`; `remainder = total ? sub(total, paidOrZero) : null`.

- [ ] **Step 1: Failing tests** (`TotalsSection.test.tsx`, render with `accrued '5460.00'`, `debt '37.37'`, `cash '1616.10'`):
  - shows «Разом до видачі» `5 497,37 ₴`;
  - «Уся сума» sets `5497.37`, «До сотні» sets `5400.00`, «Усе в залишок» sets `0`; «До сотні» is disabled when total < 100;
  - with `cash '1616.10'` the cash note names `1 616,10 ₴` and the panel reads «Залишок за нами» `3 881,27 ₴` when `paid '1616.10'`; with `paid` equal to total it reads «Розраховано повністю»;
  - typing `9999` and blurring calls `onPaidChange('1616.10')` (clamped to the cap) — the clamp note appears meanwhile;
  - the submit label reads «Прийняти 39,00 кг · видати 1 616,10 ₴».

  In `ReceptionPage.test.tsx`: submitting sends `paid_amount: '1616.10'` in the body; a `PAYOUT_EXCEEDS_CASH` refusal lands as an error under «Видано готівкою» and the intake is not reset.

- [ ] **Step 2: Implement `TotalsSection`**

```tsx
// key parts — full component in this shape
const carried = debt !== null && cmp(debt, '0') === 1 ? debt : '0.00';
const total = accrued === null ? null : add(accrued, carried);
const drawer = cash !== null && cmp(cash, '0') === 1 ? cash : '0.00';
const cap = total === null ? null : cmp(total, drawer) === 1 ? drawer : total;
const paidNormalized = normalizeAmount(paid);
const paidValid = DECIMAL_INPUT.test(paidNormalized);
const paidValue = paidValid ? paidNormalized : '0.00';
const remainder = total === null ? null : sub(total, paidValue);
const overCap = cap !== null && paidValid && cmp(paidValue, cap) === 1;
const limitedByCash = total !== null && cmp(total, drawer) === 1;
const settle = (v: string) => onPaidChange(v);
// chips
<Button type="button" variant="outline" size="sm" onClick={() => settle(cap ?? '0')}>{t('reception.totals.all')}</Button>
<Button type="button" variant="outline" size="sm" disabled={cap === null || cmp(cap, '100') === -1} onClick={() => settle(floorToHundreds(cap ?? '0'))}>{t('reception.totals.toHundreds')}</Button>
<Button type="button" variant="outline" size="sm" onClick={() => settle('0')}>{t('reception.totals.allToBalance')}</Button>
// input
<TextInput inputMode="decimal" className="h-12 pr-9 font-mono text-xl font-semibold" value={paid}
  onChange={(e) => onPaidChange(maskDecimalInput(e.target.value))}
  onBlur={() => { if (cap !== null && paidValid) onPaidChange(clampDecimal(paidValue, '0.00', cap)); }}
  aria-label={t('reception.totals.paid')} />
```

Layout as the mock: left column (rows «Нараховано сьогодні · N позицій», amber «Попередній залишок + X» when carried > 0, divider, `Eyebrow` «Разом до видачі» + `font-mono text-[34px] leading-none font-semibold` total, the input with a `₴` suffix, the three chips, the clamp note `{overCap ? t('reception.totals.overCap', { uah: formatUah(cap, locale) }) : null}`), right column (`bg-amber/10` / `bg-leaf/10` box: eyebrow «Залишок за нами» / «Розраховано повністю», `text-2xl font-mono` remainder or `0 ₴`, caption). Below: the cash note when `limitedByCash` (`bg-amber/10` paragraph: `t('reception.totals.cashNote', { uah: formatUah(drawer, locale) })`). Submit: `<Check className="size-5" />` + label: when `netKg !== null && paidValid && cmp(paidValue,'0')===1` → `t('reception.submitPay', { lines: lineCount > 1 ? t('reception.linesPart', { count: lineCount }) : '', kg: formatKg(netKg, locale), uah: formatUah(paidValue, locale) })`, else the existing labels. `paidError` renders as `role="alert"` text under the input.

i18n `reception.totals`: `accruedToday` «Нараховано сьогодні», `linesSuffix` « · {{count}} позицій» (plural), `debt` «Попередній залишок», `total` «Разом до видачі», `paid` «Видано готівкою», `all` «Уся сума», `toHundreds` «До сотні», `allToBalance` «Усе в залишок», `overCap` «Більше за РАЗОМ видати не можна — рахуємо {{uah}}», `cashNote` «У касі за ягоду {{uah}} — більше зараз видати нема з чого. Різниця лягає в залишок постачальника; касу відновлює переказ від керівника.», `remainder` «Залишок за нами», `settled` «Розраховано повністю», `remainderHint` «Додасться до залишку постачальника — датою сьогодні», `settledHint` «Нічого не зависає на балансі». `reception.submitPay` «Прийняти {{lines}}{{kg}} · видати {{uah}}», `reception.linesPart_one/few/many/other` «{{count}} позиція · » / «{{count}} позиції · » / «{{count}} позицій · ». `reception.errors.paidExceedsCash` «У касі за ягоду менше — сервер обрізав виплату; зменшіть суму», `paidExceedsDebt` «Більше за «Разом» видати не можна», `paidFormat` «Введіть суму, напр. 4000 або 4000.50». `reception.toast.remainder` «Залишок за нами: {{uah}}», `reception.toast.settled` «Розраховано повністю». English equivalents alongside.

- [ ] **Step 3: Wire the page**

- `const pointCash = usePointCashForPointQuery(pointId, undefined, shiftOpen); const cash = pointCash.data?.cash ?? null;`
- `paid_amount` default: `defaultValues: { supplier_id: '', items: [emptyLine('')], paid_amount: '' }`, plus `const [paidTouched, setPaidTouched] = useState(false)`. Derive during render: `const suggested = total !== null ? (cash-capped total as in TotalsSection, computed once here via a small helper \`suggestedPaid(accrued, debt, cash)\` in \`pages/reception/lib/suggestedPaid.ts\`) : ''` and `const paidShown = paidTouched ? values.paid_amount : suggested`. `onPaidChange = (v) => { setPaidTouched(true); setValue('paid_amount', v, { shouldDirty: true }); }`. On submit use `paidShown` (`toCreateBody({ ...formValues, paid_amount: paidShown }, bodyPointId)`); after success `setPaidTouched(false)`.
- Success toast: `toast.success(t('reception.toast.accepted', {...}), { description: cmp(remainderOf(created), '0') === 1 ? t('reception.toast.remainder', { uah }) : t('reception.toast.settled') })` where `remainderOf = sub(add(created.amount, carried), created.paid_amount)` — carried is the debt BEFORE this receipt (`debt` at submit time). (Check `shared/ui/toast`'s signature accepts a description; sonner does.)
- `apiErrorToFields`: `PAID_FIELD = { PAYOUT_EXCEEDS_CASH: 'reception.errors.paidExceedsCash', PAYOUT_EXCEEDS_DEBT: 'reception.errors.paidExceedsDebt', PAYOUT_AMOUNT_ZERO: 'reception.errors.paidFormat' }` → `{ field: 'paid_amount', messageKey }`; `fieldFromDetail`: `prop === 'paid_amount' ? prop : …` with key `reception.errors.paidFormat`. Treat `paid_amount` as a rendered field in `isFieldRendered` (it is rendered by `TotalsSection`).
- `useCreateIntakeMutation.onSuccess`: also invalidate `queryKeys.payouts` and `queryKeys.pointCash` (the payout moved the drawer).
- `SupplierSection` change handler in the page: `onSupplierChange = (s) => { if (lines.fields.length > 1) { reset({ supplier_id: s.id, items: [emptyLine(defaultTareTypeId)], paid_amount: '' }); toast(t('reception.toast.linesCleared')); } else setValue('supplier_id', s.id, { shouldDirty: true }); setSupplier(s); setPaidTouched(false); }` with `reception.toast.linesCleared` «Позиції очищено — вони належали попередньому постачальнику».

- [ ] **Step 4: Run** the reception + totals tests → PASS; `npm run lint`. **Step 5: Commit** `feat(reception): «Видано готівкою» in the same action as «Прийняти» (§2.1 ⑥, §3.1, §3.6)`.

---

### Task 10: The right column — «Стан точки» and richer «Сьогоднішні квитанції»

**Files:**
- Create: `frontend/src/pages/reception/ui/PointStatePanel.tsx` (+ `.test.tsx`)
- Modify: `frontend/src/pages/reception/ui/TodayReceipts.tsx` (+ test)
- Modify: `frontend/src/pages/reception/ui/ReceptionPage.tsx` (layout, `lg:` grid, right column)
- Modify: `uk.json`/`en.json` (`reception.state.*`, `reception.today.*`)

**Interfaces:**
- `PointStatePanel({ pointId, shiftId, isOwner, targetCrates })`. Reads: `usePointCashForPointQuery(pointId)` («У касі за ягоду зараз»), `useCashCountsQuery({ shiftId })` → the `kind === 'opening' && book === 'berry'` row's `counted_amount` («На ранок порахували», «—» if none), `usePayoutsQuery({ shiftId })` → `sum(live amounts)` («Видано за ягоду»), `useIntakesQuery({ shiftId })` → `sum(live: sub(amount, paid_amount))` («Залишків створено», amber when > 0), `useCrateBalancesQuery({ pointId, isOwner })` → `Σ outstanding_units` («У людей»), `targetCrates` («Наділ», «—» when null). Two `SectionHead`s with «Відкрити» links to `/point-cash` and `/crates` (`?point=` appended for the owner).
- `TodayReceipts` rows: `formatTime(created_at) · supplier_name · (lines_count > 1 ? «N позицій» : '') · formatKg(net_kg) · amber «залишок X» when sub(amount, paid_amount) > 0 · formatUah(amount) · <Receipt/> icon`; header: live count badge + tonnage `formatKg(sum(live net_kg))`; list `max-h-[560px] overflow-y-auto`.

- [ ] **Step 1: Failing tests** — `PointStatePanel.test.tsx` mocks the five hooks (`@/entities/point-cash`, `@/entities/cash-count`, `@/entities/payout`, `@/entities/intake`, `@/entities/crate`) and asserts the six figures; `TodayReceipts.test.tsx` asserts a row shows `Ніна Ільчук`, `36,90 кг`, «залишок 5 000,00 ₴» (for `amount '15000.00', paid_amount '10000.00'`), and the header tonnage.

- [ ] **Step 2: Implement** (mirror the mock's `PointStatePanel` grid: `grid-cols-2 gap-x-4 gap-y-3`, `Eyebrow` + `font-mono text-xl font-semibold` values, `tone` amber/bad). Crates block: «Наділ N ящиків» + «У людей X»; when `targetCrates` is null «наділу цій точці ще не призначали». No proportion bar (the other segments are D-3 — say so in a code comment).

- [ ] **Step 3: Layout in `ReceptionPage`**: `<div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,1fr)]">` — form first, then `<div className="flex flex-col gap-4"><PointStatePanel …/><TodayReceipts …/></div>`. Header actions: «Ціни дня» for BOTH roles; the no-prices `EmptyState` gets `action` (owner: `<Button asChild><Link to="/prices">Встановити ціни</Link></Button>`) — check `EmptyState`'s props first; if it has none, render the button under it.

- [ ] **Step 4: Run → PASS. Step 5: Commit** `feat(reception): «Стан точки» and the day's receipts with names and kilograms`.

---

### Task 11: The receipt says what was paid; the payout button leaves the dialog

**Files:**
- Modify: `frontend/src/widgets/receipt/ui/ReceiptSheet.tsx`, `ReceiptDialog.tsx`, `ReceiptDialog.test.tsx`
- Modify: `frontend/src/features/settle-payout/lib/apiErrorToFields.ts` (+ test): `PAYOUT_EXCEEDS_CASH` → `amount`, key `payout.errors.exceedsCash`
- Modify: `uk.json`/`en.json` (`receipt.*`, `payout.errors.exceedsCash`)

**Interfaces:** `ReceiptSheet` gains `paid: { amount: string; codes: string[] } | null` and `voidedPayouts: string[]`; `date` is `formatDateTime(intake.created_at, locale)`; `pricePerKg` shows `${price} + ${bonus} = ${add(price, bonus)}` when bonus ≠ 0 (use `formatUah` on each part; a negative bonus prints `− x`); title `receipt.titleLines` «Квитанція {{code}} · {{count}} позицій» (plural) when `items.length > 1`; `receivedBy = intake.received_by_name ?? '—'`.

- [ ] **Step 1: Failing tests** in `ReceiptDialog.test.tsx`: the sheet shows «Видано готівкою» `10 000,00 ₴` with the payout code in muted text, «Приймав Оксана Гнатюк» (from `received_by_name`, not `me`), the date with a time, the title with «2 позиції», and there is NO «Видати готівкою» button; a voided linked payout renders «виплату {code} анульовано».

- [ ] **Step 2: Implement** — delete `PayoutDialog` usage, `payoutOpen`/`payoutKey`, `defaultPayoutAmount`, `showPayout`; keep `VoidDocumentDialog`. Rows in the sheet after «Нараховано»: `{paid ? <Row label={t('receipt.paid')} value={paid.amount} /> : null}` with `<div className="text-[10px] text-neutral-500">{paid.codes.join(', ')}</div>`, then `Row balanceAtPoint`. i18n: `receipt.paid` «Видано готівкою», `receipt.payoutVoided` «виплату {{code}} анульовано», `receipt.titleLines_*`, `receipt.description` → «Друкована квитанція — тут можна анулювати документ.»; `payout.errors.exceedsCash` «У касі за ягоду менше — видати цю суму зараз нема з чого».

- [ ] **Step 3: Run** `npx vitest run src/widgets src/features/settle-payout` → PASS. **Step 4: Commit** `feat(receipt): print «Видано готівкою» and the receiver's name; the payout button moves to reception (#116)`.

---

### Task 12: Keyboard flow and focus

**Files:**
- Modify: `frontend/src/pages/reception/ui/ReceptionPage.tsx`
- Modify: `ReceptionPage.test.tsx`

- [ ] **Step 1: Failing tests**: pressing Enter in the gross field does NOT submit while the form is not ready (the create mock is not called); after a successful submit the combobox has focus.

- [ ] **Step 2: Implement** — on the `<form>`: `onKeyDown={(e) => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT' && !canSubmit) e.preventDefault(); }}`; `const pickerRef = useRef<SupplierPickerHandle>(null)`; after `reset(...)` in `onSubmit`, `pickerRef.current?.focus()`; on mount, `autoFocus` is on the picker trigger only when no supplier is chosen (pass `autoFocus` prop through to the trigger — add `autoFocus?: boolean` to `SupplierPicker`).

- [ ] **Step 3: Run → PASS. Step 4: Commit** `feat(reception): Enter never submits a half-typed receipt; focus returns to the person`.

---

### Task 13: Records of truth, the audit marks, verification

**Files:**
- Modify: `frontend/CLAUDE.md` (`features/pick-supplier`, `features/edit-supplier`, `pages/reception` description, `widgets/receipt` note, remove the «Kit hygiene» mention of `chip`/`segmented` if they were touched — they were not)
- Modify: `docs/superpowers/specs/2026-09-21-yagoda-reception-parity.md` — append «## 5. Audit marks» listing items 1–56 each as `ported` / `deferred → D-n` / `not ported (rule)` with one clause of reason; note that the receipt's «Попередній залишок» and «РАЗОМ» rows are NOT printed (not derivable without allocations; the receipt prints «Нараховано», «Видано готівкою», «Залишок у цьому пункті»).

- [ ] **Step 1: Write the docs.**
- [ ] **Step 2: Run** `npm run verify:full` from the worktree root. Expected: all rows `PASSED` except `test:ci-scripts` (`SKIPPED`, no jq). If `bundle` is red: the new code is plain components; compare `frontend/dist/assets` sizes before/after and report the delta — do NOT raise the budget in this PR; find what grew.
- [ ] **Step 3: Check out the branch in the MAIN worktree for the owner's comparison**: from `/home/dz/work/yagoda-starter` run `git status --porcelain` (must be clean, memory: shared worktree) then `git checkout feat/reception-parity`; confirm `http://localhost:5173/reception` renders (Vite HMR picks the bind mount up). If the frontend container fails on a missing module, no dependency was added — restart it: `docker compose restart frontend`.
- [ ] **Step 4: Commit** `docs(reception): records of truth and the audit marks for the reception slice`.

---

## Self-review

- Spec §3 header → Tasks 6 (picker), 10 (layout, «Ціни дня», no-prices action). §3 «1 · Постачальник» → Tasks 3, 4, 5, 6, 9 (lines cleared). «2 · Вага» → Task 7. «3 · Товар» → Task 7. «Lines» → Task 8. «4 · Розрахунок» → Task 9. «Right column» → Task 10. «Receipt» → Task 11. Keyboard/focus → Task 12. Kept/not-ported lists → Task 13 marks.
- Names consistent: `SupplierPicker`/`SupplierPickerHandle`, `KindBadge`, `kindHintKey`, `SupplierFormDialog.onCreated/defaultPointId`, `maskDecimalInput`, `clampDecimal`, `floorToHundreds`, `mulInt`, `paid_amount`, `TotalsSection` props, `PointStatePanel`, `IntakePayout`, `received_by_name`.
- No placeholder steps; every code step shows the code or the exact edit.

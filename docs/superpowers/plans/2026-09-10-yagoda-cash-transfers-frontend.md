# Каса точки і Перекази — фронтенд Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перенести з мока `yagoda-crm` два екрани, під якими вже є бекенд — «Каса точки» (Н17) і «Перекази» (Н18) — і полагодити «Касу за день», яку мердж #62 інакше зламає.

**Architecture:** FSD. Три нові entity-зрізи (`transfer`, `point-cash`, `cash-count`) віддають дані, шість features несуть дії, дві сторінки складають їх із наявних `shared/ui` примітивів. Ящикова половина обох екранів джерела не має і ставиться явною заглушкою. Робота ділиться на два стековані PR: дрібний ремонт Day, потім екрани.

**Tech Stack:** React 19 + TypeScript, react-router, TanStack Query v5, react-hook-form, axios (`httpClient`), i18next (uk/en), vitest + Testing Library + `axios-mock-adapter`, Tailwind + shadcn-подібні примітиви в `shared/ui`.

**Spec:** `docs/superpowers/specs/2026-09-10-yagoda-cash-transfers-frontend.md`

## Global Constraints

- **Гроші — рядки, ніколи не `number`.** Уся арифметика через `@/shared/lib/money` (`add`, `sub`, `sum`, `cmp`, `div`, `isNegative`, `isZero`); друк через `formatUah` / `formatDecimal`. `Number()`, `*`, `/`, `toFixed` над грошима заборонені.
- **Гілка PR-A:** `feat/yagoda-day-counted-amount`, база `origin/feat/yagoda-transfers-cash-slice` (PR #62). **Гілка PR-B:** `feat/yagoda-cash-transfers-frontend`, база — PR-A. Обидва PR — **draft**, поки #62 не злитий.
- **Кожен рядок інтерфейсу — через i18n.** Ключі додаються в `frontend/src/shared/lib/i18n/locales/uk.json` і `en.json` **обидва**; жодного літерала в JSX.
- **FSD-межі:** `entities/*` не імпортує `entities/*` (дублювати тип дешевше за cross-import — так уже зроблено для `Paginated`); `features/*` не імпортує `pages/*`; імпорт лише через публічний `index.ts` зрізу.
- **Ролі:** `network_owner` і `point_operator`. §10.2 — дії, яких роль не має, **не рендеряться взагалі**, а не рендеряться заблокованими.
- **`ShiftStatus.awaiting_explanation` недосяжний за рішенням клієнта** — обробляти захисно, ніколи на нього не розраховувати.
- **Ящики** поза самим переказом не рахуються в цьому слайсі — тільки заглушка (Task 18).
- Після кожної задачі: `npm run lint` і `npm test` зелені перед комітом.

---

# ЧАСТИНА I — PR-A · ремонт «Каси за день»

Гілка `feat/yagoda-day-counted-amount` вже створена й підключена (worktree). Мета: `POST /shifts` і `POST /shifts/:id/close` після #62 вимагають `counted_amount`, а екран шле порожнє тіло.

---

### Task 1: Грошове поле вводу переїжджає в `shared`

`DECIMAL` і `normalizeAmount` живуть локально в `features/settle-payout/ui/PayoutDialog.tsx:31-35`. Двом новим діалогам потрібне те саме — третя копія неприйнятна.

**Files:**
- Create: `frontend/src/shared/lib/money/input.ts`
- Create: `frontend/src/shared/lib/money/input.test.ts`
- Modify: `frontend/src/shared/lib/money/index.ts`
- Modify: `frontend/src/features/settle-payout/ui/PayoutDialog.tsx` (прибрати локальні `DECIMAL`/`normalizeAmount`, імпортувати з `@/shared/lib/money`)

**Interfaces:**
- Produces: `DECIMAL_INPUT: RegExp`, `normalizeAmount(value: string): string`

- [ ] **Step 1: Написати падючий тест**

```ts
// frontend/src/shared/lib/money/input.test.ts
import { describe, it, expect } from 'vitest';
import { DECIMAL_INPUT, normalizeAmount } from './input';

describe('normalizeAmount', () => {
  it('accepts a comma as the decimal separator and trims', () => {
    expect(normalizeAmount(' 1 234,50 ')).toBe('1234.50');
  });
  it('strips spaces used as thousands separators', () => {
    expect(normalizeAmount('12 000')).toBe('12000');
  });
  it('leaves an already-canonical string alone', () => {
    expect(normalizeAmount('0.05')).toBe('0.05');
  });
});

describe('DECIMAL_INPUT', () => {
  it.each(['0', '0.5', '0.05', '99999999.99'])('accepts %s', (v) => {
    expect(DECIMAL_INPUT.test(v)).toBe(true);
  });
  it.each(['', '-1', '1.234', 'abc', '1.'])('rejects %s', (v) => {
    expect(DECIMAL_INPUT.test(v)).toBe(false);
  });
});
```

- [ ] **Step 2: Переконатися, що падає**

Run: `npm test -w frontend -- src/shared/lib/money/input.test.ts`
Expected: FAIL — `Failed to resolve import "./input"`

- [ ] **Step 3: Реалізація**

```ts
// frontend/src/shared/lib/money/input.ts

/**
 * Що людина має право надрукувати в грошовому полі: до 8 цифр цілої частини і
 * не більше двох після коми. Дзеркалить `@Matches(/^\d{1,10}(\.\d{1,2})?$/)`
 * бекендових DTO, але вужче на два розряди — 99 999 999,99 ₴ за зміну не буває,
 * а зайвий нуль у полі це найчастіше промах по клавіші.
 */
export const DECIMAL_INPUT = /^\d{1,8}(\.\d{1,2})?$/;

/**
 * Приводить надруковане до канонічного вигляду ПЕРЕД перевіркою: українська
 * розкладка дає кому, а звичка з паперу — пробіл між тисячами. Ні те, ні те не
 * помилка користувача, тому це нормалізація, а не відмова.
 */
export function normalizeAmount(value: string): string {
  return value.replace(/\s/g, '').replace(',', '.').trim();
}
```

```ts
// frontend/src/shared/lib/money/index.ts — додати рядком
export { DECIMAL_INPUT, normalizeAmount } from './input';
```

- [ ] **Step 4: Перепідключити `PayoutDialog`**

Видалити з `frontend/src/features/settle-payout/ui/PayoutDialog.tsx` локальні
`const DECIMAL = …` і `function normalizeAmount(…)`, додати до наявного імпорту
з `@/shared/lib/money` — `DECIMAL_INPUT`, `normalizeAmount` — і замінити
використання `DECIMAL.test(...)` на `DECIMAL_INPUT.test(...)`.

- [ ] **Step 5: Тести зелені**

Run: `npm test -w frontend -- src/shared/lib/money src/features/settle-payout`
Expected: PASS (усі, включно з наявними тестами `PayoutDialog`)

- [ ] **Step 6: Коміт**

```bash
git add frontend/src/shared/lib/money frontend/src/features/settle-payout/ui/PayoutDialog.tsx
git commit -m "refactor(money): lift the decimal input mask into shared

Two shift-count dialogs need the same normalise-then-validate pair that
PayoutDialog grew locally. A third copy is where the three drift apart, so
it moves to shared/lib/money before the second consumer exists.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `Shift.explanation` у моделі фронтенду

#62 додав `explanation` у `ShiftResponse`.

**Files:**
- Modify: `frontend/src/entities/shift/model/shift.ts`

**Interfaces:**
- Produces: `Shift.explanation: string | null`

- [ ] **Step 1: Додати поле**

```ts
// frontend/src/entities/shift/model/shift.ts — у interface Shift, останнім полем
  /**
   * Пояснення керівника до розбіжності в підрахунку каси (§7.7 у редакції
   * 09.09.2026: розбіжність НІКОЛИ не блокує закриття, керівник пояснює
   * постфактум). `null` — або розбіжності не було, або її ще не пояснили.
   */
  explanation: string | null;
```

- [ ] **Step 2: Перевірити типи**

Run: `npm run build -w frontend`
Expected: PASS. Якщо якийсь тест будує `Shift`-фікстуру без `explanation` — додати `explanation: null` у фікстуру.

- [ ] **Step 3: Коміт**

```bash
git add frontend/src/entities/shift/model/shift.ts frontend/src/entities/shift
git commit -m "feat(shift): carry the owner's explanation on the shift model

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Відкриття й закриття зміни несуть підрахунок

**Files:**
- Modify: `frontend/src/pages/day/api/shiftActions.ts`
- Create: `frontend/src/pages/day/api/shiftActions.test.tsx`

**Interfaces:**
- Consumes: нічого нового.
- Produces: `useOpenShiftMutation()` → `mutateAsync({ counted_amount: string })`; `useCloseShiftMutation()` → `mutateAsync({ id: string, counted_amount: string })`. `useReopenShiftMutation` **не змінюється**.

> **Розбіжність із кодом, зафіксовано 2026-09-10.** `useOpenShiftMutation`/`useCloseShiftMutation`
> дійсно народились у `pages/day/api/shiftActions.ts` за цим планом, але не лишилися там: коли
> `CountDrawerDialog` (Task 4) отримав другого споживача — `pages/reception` теж дає оператору
> відкрити зміну (коміт `bb961d8`) — обидві мутації переїхали в
> `features/count-shift/api/shiftActions.ts` разом з діалогом. `pages/day/api/shiftActions.ts`
> сьогодні несе лише `useReopenShiftMutation`, яка нікуди не переїжджала.

- [ ] **Step 1: Написати падючий тест**

```tsx
// frontend/src/pages/day/api/shiftActions.test.tsx
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ReactNode } from 'react';
import { httpClient } from '@/shared/api';
import { useOpenShiftMutation, useCloseShiftMutation } from './shiftActions';

let mock: MockAdapter;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

beforeEach(() => {
  mock = new MockAdapter(httpClient);
});
afterEach(() => mock.restore());

describe('useOpenShiftMutation', () => {
  it('sends the counted drawer amount — the backend requires it', async () => {
    mock.onPost('/shifts').reply(201, { id: 's1' });
    const { result } = renderHook(() => useOpenShiftMutation(), { wrapper });
    await result.current.mutateAsync({ counted_amount: '1500.00' });
    await waitFor(() => expect(mock.history.post).toHaveLength(1));
    expect(JSON.parse(mock.history.post[0].data)).toEqual({ counted_amount: '1500.00' });
  });
});

describe('useCloseShiftMutation', () => {
  it('posts the count to the shift being closed', async () => {
    mock.onPost('/shifts/s1/close').reply(200, { id: 's1' });
    const { result } = renderHook(() => useCloseShiftMutation(), { wrapper });
    await result.current.mutateAsync({ id: 's1', counted_amount: '980.40' });
    await waitFor(() => expect(mock.history.post).toHaveLength(1));
    expect(mock.history.post[0].url).toBe('/shifts/s1/close');
    expect(JSON.parse(mock.history.post[0].data)).toEqual({ counted_amount: '980.40' });
  });
});
```

- [ ] **Step 2: Переконатися, що падає**

Run: `npm test -w frontend -- src/pages/day/api/shiftActions.test.tsx`
Expected: FAIL — тіло запиту порожнє (`{}`), бо мутації досі не приймають аргументів.

- [ ] **Step 3: Реалізація**

```ts
// frontend/src/pages/day/api/shiftActions.ts — замінити дві функції

/**
 * Оператор, і лише він (§10.3). Точка береться з токена — тіло несе САМЕ
 * підрахунок шухляди, і він обов'язковий: перший підрахунок точки ЦЕ і є її
 * початковий залишок (§7.3), тому «пропустити цього разу» немає чого.
 */
export function useOpenShiftMutation() {
  const invalidate = useInvalidateDay();
  return useMutation({
    mutationFn: async ({ counted_amount }: { counted_amount: string }): Promise<Shift> =>
      (await httpClient.post<Shift>('/shifts', { counted_amount })).data,
    onSuccess: invalidate,
  });
}

/** Оператор, і лише він — закриття це підпис того, хто тримав гроші (§10.3). */
export function useCloseShiftMutation() {
  const invalidate = useInvalidateDay();
  return useMutation({
    mutationFn: async ({
      id,
      counted_amount,
    }: {
      id: string;
      counted_amount: string;
    }): Promise<Shift> =>
      (await httpClient.post<Shift>(`/shifts/${id}/close`, { counted_amount })).data,
    onSuccess: invalidate,
  });
}
```

- [ ] **Step 4: Тести зелені**

Run: `npm test -w frontend -- src/pages/day/api/shiftActions.test.tsx`
Expected: PASS. `DayPage.test.tsx` тимчасово падає на типах — це полагодить Task 4.

- [ ] **Step 5: Коміт**

```bash
git add frontend/src/pages/day/api
git commit -m "feat(day): open and close a shift with the counted drawer

#62 makes counted_amount required on both endpoints; the screen sent no
body at all, so without this every open and close answers 400.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Діалог підрахунку шухляди

Один компонент на обидві дії — відкриття й закриття питають те саме число.

**Files:**
- Create: `frontend/src/pages/day/ui/CountDrawerDialog.tsx`
- Create: `frontend/src/pages/day/ui/CountDrawerDialog.test.tsx`
- Modify: `frontend/src/pages/day/ui/DayPage.tsx`
- Modify: `frontend/src/pages/day/ui/DayPage.test.tsx` (якщо тести тиснуть «Відкрити зміну» / «Закрити»)

**Interfaces:**
- Consumes: `DECIMAL_INPUT`, `normalizeAmount` з `@/shared/lib/money` (Task 1); `apiErrorToBanner` з `../lib/apiErrorToBanner`.
- Produces:

```ts
export function CountDrawerDialog(props: {
  mode: 'open' | 'close';
  open: boolean;
  onClose: () => void;
  /** Викликається з нормалізованою сумою; кидає — діалог покаже банер і лишиться відкритим. */
  onConfirm: (countedAmount: string) => Promise<unknown>;
}): JSX.Element;
```

> **Розбіжність із кодом, зафіксовано 2026-09-10.** `CountDrawerDialog` живе не в
> `pages/day/ui/`, а в `features/count-shift/ui/`: `pages/reception` теж дає оператору
> відкрити зміну (коміт `bb961d8`), а сторінка не ділиться UI напряму з іншою сторінкою —
> спільний код піднявся на рівень `features`, де його бачать обидві. `pages/day/ui/DayPage.tsx`
> і `pages/reception/ui/ReceptionPage.tsx` обидва імпортують готовий `CountDrawerDialog` з
> `@/features/count-shift`.

- [ ] **Step 1: Написати падючий тест**

```tsx
// frontend/src/pages/day/ui/CountDrawerDialog.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CountDrawerDialog } from './CountDrawerDialog';

function setup(onConfirm = vi.fn().mockResolvedValue(undefined)) {
  render(
    <CountDrawerDialog mode="open" open onClose={() => {}} onConfirm={onConfirm} />,
  );
  return onConfirm;
}

describe('CountDrawerDialog', () => {
  it('sends the amount normalised — a comma is how the keyboard types it', async () => {
    const onConfirm = setup();
    await userEvent.type(screen.getByRole('textbox'), '1 500,50');
    await userEvent.click(screen.getByRole('button', { name: /day\.count\.submit|Записати/i }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('1500.50'));
  });

  it('refuses to submit an empty drawer count', async () => {
    const onConfirm = setup();
    await userEvent.click(screen.getByRole('button', { name: /day\.count\.submit|Записати/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('never shows an expected figure — the count is a control, not a form to match', () => {
    setup();
    expect(screen.queryByText(/очікув|expected/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Переконатися, що падає**

Run: `npm test -w frontend -- src/pages/day/ui/CountDrawerDialog.test.tsx`
Expected: FAIL — модуля немає.

- [ ] **Step 3: Реалізація**

Взірець — `frontend/src/pages/day/ui/ReopenShiftDialog.tsx` (той самий каркас: `Dialog` + `Field` + RHF + банер). Відмінності: `TextInput` замість `Textarea`, `inputMode="decimal"`, `className="font-mono"`, і валідація `DECIMAL_INPUT.test(normalizeAmount(value)) || 'day.errors.countFormat'`. `onConfirm` отримує `normalizeAmount(values.amount)`.

Заголовок і опис беруться з `mode`:
- `open` → `t('day.count.openTitle')`, `t('day.count.openBody')`
- `close` → `t('day.count.closeTitle')`, `t('day.count.closeBody')`

```tsx
/**
 * ЧОМУ ТУТ НЕ ПОКАЗАНО «ОЧІКУВАНО». Спокуса поставити поруч `expected_amount`
 * велика і вона знищує сенс дії: підрахунок — це контроль, а людина, яка
 * бачить очікуване число, впише саме його. Очікуване й розбіжність з'являються
 * ПІСЛЯ запису — у тості й на «Касі точки».
 */
```

- [ ] **Step 4: Підключити в `DayPage`**

- `DayPage.tsx:220` — кнопка «Відкрити зміну» більше не викликає мутацію напряму, а ставить `setCountMode('open')`.
- `ConfirmDialog` для закриття (`:349`) **замінюється** на `CountDrawerDialog` з `mode="close"`.
- Стан: `const [countMode, setCountMode] = useState<'open' | 'close' | null>(null);` замість `confirmClose`.
- `onConfirm` для `open`: `run(() => open.mutateAsync({ counted_amount }), 'day.toast.opened')`;
  для `close`: `run(() => close.mutateAsync({ id: shift.data!.id, counted_amount }), 'day.toast.closed')`.
- `run()` уже ковтає помилку в банер сторінки; щоб діалог теж міг показати відмову і **не закритися**, `onConfirm` має пробрасувати помилку — використовувати `open.mutateAsync(...)` напряму в `onConfirm` і лишити `run()` лише там, де діалогу немає.

- [ ] **Step 5: Тести зелені**

Run: `npm test -w frontend -- src/pages/day`
Expected: PASS

- [ ] **Step 6: Коміт**

```bash
git add frontend/src/pages/day
git commit -m "feat(day): ask for the drawer count when opening and closing

One dialog for both: the question is the same number. It deliberately does
not show what the system expects — a count someone can read the answer to
stops being a count.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Локалізація PR-A

**Files:**
- Modify: `frontend/src/shared/lib/i18n/locales/uk.json`
- Modify: `frontend/src/shared/lib/i18n/locales/en.json`

- [ ] **Step 1: Додати ключі**

У блок `"day"` обох файлів:

```jsonc
// uk.json
"count": {
  "openTitle": "Перерахуйте шухляду",
  "openBody": "Скільки грошей у шухляді просто зараз. Це число відкриває зміну і стає початковим залишком точки.",
  "closeTitle": "Перерахуйте шухляду перед закриттям",
  "closeBody": "Скільки грошей лишилось. Розбіжність не заблокує закриття — її побачить керівник.",
  "amount": "У шухляді, ₴",
  "submit": "Записати"
},
"errors": {
  "countFormat": "Введіть суму — до двох знаків після коми"
}
```

```jsonc
// en.json
"count": {
  "openTitle": "Count the drawer",
  "openBody": "How much cash is in the drawer right now. This figure opens the shift and becomes the point's opening balance.",
  "closeTitle": "Count the drawer before closing",
  "closeBody": "How much is left. A discrepancy will not block the close — the owner sees it afterwards.",
  "amount": "In the drawer, ₴",
  "submit": "Record"
},
"errors": {
  "countFormat": "Enter an amount — at most two decimals"
}
```

> `"errors"` у блоці `"day"` може вже існувати (там `reasonRequired`) — тоді **додати ключ у наявний об'єкт**, а не створювати другий.

- [ ] **Step 2: Перевірити, що жоден ключ не загубився**

Run: `npm run lint -w frontend && npm test -w frontend -- src/pages/day`
Expected: PASS, і в тестах не видно сирих ключів на кшталт `day.count.submit`.

- [ ] **Step 3: Коміт**

```bash
git add frontend/src/shared/lib/i18n/locales
git commit -m "i18n(day): strings for the drawer count dialog

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Верифікація й draft PR-A

- [ ] **Step 1: Повна перевірка**

Run:
```bash
npm run lint && npm test && npm run build
```
Expected: усе зелене. Числа записати — вони підуть у тіло PR.

- [ ] **Step 2: Запушити гілку**

```bash
git push -u origin feat/yagoda-day-counted-amount
```

- [ ] **Step 3: Створити draft PR із базою на гілці #62**

```bash
gh pr create --draft \
  --base feat/yagoda-transfers-cash-slice \
  --head feat/yagoda-day-counted-amount \
  --title "Каса за день: підрахунок шухляди при відкритті й закритті зміни" \
  --body-file -
```

Тіло має сказати рівно те, що сталося: #62 робить `counted_amount` обов'язковим, наявний екран шле порожнє тіло, тому без цього PR мердж #62 ламає відкриття й закриття зміни. Плюс — чому діалог не показує «очікувано». Завершити рядком `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

---

# ЧАСТИНА II — PR-B · два екрани

- [ ] **Створити гілку від PR-A**

```bash
git checkout -b feat/yagoda-cash-transfers-frontend
```

---

### Task 7: Ключі кешу для трьох нових ресурсів

**Files:**
- Modify: `frontend/src/shared/api/queryKeys.ts`

**Interfaces:**
- Produces: `queryKeys.transfers`, `queryKeys.pointCash`, `queryKeys.cashCounts` — усі префікси, як `intakes`/`payouts`.

- [ ] **Step 1: Додати ключі**

```ts
  /** Перекази — префікс для кожного фільтрованого списку; читання дописує свій фільтр. */
  transfers: ['transfers'] as const,
  /** Каса точок — префікс і для списку мережі, і для однієї точки. */
  pointCash: ['point-cash'] as const,
  /** Підрахунки каси — префікс; читання дописує точку/зміну. */
  cashCounts: ['cash-counts'] as const,
```

- [ ] **Step 2: Перевірити збірку**

Run: `npm run build -w frontend`
Expected: PASS

- [ ] **Step 3: Коміт**

```bash
git add frontend/src/shared/api/queryKeys.ts
git commit -m "feat(api): cache keys for transfers, point cash and cash counts

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: `entities/transfer`

**Files:**
- Create: `frontend/src/entities/transfer/model/transfer.ts`
- Create: `frontend/src/entities/transfer/api/useTransfers.ts`
- Create: `frontend/src/entities/transfer/api/useTransfers.test.tsx`
- Create: `frontend/src/entities/transfer/index.ts`

**Interfaces:**
- Produces:

```ts
export type TransferStatus = 'sent' | 'accepted' | 'disputed';
export interface Transfer { /* поля нижче */ }
export interface TransferFilter {
  pointId?: string; status?: TransferStatus; from?: string; to?: string;
  includeVoided?: boolean; page?: number; limit?: number;
}
export interface Paginated<T> { data: T[]; total: number; page: number; limit: number }
export function transfersQueryOptions(filter: TransferFilter): UseQueryOptions;
export function useTransfersQuery(filter: TransferFilter): UseQueryResult<Paginated<Transfer>>;
export function useTransferQuery(id: string | null): UseQueryResult<Transfer | null>;
```

- [ ] **Step 1: Модель**

```ts
// frontend/src/entities/transfer/model/transfer.ts

/** Дзеркалить бекендовий `TransferStatus` (`transfers/transfer-status.enum.ts`). */
export type TransferStatus = 'sent' | 'accepted' | 'disputed';

/** Дзеркалить `TransferResponse` (`transfers/transfer.mapper.ts`). */
export interface Transfer {
  id: string;
  collection_point_id: string;
  /** Скільки відправили. Рядок — гроші ніколи не `number`. */
  cash: string;
  crates: number;
  carrier: string;
  sent_by_user_id: string;
  sent_at: string;
  status: TransferStatus;
  accepted_by_user_id: string | null;
  /** Бізнес-дата зміни, В ЯКІЙ переказ прийняли — не день відправлення. */
  accepted_date: string | null;
  accepted_at: string | null;
  /** Скільки нарахувала точка, коли не зійшлося. */
  reported_cash: string | null;
  reported_crates: number | null;
  dispute_note: string | null;
  /** Чим керівник закрив спір. */
  resolved_cash: string | null;
  resolved_crates: number | null;
  resolved_by_user_id: string | null;
  resolved_at: string | null;
  /** Різниця, порахована бекендом; `null` поки спору немає. */
  cash_discrepancy: string | null;
  crates_discrepancy: number | null;
  correction_of_transfer_id: string | null;
  voided_at: string | null;
  voided_by_user_id: string | null;
  void_reason: string | null;
  created_at: string;
}

/**
 * Дубльовано з `entities/payout/model/payout.ts`, а не імпортовано — FSD
 * забороняє cross-import у межах шару. Це зафіксована ціна методології.
 */
export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface TransferFilter {
  pointId?: string;
  status?: TransferStatus;
  from?: string;
  to?: string;
  includeVoided?: boolean;
  page?: number;
  limit?: number;
}
```

- [ ] **Step 2: Написати падючий тест**

```tsx
// frontend/src/entities/transfer/api/useTransfers.test.tsx
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ReactNode } from 'react';
import { httpClient, attachAuthInterceptors } from '@/shared/api';
import { useTransfersQuery, useTransferQuery } from './useTransfers';

attachAuthInterceptors(httpClient, { getToken: () => null, onUnauthorized: () => {} });

let mock: MockAdapter;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);
const page = { data: [], total: 0, page: 1, limit: 100 };

beforeEach(() => {
  mock = new MockAdapter(httpClient);
});
afterEach(() => mock.restore());

describe('useTransfersQuery', () => {
  it('maps the filter onto the API snake_case params', async () => {
    mock
      .onGet('/transfers', {
        params: {
          collection_point_id: 'p1',
          status: 'sent',
          include_voided: false,
          limit: 100,
        },
      })
      .reply(200, page);
    const { result } = renderHook(
      () => useTransfersQuery({ pointId: 'p1', status: 'sent' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data).toEqual(page));
  });

  it('defaults include_voided to false — a voided transfer is not added back', async () => {
    mock.onGet('/transfers').reply(200, page);
    renderHook(() => useTransfersQuery({ pointId: 'p1' }), { wrapper });
    await waitFor(() => expect(mock.history.get).toHaveLength(1));
    expect(mock.history.get[0].params.include_voided).toBe(false);
  });
});

describe('useTransferQuery', () => {
  it('does not fire without an id', () => {
    const { result } = renderHook(() => useTransferQuery(null), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });
});
```

- [ ] **Step 3: Переконатися, що падає**

Run: `npm test -w frontend -- src/entities/transfer`
Expected: FAIL — модуля немає.

- [ ] **Step 4: Реалізація хуків**

Взірець — `frontend/src/entities/payout/api/usePayouts.ts`. Ключові рішення:

```ts
/**
 * `include_voided` за замовчуванням FALSE, і це протилежно до документів
 * (`usePayouts` шле true). Причина в §9.3: сторнований ПЕРЕКАЗ перестає
 * додаватися до каси, тоді як сторнована ВИПЛАТА лишається віднятою. Список,
 * який за замовчуванням показував би сторновані перекази, читався б як гроші,
 * що є на точці, — а їх там немає.
 */
export function transferParams(f: TransferFilter) {
  return {
    ...(f.pointId ? { collection_point_id: f.pointId } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.from ? { from: f.from } : {}),
    ...(f.to ? { to: f.to } : {}),
    ...(f.page ? { page: f.page } : {}),
    include_voided: f.includeVoided ?? false,
    limit: f.limit ?? 100,
  };
}
```

`transfersQueryOptions(filter)` — `queryKey: [...queryKeys.transfers, filter]`, `staleTime: STALE.list`, без `enabled`-обмеження (керівникові потрібен і список усієї мережі). `useTransferQuery(id)` — `enabled: id !== null`, ключ `[...queryKeys.transfers, 'one', id]`.

- [ ] **Step 5: Публічний API зрізу**

```ts
// frontend/src/entities/transfer/index.ts
export type { Transfer, TransferStatus, TransferFilter, Paginated } from './model/transfer';
export { useTransfersQuery, useTransferQuery, transfersQueryOptions } from './api/useTransfers';
```

- [ ] **Step 6: Тести зелені**

Run: `npm test -w frontend -- src/entities/transfer`
Expected: PASS

- [ ] **Step 7: Коміт**

```bash
git add frontend/src/entities/transfer
git commit -m "feat(transfer): entity slice for transfers

include_voided defaults to false here and to true for documents: a voided
transfer stops being added to a point's cash, so listing them by default
would read as money the point does not have.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: `entities/point-cash`

**Files:**
- Create: `frontend/src/entities/point-cash/model/point-cash.ts`
- Create: `frontend/src/entities/point-cash/api/usePointCash.ts`
- Create: `frontend/src/entities/point-cash/api/usePointCash.test.tsx`
- Create: `frontend/src/entities/point-cash/index.ts`

**Interfaces:**
- Produces:

```ts
export interface PointCashRow {
  collection_point_id: string;
  name: string;
  /** `null` = наділу не призначали. НЕ нуль — §6.9. */
  target_cash: string | null;
  cash: string;
  /** `null` коли `target_cash` порожній: порівнювати нема з чим (§7.10). */
  shortfall: string | null;
  unexplained_difference: string;
  latest_transfer: { status: TransferStatus; sent_at: string } | null;
}
export interface PointCashOne { collection_point_id: string; cash: string }
export function usePointCashQuery(opts?: { asOf?: string }): UseQueryResult<Paginated<PointCashRow>>;
export function usePointCashForPointQuery(pointId: string | null, asOf?: string): UseQueryResult<PointCashOne | null>;
```

`TransferStatus` тут **дублюється рядковим union** (`'sent' | 'accepted' | 'disputed'`), а не імпортується з `entities/transfer` — cross-import у межах шару заборонений. Дублікат супроводжується коментарем, як `Paginated` у `entities/payout`.

- [ ] **Step 1: Написати падючий тест**

```tsx
// frontend/src/entities/point-cash/api/usePointCash.test.tsx — каркас як у Task 8
describe('usePointCashQuery', () => {
  it('reads the network list and passes as_of through', async () => {
    mock.onGet('/point-cash', { params: { as_of: '2026-09-10', limit: 100 } }).reply(200, page);
    const { result } = renderHook(() => usePointCashQuery({ asOf: '2026-09-10' }), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(page));
  });
});

describe('usePointCashForPointQuery', () => {
  it('reads one point and does not fire without one', async () => {
    const idle = renderHook(() => usePointCashForPointQuery(null), { wrapper });
    expect(idle.result.current.fetchStatus).toBe('idle');

    mock.onGet('/point-cash/p1').reply(200, { collection_point_id: 'p1', cash: '0.00' });
    const { result } = renderHook(() => usePointCashForPointQuery('p1'), { wrapper });
    await waitFor(() => expect(result.current.data?.cash).toBe('0.00'));
  });
});
```

- [ ] **Step 2: Переконатися, що падає**

Run: `npm test -w frontend -- src/entities/point-cash`
Expected: FAIL

- [ ] **Step 3: Реалізація**

Ключі: `[...queryKeys.pointCash, filter]` і `[...queryKeys.pointCash, 'one', pointId, asOf ?? null]`. `staleTime: STALE.list`. `usePointCashForPointQuery` — `enabled: pointId !== null`.

- [ ] **Step 4: Тести зелені + коміт**

Run: `npm test -w frontend -- src/entities/point-cash`

```bash
git add frontend/src/entities/point-cash
git commit -m "feat(point-cash): entity slice for a point's cash figure

target_cash and shortfall are nullable and must stay that way: a point with
no target is «not set», never zero (§6.9), and a zero would put it into the
network debt table it is meant to stay out of (§7.10).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: `entities/cash-count`

**Files:**
- Create: `frontend/src/entities/cash-count/model/cash-count.ts`
- Create: `frontend/src/entities/cash-count/api/useCashCounts.ts`
- Create: `frontend/src/entities/cash-count/api/useCashCounts.test.tsx`
- Create: `frontend/src/entities/cash-count/index.ts`

**Interfaces:**
- Produces:

```ts
export type CashBook = 'berry' | 'crates';
export type CashCountKind = 'opening' | 'midday' | 'closing';
export interface CashCount {
  id: string; shift_id: string; collection_point_id: string; business_date: string;
  book: CashBook; kind: CashCountKind;
  counted_amount: string; expected_amount: string;
  /** `counted - expected`, пораховано бекендом. */
  discrepancy: string;
  /** Розбіжність є і її ще не пояснили. */
  is_open: boolean;
  counted_by_user_id: string; counted_at: string; explanation: string | null;
}
export interface CashCountFilter {
  pointId?: string; shiftId?: string; from?: string; to?: string;
  onlyDiscrepancies?: boolean; page?: number; limit?: number;
}
export function useCashCountsQuery(filter: CashCountFilter): UseQueryResult<Paginated<CashCount>>;
```

- [ ] **Step 1: Тест**

```tsx
it('maps onlyDiscrepancies onto only_discrepancies', async () => {
  mock.onGet('/cash-counts').reply(200, page);
  renderHook(() => useCashCountsQuery({ pointId: 'p1', onlyDiscrepancies: true }), { wrapper });
  await waitFor(() => expect(mock.history.get).toHaveLength(1));
  expect(mock.history.get[0].params).toMatchObject({
    collection_point_id: 'p1',
    only_discrepancies: true,
  });
});
```

- [ ] **Step 2–4: Падає → реалізація → зелено → коміт**

Run: `npm test -w frontend -- src/entities/cash-count`

```bash
git add frontend/src/entities/cash-count
git commit -m "feat(cash-count): entity slice for drawer counts

There is no POST: a count is born only by opening or closing a shift, so
this slice is read-only by design, not by omission.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: `apiErrorToBanner` переїжджає в `shared`

Дві копії вже є (`features/void-document/lib`, `pages/day/lib`); цей слайс додав би ще чотири споживачі.

**Files:**
- Create: `frontend/src/shared/lib/api-error/index.ts`
- Create: `frontend/src/shared/lib/api-error/apiErrorToBanner.ts`
- Create: `frontend/src/shared/lib/api-error/apiErrorToBanner.test.ts`
- Modify: `frontend/src/features/void-document/lib/apiErrorToBanner.ts` → реекспорт
- Modify: `frontend/src/pages/day/lib/apiErrorToBanner.ts` → реекспорт

**Interfaces:**
- Produces: `apiErrorToBanner(error: unknown): string` — повертає **i18n-ключ**, не готовий текст.

- [ ] **Step 1: Звести дві наявні копії**

Прочитати обидві. Якщо вони розійшлися — об'єднана версія має покривати **обидва** набори кодів; жоден наявний тест не має впасти.

- [ ] **Step 2: Перенести тести**

Обидва наявні `apiErrorToBanner.test.ts` зливаються в
`shared/lib/api-error/apiErrorToBanner.test.ts`. Старі тестові файли видаляються разом зі старими реалізаціями.

- [ ] **Step 3: Реалізація + реекспорти**

```ts
// frontend/src/features/void-document/lib/apiErrorToBanner.ts
export { apiErrorToBanner } from '@/shared/lib/api-error';
```

(те саме в `pages/day/lib/apiErrorToBanner.ts`)

- [ ] **Step 4: Додати коди цього слайсу**

```ts
/**
 * Коди, які #62 віддає навмисно — банер має пояснювати ПРИЧИНУ, а не «щось
 * пішло не так»:
 *  · прийняти переказ без відкритої зміни → 409: `accepted_date` береться зі
 *    зміни, тому переказ поза зміною не належить жодній арифметиці;
 *  · вирішити спір — лише керівник → 403;
 *  · сторнувати вже прийнятий переказ → правила §9.3.
 */
```

- [ ] **Step 5: Зелено + коміт**

Run: `npm test -w frontend && npm run lint -w frontend`

```bash
git add frontend/src/shared/lib/api-error frontend/src/features/void-document/lib frontend/src/pages/day/lib
git commit -m "refactor(errors): one apiErrorToBanner for every screen

Two copies existed; this slice would have added four consumers. Both old
paths stay as re-exports so no import site churns.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: `features/send-transfer`

**Files:**
- Create: `frontend/src/features/send-transfer/api/useSendTransfer.ts` (+ `.test.tsx`)
- Create: `frontend/src/features/send-transfer/ui/SendTransferDialog.tsx` (+ `.test.tsx`)
- Create: `frontend/src/features/send-transfer/index.ts`

**Interfaces:**
- Consumes: `queryKeys.transfers`, `queryKeys.pointCash`; `DECIMAL_INPUT`, `normalizeAmount`.
- Produces:

```ts
export function useSendTransferMutation(): UseMutationResult<Transfer, unknown, {
  collection_point_id: string; cash: string; crates: number; carrier: string;
  correction_of_transfer_id?: string;
}>;
export function SendTransferDialog(props: {
  pointId: string; pointName: string; open: boolean; onClose: () => void;
}): JSX.Element;
```

- [ ] **Step 1: Тест мутації**

```tsx
it('posts the transfer and invalidates transfers AND point cash together', async () => {
  mock.onPost('/transfers').reply(201, { id: 't1' });
  const qc = new QueryClient();
  const spy = vi.spyOn(qc, 'invalidateQueries');
  const { result } = renderHook(() => useSendTransferMutation(), { wrapper: wrapperFor(qc) });
  await result.current.mutateAsync({
    collection_point_id: 'p1', cash: '50000.00', crates: 120, carrier: 'Петро',
  });
  await waitFor(() => {
    expect(spy).toHaveBeenCalledWith({ queryKey: ['transfers'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['point-cash'] });
  });
});
```

- [ ] **Step 2: Тест діалогу**

```tsx
it('refuses a transfer that is neither money nor crates', async () => {
  // бекендовий CHK_transfers_not_empty: cash > 0 OR crates > 0
  render(<SendTransferDialog pointId="p1" pointName="Шипинки" open onClose={() => {}} />);
  await userEvent.click(screen.getByRole('button', { name: /submit|Відправити/i }));
  expect(await screen.findByRole('alert')).toBeInTheDocument();
});
```

- [ ] **Step 3: Реалізація**

Форма: `cash` (`TextInput inputMode="decimal"`), `crates` (`TextInput inputMode="numeric"`, ціле ≥ 0), `carrier` (`TextInput`, 1–200, не порожній). Клієнтська перевірка «не порожній переказ» дзеркалить `CHK_transfers_not_empty` — щоб людина дізналась про це до запиту, а не з 400. Каркас — `ReopenShiftDialog`.

- [ ] **Step 4: Зелено + коміт**

```bash
git add frontend/src/features/send-transfer
git commit -m "feat(send-transfer): the owner sends money and crates to a point

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: `features/receive-transfer` — «Прийняв» і «Не сходиться»

**Files:**
- Create: `frontend/src/features/receive-transfer/api/useReceiveTransfer.ts` (+ `.test.tsx`)
- Create: `frontend/src/features/receive-transfer/ui/DisputeTransferDialog.tsx` (+ `.test.tsx`)
- Create: `frontend/src/features/receive-transfer/index.ts`

**Interfaces:**
- Produces:

```ts
export function useAcceptTransferMutation(): UseMutationResult<Transfer, unknown, string /* id */>;
export function useDisputeTransferMutation(): UseMutationResult<Transfer, unknown, {
  id: string; reported_cash: string; reported_crates: number; dispute_note: string;
}>;
export function DisputeTransferDialog(props: {
  transfer: Transfer; open: boolean; onClose: () => void;
}): JSX.Element;
```

- [ ] **Step 1: Тест — прийняття інвалідує обидва ресурси**

```tsx
it('accepting invalidates transfers, point cash and shifts', async () => {
  mock.onPost('/transfers/t1/accept').reply(200, { id: 't1', status: 'accepted' });
  // очікувані ключі: ['transfers'], ['point-cash'], ['shifts']
});
```

`shifts` теж — прийняття вимагає **відкритої зміни**, і `accepted_date` береться з неї.

- [ ] **Step 2: Тест діалогу спору**

```tsx
it('requires a note — the discrepancy is what the owner reads', async () => {
  render(<DisputeTransferDialog transfer={sent} open onClose={() => {}} />);
  await userEvent.type(screen.getByLabelText(/reported|Нарахували/i), '49500');
  await userEvent.click(screen.getByRole('button', { name: /submit|Надіслати/i }));
  expect(await screen.findByRole('alert')).toBeInTheDocument();
});
```

- [ ] **Step 3: Реалізація**

Діалог показує, **скільки відправили** (`transfer.cash`, `transfer.crates`), і питає, скільки нарахували насправді + нотатку (1–500, не порожня). Тут показ очікуваного правильний — на відміну від підрахунку шухляди, це звірка з накладною, а не сліпий контроль.

- [ ] **Step 4: Зелено + коміт**

```bash
git add frontend/src/features/receive-transfer
git commit -m "feat(receive-transfer): the point accepts or disputes what arrived

Unlike the drawer count, this dialog DOES show the sent figure: it is a
reconciliation against a delivery note, not a blind control.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: `features/resolve-transfer`

**Files:**
- Create: `frontend/src/features/resolve-transfer/api/useResolveTransfer.ts` (+ `.test.tsx`)
- Create: `frontend/src/features/resolve-transfer/ui/ResolveTransferDialog.tsx` (+ `.test.tsx`)
- Create: `frontend/src/features/resolve-transfer/index.ts`

**Interfaces:**
- Produces:

```ts
export function useResolveTransferMutation(): UseMutationResult<Transfer, unknown, {
  id: string; resolved_cash: string; resolved_crates: number;
}>;
export function ResolveTransferDialog(props: {
  transfer: Transfer; open: boolean; onClose: () => void;
}): JSX.Element;
```

- [ ] **Step 1: Тест**

```tsx
it('defaults to what the point reported — the owner confirms or overrides', () => {
  render(<ResolveTransferDialog transfer={disputed} open onClose={() => {}} />);
  expect(screen.getByLabelText(/resolved|Зараховуємо/i)).toHaveValue('49500.00');
});
```

Дефолт саме `reported_*`: доки спір не вирішено, каса точки й так рахує **її власне** число (§7.9 у редакції 09.09.2026 — гроші зараховуються в сумі, яку фактично отримали). Дефолт, що дорівнює відправленому, тихо переписав би цю суму.

- [ ] **Step 2–4: Реалізація, зелено, коміт**

```bash
git add frontend/src/features/resolve-transfer
git commit -m "feat(resolve-transfer): the owner settles a disputed transfer

The form defaults to what the point reported, not to what was sent: an
unresolved dispute already credits the point's own figure, and a default
equal to the sent amount would quietly overwrite it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 15: Сторнування переказу — розширення `void-document`

**Files:**
- Modify: `frontend/src/features/void-document/api/useVoidDocument.ts`
- Modify: `frontend/src/features/void-document/api/useVoidDocument.test.tsx`
- Modify: `frontend/src/features/void-document/ui/VoidDocumentDialog.tsx` (тип пропа `kind`)

**Interfaces:**
- Produces: `VoidDocumentInput.kind: 'intake' | 'payout' | 'transfer'`

- [ ] **Step 1: Тест**

```tsx
it('voids a transfer and invalidates transfers + point cash, not supplier balances', async () => {
  mock.onPost('/transfers/t1/void').reply(200);
  // очікувані: ['transfers'], ['point-cash']; ['supplier-balances'] НЕ чіпається
});
```

Сторнування переказу не рухає баланс постачальника — інвалідувати його означало б зайвий мережевий шум і натяк на зв'язок, якого немає.

- [ ] **Step 2: Реалізація**

```ts
const PATHS = {
  intake: (id: string) => `/intakes/${id}/void`,
  payout: (id: string) => `/payouts/${id}/void`,
  transfer: (id: string) => `/transfers/${id}/void`,
} as const;
```

`onSuccess` розгалужується за `kind`: документи чіпають `intakes`/`payouts`/`supplierBalances`, переказ — `transfers`/`pointCash`.

- [ ] **Step 3: Зелено + коміт**

```bash
git add frontend/src/features/void-document
git commit -m "feat(void): a transfer can be voided through the same dialog

Its invalidation differs: a voided transfer moves point cash, not a
supplier's balance.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 16: `features/set-cash-explanation`

**Files:**
- Create: `frontend/src/features/set-cash-explanation/api/useSetCashExplanation.ts` (+ `.test.tsx`)
- Create: `frontend/src/features/set-cash-explanation/ui/ExplainDiscrepancyDialog.tsx` (+ `.test.tsx`)
- Create: `frontend/src/features/set-cash-explanation/index.ts`

**Interfaces:**
- Produces:

```ts
export function useSetCashExplanationMutation(): UseMutationResult<Shift, unknown, {
  shiftId: string; explanation: string;
}>;
export function ExplainDiscrepancyDialog(props: {
  shiftId: string; discrepancy: string; open: boolean; onClose: () => void;
}): JSX.Element;
```

- [ ] **Step 1: Тест — це `PUT`, не `POST`**

```tsx
it('PUTs the explanation and invalidates shifts and cash counts', async () => {
  mock.onPut('/shifts/s1/explanation').reply(200, { id: 's1' });
  // тіло: { explanation: 'здачу віддали з іншої шухляди' }
  // ключі: ['shifts'], ['cash-counts']
});
```

- [ ] **Step 2–3: Реалізація, зелено, коміт**

Каркас — `ReopenShiftDialog`: `Textarea`, обов'язкове, 1–2000. Заголовок називає розмір розбіжності, щоб клік не був наосліп.

```bash
git add frontend/src/features/set-cash-explanation
git commit -m "feat(cash): the owner explains a drawer discrepancy after the fact

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 17: `features/set-point-target`

**Files:**
- Create: `frontend/src/features/set-point-target/api/useSetPointTarget.ts` (+ `.test.tsx`)
- Create: `frontend/src/features/set-point-target/ui/SetTargetCashDialog.tsx` (+ `.test.tsx`)
- Create: `frontend/src/features/set-point-target/index.ts`

**Interfaces:**
- Produces:

```ts
export function useSetPointTargetMutation(): UseMutationResult<unknown, unknown, {
  pointId: string; target_cash: string; reason: string;
}>;
export function SetTargetCashDialog(props: {
  pointId: string; pointName: string; currentTarget: string | null;
  open: boolean; onClose: () => void;
}): JSX.Element;
```

- [ ] **Step 1: Тест**

```tsx
it('PATCHes the point with a mandatory reason and invalidates point cash', async () => {
  mock.onPatch('/collection-points/p1').reply(200, {});
  // тіло: { target_cash: '500000.00', reason: 'розширили точку' }
  // ключі: ['point-cash'], ['collection-points']
});
```

- [ ] **Step 2: Тест попередження, а не заборони**

```tsx
it('warns when the new target is below what is already out, but still submits', async () => {
  // §6.1 — менший наділ дозволений З ПОПЕРЕДЖЕННЯМ. Кнопка НЕ блокується.
});
```

- [ ] **Step 3–4: Реалізація, зелено, коміт**

```bash
git add frontend/src/features/set-point-target
git commit -m "feat(point-target): the owner changes a point's cash target

A lower target warns and still submits (§6.1): a target is a management
decision, and a blocked button teaches people to look for a way around it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 18: Заглушка «ще не рахується»

Одна на обидва екрани — щоб текст і вигляд не розійшлися.

**Files:**
- Create: `frontend/src/shared/ui/pending-slice.tsx`
- Create: `frontend/src/shared/ui/pending-slice.test.tsx`

**Interfaces:**
- Produces:

```ts
export function PendingSlice(props: {
  /** Що саме ще не рахується — «Каса за ящики». */
  label: string;
  /** Один рядок пояснення. */
  note: string;
  /** `inline` — для клітинки таблиці; `block` — для секції-картки. */
  variant?: 'inline' | 'block';
}): JSX.Element;
```

- [ ] **Step 1: Тест**

```tsx
it('never renders an em dash — that already means «no target was set»', () => {
  render(<PendingSlice label="Каса за ящики" note="Ящики будуть у наступному слайсі" />);
  expect(screen.queryByText('—')).toBeNull();
  expect(screen.getByText(/наступному слайсі/)).toBeInTheDocument();
});

it('is announced to screen readers as unavailable data, not as a value', () => {
  render(<PendingSlice label="Ящиків" note="…" variant="inline" />);
  expect(screen.getByRole('note')).toBeInTheDocument();
});
```

- [ ] **Step 2: Реалізація**

```tsx
/**
 * Місце під число, джерела для якого ще немає.
 *
 * ЧОМУ НЕ «—» І НЕ ПОРОЖНЕЧА. `—` у цьому продукті вже означає «наділу не
 * призначали»; той самий символ у другому значенні зробив би екран тихо
 * брехливим. Порожнеча вчить читача, що такої величини в продукті немає
 * взагалі. Тому — явний підпис: користувач бачить межу даних, а не баг, і
 * місце лишається зарезервованим під слайс ящиків.
 */
```

Візуально: приглушений текст, пунктирна рамка (`border-dashed`), `role="note"`. `inline` — один рядок дрібним шрифтом у клітинці; `block` — картка з `Eyebrow` заголовком.

- [ ] **Step 3: Зелено + коміт**

```bash
git add frontend/src/shared/ui/pending-slice.tsx frontend/src/shared/ui/pending-slice.test.tsx
git commit -m "feat(ui): a labelled placeholder for data that has no source yet

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 19: `pages/point-cash` — «Каса точки»

**Files:**
- Create: `frontend/src/pages/point-cash/ui/PointCashPage.tsx` (+ `.test.tsx`)
- Create: `frontend/src/pages/point-cash/ui/CashLedger.tsx` (+ `.test.tsx`)
- Create: `frontend/src/pages/point-cash/ui/IncomingTransfers.tsx` (+ `.test.tsx`)
- Create: `frontend/src/pages/point-cash/ui/CashCountHistory.tsx` (+ `.test.tsx`)
- Create: `frontend/src/pages/point-cash/lib/buildLedger.ts` (+ `.test.ts`)
- Create: `frontend/src/pages/point-cash/index.ts`

**Interfaces:**
- Consumes: `usePointCashQuery`/`usePointCashForPointQuery`, `useTransfersQuery`, `useCashCountsQuery`, `useIntakesQuery`, `usePayoutsQuery`, `usePointScope`, `useMeQuery`, всі features Tasks 12–18.
- Produces: `PointCashPage` (default-експорт зрізу), `buildLedger(input): LedgerRow[]`.

**Розкладка екрана** (за моком `PointCashPage.tsx:160-250`):

1. `PageHeader` + `DateStepper`.
2. Три `StatTile`: **Наділ** (`target_cash`), **У касі за ягоду** (`cash`), **Не хватає до наділу** (`shortfall`).
3. `IncomingTransfers` — `useTransfersQuery({ pointId, status: 'sent' })`.
4. `CashLedger` — на `shared/ui/ledger-row`.
5. `PendingSlice` «Каса за ящики».
6. Плитка «У шухляді має бути» — `cash` + підпис «лише ягода».
7. `CashCountHistory` — `useCashCountsQuery({ pointId })`.
8. `SetTargetCashDialog` — **лише для owner**.

- [ ] **Step 1: Тест `buildLedger` — чиста функція, тестується першою**

```ts
// frontend/src/pages/point-cash/lib/buildLedger.test.ts
import { describe, it, expect } from 'vitest';
import { buildLedger } from './buildLedger';

describe('buildLedger', () => {
  it('splits payouts into today\'s berry and past debts', () => {
    const rows = buildLedger({
      date: '2026-09-10',
      intakes: [{ business_date: '2026-09-10', amount: '1000.00', voided_at: null }],
      payouts: [
        { business_date: '2026-09-10', amount: '600.00', voided_at: null },
        { business_date: '2026-09-09', amount: '400.00', voided_at: null },
      ],
      transfers: [],
    });
    expect(rows.find((r) => r.key === 'paidToday')?.value).toBe('600.00');
    expect(rows.find((r) => r.key === 'paidPast')?.value).toBe('400.00');
  });

  it('ignores voided documents — a void is not a movement', () => {
    const rows = buildLedger({
      date: '2026-09-10',
      intakes: [],
      payouts: [{ business_date: '2026-09-10', amount: '999.00', voided_at: '2026-09-10T10:00:00Z' }],
      transfers: [],
    });
    expect(rows.find((r) => r.key === 'paidToday')?.value).toBe('0.00');
  });

  it('counts a transfer at what was actually credited, not what was sent', () => {
    const rows = buildLedger({
      date: '2026-09-10',
      intakes: [],
      payouts: [],
      transfers: [
        {
          accepted_date: '2026-09-10', status: 'disputed', voided_at: null,
          cash: '50000.00', reported_cash: '49500.00', resolved_cash: null,
        },
      ],
    });
    // §7.9 (ред. 09.09.2026): неврегульований спір зараховує ЧИСЛО ТОЧКИ.
    expect(rows.find((r) => r.key === 'cashIn')?.value).toBe('49500.00');
  });
});
```

- [ ] **Step 2: Переконатися, що падає, і реалізувати `buildLedger`**

Уся арифметика через `@/shared/lib/money`. Порядок зарахування переказу: `resolved_cash ?? reported_cash ?? cash`. Сторновані перекази (`voided_at !== null`) **не рахуються** (§9.3 — на відміну від виплат).

- [ ] **Step 3: Тести сторінки**

```tsx
it('shows «—» for a point with no target, never a zero', async () => { /* … */ });

it('says the drawer was never counted instead of printing a bare 0,00', async () => {
  // GET /cash-counts → порожньо, GET /point-cash/:id → { cash: '0.00' }
  expect(await screen.findByText(/ще не рахована|never counted/i)).toBeInTheDocument();
});

it('does not render the target button for an operator AT ALL (§10.2)', async () => {
  // me.role = 'point_operator'
  expect(screen.queryByRole('button', { name: /наділ|target/i })).toBeNull();
});

it('shows the backend cash figure as the total, not the sum of ledger rows', async () => {
  // point-cash каже 1000.00; рядки складаються в 900.00 — на екрані 1000.00
});

it('reserves the crates section with a labelled placeholder', async () => {
  expect(await screen.findByRole('note')).toBeInTheDocument();
});
```

- [ ] **Step 4: Реалізація сторінки, зелено**

Run: `npm test -w frontend -- src/pages/point-cash`

- [ ] **Step 5: Коміт**

```bash
git add frontend/src/pages/point-cash
git commit -m "feat(point-cash): the Каса точки screen

The ledger explains the figure; the figure itself is the server's. Where
the two disagree we print the server's and leave the gap visible — a quiet
discrepancy is worse than a visible one.

A point with no counts reads 0.00 and says so in words: correct per §7.3,
but it would read as a regression without the caption.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 20: `pages/transfers` — «Перекази»

**Files:**
- Create: `frontend/src/pages/transfers/ui/TransfersPage.tsx` (+ `.test.tsx`)
- Create: `frontend/src/pages/transfers/ui/PointDebtTable.tsx` (+ `.test.tsx`)
- Create: `frontend/src/pages/transfers/ui/TransferStatusBadge.tsx` (+ `.test.tsx`)
- Create: `frontend/src/pages/transfers/ui/TransferHistory.tsx` (+ `.test.tsx`)
- Create: `frontend/src/pages/transfers/index.ts`

**Interfaces:**
- Consumes: `usePointCashQuery`, `useTransfersQuery`, features Tasks 12/14/15.

**Таблиця** (`GET /point-cash`, рядок на точку): Точка · наділ · у касі · не хватає · ящиків (`PendingSlice variant="inline"`) · стан (`TransferStatusBadge` з `latest_transfer`).

- [ ] **Step 1: Тести**

```tsx
it('prints «—» for a point with no target and no shortfall', async () => { /* … */ });

it('puts a labelled placeholder in the crates column, not a zero', async () => {
  const cell = (await screen.findAllByRole('note'))[0];
  expect(cell).toBeInTheDocument();
  expect(screen.queryByText('0 ящ.')).toBeNull();
});

it('shows the badge of the latest transfer, and nothing when there is none', async () => { /* … */ });

it('offers «Вирішити» only on a disputed transfer', async () => { /* … */ });
```

- [ ] **Step 2–3: Реалізація, зелено**

Run: `npm test -w frontend -- src/pages/transfers`

- [ ] **Step 4: Коміт**

```bash
git add frontend/src/pages/transfers
git commit -m "feat(transfers): the owner's transfers and point-debt screen

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 21: Маршрути й навігація

**Files:**
- Modify: `frontend/src/app/router.tsx`
- Modify: `frontend/src/app/router.test.tsx`
- Modify: `frontend/src/app/layouts/AppLayout.tsx`

- [ ] **Step 1: Тест маршрутів**

```tsx
it('keeps /transfers away from an operator', async () => {
  // me.role = 'point_operator' → редірект/відмова, не рендер сторінки
});

it('lets both roles onto /point-cash', async () => { /* … */ });
```

- [ ] **Step 2: Маршрути**

```tsx
{
  // Лише керівник: заборгованість перед ІНШИМИ точками — не справа
  // приймальника (§7, G16). Тому роль-гейт маршруту, а не сірі кнопки.
  path: '/transfers',
  element: (
    <RequireAuth>
      <RequireRole role="network_owner">
        <TransfersPage />
      </RequireRole>
    </RequireAuth>
  ),
},
{
  // Обидві ролі: приймальник прибитий до своєї точки токеном, керівник
  // обирає точку. Дії всередині гейтяться `me.role`, не маршрутом.
  path: '/point-cash',
  element: (
    <RequireAuth>
      <PointCashPage />
    </RequireAuth>
  ),
},
```

- [ ] **Step 3: Навігація**

`AppLayout.tsx:64` і `:85` уже мають `nav.pointCash` і `nav.transfers` **без `to:`** — місця зарезервовані. Дописати:

```ts
{ labelKey: 'nav.pointCash', icon: Banknote, to: '/point-cash' },
{ labelKey: 'nav.transfers', icon: ArrowLeftRight, to: '/transfers', role: 'network_owner' },
```

- [ ] **Step 4: Зелено + коміт**

```bash
git add frontend/src/app
git commit -m "feat(router): wire up /point-cash and /transfers

Both nav entries already existed without a target — the placeholders now
lead somewhere.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 22: Локалізація PR-B, повна верифікація, draft PR

**Files:**
- Modify: `frontend/src/shared/lib/i18n/locales/uk.json`, `en.json`

- [ ] **Step 1: Пройти всі нові рядки**

Знайти кожен `t('…')`, доданий у Tasks 12–21, і переконатися, що ключ існує в **обох** файлах. Швидка перевірка на сирі ключі:

```bash
grep -rhoE "t\('([a-zA-Z0-9_.]+)'" frontend/src/pages/point-cash frontend/src/pages/transfers frontend/src/features/send-transfer frontend/src/features/receive-transfer frontend/src/features/resolve-transfer frontend/src/features/set-cash-explanation frontend/src/features/set-point-target \
  | sed -E "s/t\('//;s/'//" | sort -u
```

Кожен ключ зі списку має знайтися в `uk.json` і в `en.json`.

- [ ] **Step 2: Повна перевірка**

Run:
```bash
npm run lint && npm test && npm run build
```
Expected: усе зелене. Записати числа сюїт/тестів.

- [ ] **Step 3: Рев'ю власної роботи**

REQUIRED SUB-SKILL: `superpowers:requesting-code-review`. Дефекти виправити до створення PR.

- [ ] **Step 4: Запушити й створити draft PR**

```bash
git push -u origin feat/yagoda-cash-transfers-frontend
gh pr create --draft \
  --base feat/yagoda-day-counted-amount \
  --head feat/yagoda-cash-transfers-frontend \
  --title "Каса точки і Перекази: фронтенд на бекенді #62" \
  --body-file -
```

Тіло PR має назвати:
- що перенесено і **чому саме ці два екрани** (єдині з семи, під якими є бекенд);
- **заглушку ящиків** і чому не «—»;
- що підсумок розкладу — число сервера, а не сума рядків;
- **ризик координації**: hlibVasylevskyi має ці два екрани локально незакоміченими (опис #62);
- що PR стоїть на `feat/yagoda-day-counted-amount`, а той — на #62, і обидва мають злитися в цьому порядку.

Завершити рядком `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 5: Зв'язати стек**

```bash
gh stack link 45 feat/yagoda-day-counted-amount
gh stack link 45 feat/yagoda-cash-transfers-frontend
```

(Якщо стек #45 уже закритий — створити новий і назвати його номер у тілах обох PR.)

---

## Self-Review

**Покриття спеки:**

| Розділ спеки | Задача |
|---|---|
| §1.1 ремонт Day | Tasks 2–5 |
| §2 розкладка по PR | Tasks 6, 22 |
| §3 заглушка ящиків | Task 18, застосована в 19 і 20 |
| §4 перелік API | Tasks 8–10 (читання), 12–17 (дії) |
| §5 PR-A | Tasks 1–6 |
| §6 entity-зрізи | Tasks 7–10 |
| §7 features | Tasks 12–17 |
| §8.1 `pages/transfers` | Task 20 |
| §8.2 `pages/point-cash` | Task 19 |
| §9 звідки числа | Task 19 (`buildLedger` + тест «сервер, не сума рядків») |
| §10 помилки | Task 11 |
| §11 тести | у кожній задачі |
| §12 чого немає | Task 18 закріплює межу |
| §13 ризик координації | Task 22 Step 4 |

**Узгодженість типів:** `Transfer` (Task 8) споживається в 12–15, 19, 20 — назви полів узяті з `transfer.mapper.ts` дослівно. `PointCashRow` (Task 9) — з `point-cash.mapper.ts`. `CashCount` (Task 10) — з `cash-count.mapper.ts`. `normalizeAmount`/`DECIMAL_INPUT` визначені в Task 1 і споживаються в 4, 12, 13, 14, 17 під тими самими іменами.

**Заглушок немає:** кожен крок несе або код, або точну команду з очікуваним результатом.

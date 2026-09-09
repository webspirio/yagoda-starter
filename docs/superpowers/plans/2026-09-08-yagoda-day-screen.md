# «Каса за день» (Day Screen) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The first money screen — `/day`: see the point's shift for a date, open/close/reopen it by role, and read the day's receipts and payouts with display totals.

**Architecture:** New FSD slices: `shared/lib/money` (integer-kopiyka arithmetic + formatting, display only), `shared/lib/date` (ISO-date helpers), `entities/shift` (shift types + reads), `entities/intake` and `entities/payout` (header types + list reads, reused by the next portions), `usePointScope` in `entities/user` (operator's own point / owner's picked point), and `pages/day` (mutations, page, tests). The page composes the existing `DashboardPage` template, `DateStepper`, `Badge`, `ConfirmDialog`, `Dialog`.

**Tech Stack:** React 19, TanStack Query v5 (`useQuery`/`useMutation`, `queryKeys`, `STALE`), react-router v8 (`useUrlParam`), react-hook-form (reopen dialog), i18next (`uk` default + `en`), vitest + testing-library + vitest-axe.

**Spec:** `docs/superpowers/specs/2026-09-08-yagoda-reception-frontend-design.md` (§4.1, §4.2, §4.4, §4.5, §4.6, §5.1)

## Global Constraints

- Money and weights are **strings** end to end; the client never sends a computed amount. Display sums use `shared/lib/money` (BigInt kopiykas), never `Number()`/`parseFloat`/`*`/`/`/`toFixed` on money.
- FSD import rule `shared < entities < features < pages < app` (ESLint-enforced); every slice exports through `index.ts`; domain file names (`model/shift.ts`, not `types.ts`).
- Every read: `useQuery` with a `queryKeys` key, `queryFn` over `httpClient`, `staleTime` from `STALE`; writes invalidate by prefix.
- Copy through `t()` keys in `frontend/src/shared/lib/i18n/locales/uk.json` (default) and `en.json` (tests render in `en`).
- Tests: interaction tests with `vi.mock`ed slice hooks + `expectNoAxeViolations`, in the style of `pages/points/ui/PointsPage.test.tsx`.
- Backend routes (PR #42 spec §4): `POST /shifts` (operator), `GET /shifts/current?collection_point_id=`, `GET /shifts?collection_point_id=&status=&from=&to=&page=&limit=`, `GET /shifts/:id`, `POST /shifts/:id/close` (operator), `POST /shifts/:id/reopen` `{ reason }` (owner); `GET /intakes?shift_id=&include_voided=&page=&limit=`; `GET /payouts?shift_id=…`. Shift: `{ id, collection_point_id, business_date, status: 'open'|'awaiting_explanation'|'closed', opened_by_user_id, closed_by_user_id, closed_at, created_at }`. Intake header: `{ id, code, shift_id, collection_point_id, business_date, supplier_id, amount, received_by_user_id, voided_at, voided_by_user_id, void_reason, created_at }`. Payout header: the same plus `paid_by_user_id`, `return_settled_at`, `return_settled_by_user_id`, `return_note`.
- Run before every commit: `npm run lint -w frontend` and the affected `npx vitest run <path>`; the full `npm test -w frontend` and `npm run build -w frontend` at the end of the last task.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 1: `shared/lib/money` — kopiyka arithmetic and formatting for display

**Files:**
- Create: `frontend/src/shared/lib/money/decimal.ts`
- Create: `frontend/src/shared/lib/money/format.ts`
- Create: `frontend/src/shared/lib/money/index.ts`
- Test: `frontend/src/shared/lib/money/decimal.test.ts`
- Test: `frontend/src/shared/lib/money/format.test.ts`

**Interfaces:**
- Produces: `add(a, b)`, `sub(a, b)`, `sum(values)`, `cmp(a, b): -1|0|1`, `isNegative(v)`, `isZero(v)` over decimal strings, always returning scale-2 strings (`'12658.50'`); `formatUah(v, locale?)` → `'12 658,50 ₴'`, `formatKg(v, locale?)` → `'40,60 кг'`, `formatDecimal(v, locale?)` → `'12 658,50'`. Later tasks import from `@/shared/lib/money`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/shared/lib/money/decimal.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { add, sub, sum, cmp, isNegative, isZero } from './decimal';

describe('decimal-string arithmetic (integer kopiykas, never floats)', () => {
  it('adds and subtracts at scale 2', () => {
    expect(add('140.00', '-5')).toBe('135.00');
    expect(add('0.10', '0.2')).toBe('0.30'); // 0.1 + 0.2 in floats is 0.30000000000000004
    expect(sub('1.05', '1.05')).toBe('0.00');
    expect(sub('1.00', '2.50')).toBe('-1.50');
  });
  it('sums rounded lines so the total equals the printed lines', () => {
    expect(sum(['10944.00', '1827.00', '0.50'])).toBe('12771.50');
    expect(sum([])).toBe('0.00');
  });
  it('compares as numbers, not strings', () => {
    expect(cmp('9.00', '10.00')).toBe(-1);
    expect(cmp('10', '10.00')).toBe(0);
    expect(cmp('-0.01', '0')).toBe(-1);
    expect(isNegative('-0.01')).toBe(true);
    expect(isZero('0.00')).toBe(true);
  });
  it('rejects anything that is not a plain decimal', () => {
    expect(() => add('1e3', '0')).toThrow(/decimal/);
    expect(() => add('1.005', '0')).toThrow(/decimal/);
    expect(() => add('', '0')).toThrow(/decimal/);
  });
});
```

`frontend/src/shared/lib/money/format.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { formatUah, formatKg, formatDecimal } from './format';

describe('money/weight formatting (strings in, strings out)', () => {
  it('groups thousands with a narrow no-break space and uses a decimal comma in uk', () => {
    expect(formatDecimal('12658.50', 'uk')).toBe('12 658,50');
    expect(formatUah('12658.50', 'uk')).toBe('12 658,50 ₴');
    expect(formatKg('40.60', 'uk')).toBe('40,60 кг');
  });
  it('keeps the sign and pads to two decimals', () => {
    expect(formatUah('-1.5', 'uk')).toBe('−1,50 ₴'); // typographic minus U+2212
    expect(formatUah('7', 'uk')).toBe('7,00 ₴');
  });
  it('formats en with a comma group and a dot decimal', () => {
    expect(formatUah('12658.50', 'en')).toBe('12,658.50 ₴');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/shared/lib/money`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`frontend/src/shared/lib/money/decimal.ts`:
```ts
/**
 * Decimal-string arithmetic in integer kopiykas — the client-side twin of the
 * backend's `common/money.ts`, with the same contract: strings in, scale-2
 * strings out, nothing ever passes through a binary float. Used for DISPLAY
 * totals only (a day's «нараховано», «N позицій · кг»); every value sent to
 * the server is what the operator typed or what the server previewed.
 */
const DECIMAL = /^(-)?(\d+)(?:\.(\d{1,2}))?$/;

function toKopiykas(value: string): bigint {
  const m = DECIMAL.exec(value);
  if (!m) throw new Error(`Not a decimal string: "${value}"`);
  const [, sign, whole, frac = ''] = m;
  const k = BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0'));
  return sign ? -k : k;
}

function fromKopiykas(k: bigint): string {
  const sign = k < 0n ? '-' : '';
  const abs = k < 0n ? -k : k;
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

export const add = (a: string, b: string): string => fromKopiykas(toKopiykas(a) + toKopiykas(b));
export const sub = (a: string, b: string): string => fromKopiykas(toKopiykas(a) - toKopiykas(b));
export const sum = (values: readonly string[]): string =>
  fromKopiykas(values.reduce((acc, v) => acc + toKopiykas(v), 0n));
export function cmp(a: string, b: string): -1 | 0 | 1 {
  const x = toKopiykas(a);
  const y = toKopiykas(b);
  return x < y ? -1 : x > y ? 1 : 0;
}
export const isNegative = (v: string): boolean => toKopiykas(v) < 0n;
export const isZero = (v: string): boolean => toKopiykas(v) === 0n;
```

`frontend/src/shared/lib/money/format.ts`:
```ts
/**
 * Formatting only — a decimal string becomes a localized string. Grouping and
 * the decimal separator come from `Intl.NumberFormat` applied to the INTEGER
 * and FRACTION parts separately, so no value is ever parsed into a float.
 * The minus is the typographic U+2212, as the mock's `uah()` prints it.
 */
const DECIMAL = /^(-)?(\d+)(?:\.(\d{1,2}))?$/;

export function formatDecimal(value: string, locale = 'uk'): string {
  const m = DECIMAL.exec(value);
  if (!m) throw new Error(`Not a decimal string: "${value}"`);
  const [, sign, whole, frac = ''] = m;
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
  const group = parts.find((p) => p.type === 'group')?.value ?? ' ';
  const decimal = parts.find((p) => p.type === 'decimal')?.value ?? '.';
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  return `${sign ? '−' : ''}${grouped}${decimal}${frac.padEnd(2, '0')}`;
}

export const formatUah = (value: string, locale = 'uk'): string =>
  `${formatDecimal(value, locale)} ₴`;

export const formatKg = (value: string, locale = 'uk'): string =>
  `${formatDecimal(value, locale)} ${locale.startsWith('uk') ? 'кг' : 'kg'}`;
```

`frontend/src/shared/lib/money/index.ts`:
```ts
export { add, sub, sum, cmp, isNegative, isZero } from './decimal';
export { formatDecimal, formatUah, formatKg } from './format';
```

Note: `Intl.NumberFormat('uk')` groups with U+202F (narrow no-break space) in modern ICU (Node 24 / browsers); the test pins that. If the runtime returns U+00A0 instead, normalise to U+202F in `formatDecimal` (`group === ' ' ? ' ' : group`) — the visual result is the same and the test stays deterministic.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/shared/lib/money`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shared/lib/money
git commit -m "feat(money): decimal-string arithmetic in kopiykas and localized formatting — display only

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `shared/lib/date` — ISO-date helpers

**Files:**
- Create: `frontend/src/shared/lib/date/iso.ts`
- Create: `frontend/src/shared/lib/date/index.ts`
- Test: `frontend/src/shared/lib/date/iso.test.ts`

**Interfaces:**
- Produces: `todayIso(): string` (local calendar date `YYYY-MM-DD`), `addDaysIso(iso, days): string`, `isIsoDate(v): v is string`, `formatLongDate(iso, locale)` → `'8 вересня 2026'`, `formatWeekday(iso, locale)` → `'вівторок'`, `formatShortDate(iso, locale)` → `'08.09'`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { addDaysIso, isIsoDate, formatLongDate, formatWeekday, formatShortDate } from './iso';

describe('iso dates', () => {
  it('adds days across month and year boundaries without touching time zones', () => {
    expect(addDaysIso('2026-09-08', -1)).toBe('2026-09-07');
    expect(addDaysIso('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('recognises only YYYY-MM-DD', () => {
    expect(isIsoDate('2026-09-08')).toBe(true);
    expect(isIsoDate('8.9.2026')).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });
  it('formats for people in uk and en', () => {
    expect(formatLongDate('2026-09-08', 'uk')).toBe('8 вересня 2026');
    expect(formatWeekday('2026-09-08', 'uk')).toBe('вівторок');
    expect(formatShortDate('2026-09-08', 'uk')).toBe('08.09');
    expect(formatLongDate('2026-09-08', 'en')).toBe('8 September 2026');
  });
});
```

- [ ] **Step 2: Run it to verify it fails** — `cd frontend && npx vitest run src/shared/lib/date` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// frontend/src/shared/lib/date/iso.ts
/**
 * Business dates are `YYYY-MM-DD` strings on the wire (a shift's
 * `business_date`). These helpers keep them strings: arithmetic goes through
 * UTC-noon Date objects so a DST switch can never shift the calendar day.
 */
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export const isIsoDate = (v: unknown): v is string => typeof v === 'string' && ISO.test(v);

const toUtcNoon = (iso: string): Date => new Date(`${iso}T12:00:00Z`);
const fromDate = (d: Date): string => d.toISOString().slice(0, 10);

/** The browser's local calendar date — the operator's «today». */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDaysIso(iso: string, days: number): string {
  const d = toUtcNoon(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return fromDate(d);
}

export const formatLongDate = (iso: string, locale = 'uk'): string =>
  new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(toUtcNoon(iso))
    .replace(/\s*р\.$/, ''); // uk adds «р.» — the mock prints «8 вересня 2026»

export const formatWeekday = (iso: string, locale = 'uk'): string =>
  new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(toUtcNoon(iso));

export const formatShortDate = (iso: string, locale = 'uk'): string =>
  new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(toUtcNoon(iso));
```

```ts
// frontend/src/shared/lib/date/index.ts
export { todayIso, addDaysIso, isIsoDate, formatLongDate, formatWeekday, formatShortDate } from './iso';
```

- [ ] **Step 4: Run tests** — expected PASS. If `formatLongDate('…','en')` yields `'September 8, 2026'`, switch the en assertion to that value — Intl's en-US order is the locale's choice, not a bug.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shared/lib/date
git commit -m "feat(date): ISO business-date helpers (today, add days, long/short/weekday formats)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Query keys, `entities/shift`, `entities/intake`, `entities/payout`

**Files:**
- Modify: `frontend/src/shared/api/queryKeys.ts`
- Create: `frontend/src/entities/shift/model/shift.ts`, `frontend/src/entities/shift/api/useShifts.ts`, `frontend/src/entities/shift/index.ts`
- Create: `frontend/src/entities/intake/model/intake.ts`, `frontend/src/entities/intake/api/useIntakes.ts`, `frontend/src/entities/intake/index.ts`
- Create: `frontend/src/entities/payout/model/payout.ts`, `frontend/src/entities/payout/api/usePayouts.ts`, `frontend/src/entities/payout/index.ts`
- Test: `frontend/src/entities/shift/api/useShifts.test.tsx`

**Interfaces:**
- Produces: `queryKeys.shifts`, `queryKeys.intakes`, `queryKeys.payouts`, `queryKeys.supplierBalances` (all `readonly ['…']` prefixes).
- `Shift`, `ShiftStatus`; `useCurrentShiftQuery(pointId: string | null)` → `UseQueryResult<Shift | null>` (`GET /shifts/current?collection_point_id=`; a 404 → `null`); `useShiftOnDateQuery(pointId: string | null, date: string)` → `UseQueryResult<Shift | null>` (`GET /shifts?collection_point_id=&from=&to=&limit=1`, first row or `null`).
- `Intake` (header), `useIntakesQuery(filter: { shiftId?: string; supplierId?: string; pointId?: string; includeVoided?: boolean; limit?: number })` → `UseQueryResult<Paginated<Intake>>` (`enabled` only when at least one of shiftId/supplierId/pointId is set).
- `Payout` (header), `usePayoutsQuery(filter)` — the same shape.

- [ ] **Step 1: Write the failing test** (`useShifts.test.tsx`, mocking the http client with `axios-mock-adapter` as `entities/user/api/useMeQuery` tests do — read `frontend/src/entities/user/api/*.test.*` or `frontend/src/shared/api/client.test.ts` for the wrapper pattern):

```tsx
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ReactNode } from 'react';
import { httpClient } from '@/shared/api';
import { useCurrentShiftQuery, useShiftOnDateQuery } from './useShifts';

let mock: MockAdapter;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);
const shift = { id: 's1', collection_point_id: 'p1', business_date: '2026-09-08', status: 'open', opened_by_user_id: 'u1', closed_by_user_id: null, closed_at: null, created_at: '2026-09-08T04:30:00Z' };

beforeEach(() => { mock = new MockAdapter(httpClient); });
afterEach(() => mock.restore());

describe('useCurrentShiftQuery', () => {
  it('reads the open shift for the point and treats 404 as "none"', async () => {
    mock.onGet('/shifts/current', { params: { collection_point_id: 'p1' } }).reply(200, shift);
    const { result } = renderHook(() => useCurrentShiftQuery('p1'), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(shift));

    mock.onGet('/shifts/current', { params: { collection_point_id: 'p2' } }).reply(404, { message: 'No open shift' });
    const none = renderHook(() => useCurrentShiftQuery('p2'), { wrapper });
    await waitFor(() => expect(none.result.current.data).toBeNull());
  });
  it('does not fire without a point', () => {
    const { result } = renderHook(() => useCurrentShiftQuery(null), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useShiftOnDateQuery', () => {
  it('asks for the one shift on that date and returns it or null', async () => {
    mock.onGet('/shifts', { params: { collection_point_id: 'p1', from: '2026-09-07', to: '2026-09-07', limit: 1 } })
      .reply(200, { data: [{ ...shift, id: 's0', business_date: '2026-09-07', status: 'closed' }], total: 1, page: 1, limit: 1 });
    const { result } = renderHook(() => useShiftOnDateQuery('p1', '2026-09-07'), { wrapper });
    await waitFor(() => expect(result.current.data?.id).toBe('s0'));
  });
});
```

- [ ] **Step 2: Run it** — FAIL (module not found).

- [ ] **Step 3: Implement**

`queryKeys.ts` — append inside the object:
```ts
  /** Shifts — prefix for `/current` and by-date reads; a read appends the point (and date). */
  shifts: ['shifts'] as const,
  /** Document journals — prefix for every filtered list; a read appends its filter object. */
  intakes: ['intakes'] as const,
  payouts: ['payouts'] as const,
  /** `/supplier-balances` and `/suppliers/:id/balance` — invalidated together by any document write. */
  supplierBalances: ['supplier-balances'] as const,
```

`entities/shift/model/shift.ts`:
```ts
/** Mirrors the backend's `ShiftResponse` (intakes spec §4). */
export type ShiftStatus = 'open' | 'awaiting_explanation' | 'closed';

export interface Shift {
  id: string;
  collection_point_id: string;
  /** `YYYY-MM-DD` in APP_TIMEZONE — the day the shift belongs to, not the wall clock. */
  business_date: string;
  status: ShiftStatus;
  opened_by_user_id: string;
  closed_by_user_id: string | null;
  closed_at: string | null;
  created_at: string;
}
```

`entities/shift/api/useShifts.ts`:
```ts
import { useQuery } from '@tanstack/react-query';
import { httpClient, ApiError } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import type { Shift } from '../model/shift';

interface ShiftListEnvelope { data: Shift[]; total: number; page: number; limit: number }

/**
 * The OPEN shift at a point, or `null`. The API answers 404 when none is open;
 * that is a state, not a failure, so it is folded into `null` rather than
 * surfacing as `isError`. `enabled` only with a point — an owner who has not
 * picked one has nothing to ask about.
 */
export function useCurrentShiftQuery(pointId: string | null) {
  return useQuery({
    queryKey: [...queryKeys.shifts, 'current', pointId],
    enabled: pointId !== null,
    queryFn: async (): Promise<Shift | null> => {
      try {
        const { data } = await httpClient.get<Shift>('/shifts/current', {
          params: { collection_point_id: pointId },
        });
        return data;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    // A shift changes by the operator's own action, which invalidates; 30s covers a second tab.
    staleTime: 30_000,
  });
}

/** The one shift a point had on a date (UQ point+date), or `null`. */
export function useShiftOnDateQuery(pointId: string | null, date: string) {
  return useQuery({
    queryKey: [...queryKeys.shifts, 'on', pointId, date],
    enabled: pointId !== null,
    queryFn: async (): Promise<Shift | null> => {
      const { data } = await httpClient.get<ShiftListEnvelope>('/shifts', {
        params: { collection_point_id: pointId, from: date, to: date, limit: 1 },
      });
      return data.data[0] ?? null;
    },
    staleTime: 30_000,
  });
}
```
Check `ApiError`'s field for the HTTP status in `shared/api/client.ts` (`status`) and how the interceptor throws it — the 404 branch must match a real `ApiError` instance.

`entities/shift/index.ts`:
```ts
export type { Shift, ShiftStatus } from './model/shift';
export { useCurrentShiftQuery, useShiftOnDateQuery } from './api/useShifts';
```

`entities/intake/model/intake.ts`:
```ts
/** Mirrors the backend's `IntakeResponse` (header only — `GET /intakes` never nests items). */
export interface Intake {
  id: string;
  code: string;
  shift_id: string;
  collection_point_id: string;
  business_date: string;
  supplier_id: string;
  amount: string;
  received_by_user_id: string;
  voided_at: string | null;
  voided_by_user_id: string | null;
  void_reason: string | null;
  created_at: string;
}

export interface Paginated<T> { data: T[]; total: number; page: number; limit: number }

export interface DocumentFilter {
  shiftId?: string;
  supplierId?: string;
  pointId?: string;
  includeVoided?: boolean;
  limit?: number;
}
```

`entities/intake/api/useIntakes.ts`:
```ts
import { useQuery } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { STALE } from '@/shared/api/queryClient';
import type { DocumentFilter, Intake, Paginated } from '../model/intake';

export function documentParams(f: DocumentFilter) {
  return {
    ...(f.shiftId ? { shift_id: f.shiftId } : {}),
    ...(f.supplierId ? { supplier_id: f.supplierId } : {}),
    ...(f.pointId ? { collection_point_id: f.pointId } : {}),
    include_voided: f.includeVoided ?? true,
    limit: f.limit ?? 100,
  };
}

/** Receipt headers for a shift, a supplier or a point — never all of them. */
export function useIntakesQuery(filter: DocumentFilter) {
  const enabled = Boolean(filter.shiftId || filter.supplierId || filter.pointId);
  return useQuery({
    queryKey: [...queryKeys.intakes, filter],
    enabled,
    queryFn: async (): Promise<Paginated<Intake>> => {
      const { data } = await httpClient.get<Paginated<Intake>>('/intakes', { params: documentParams(filter) });
      return data;
    },
    staleTime: STALE.list,
  });
}
```

`entities/intake/index.ts`:
```ts
export type { Intake, Paginated, DocumentFilter } from './model/intake';
export { useIntakesQuery, documentParams } from './api/useIntakes';
```

`entities/payout/model/payout.ts`:
```ts
export interface Payout {
  id: string;
  code: string;
  shift_id: string;
  collection_point_id: string;
  business_date: string;
  supplier_id: string;
  amount: string;
  paid_by_user_id: string;
  voided_at: string | null;
  voided_by_user_id: string | null;
  void_reason: string | null;
  return_settled_at: string | null;
  return_settled_by_user_id: string | null;
  return_note: string | null;
  created_at: string;
}
```

`entities/payout/api/usePayouts.ts` — identical to `useIntakesQuery` with `/payouts`, `queryKeys.payouts`, `Payout`; it imports `documentParams`, `DocumentFilter`, `Paginated` from `@/entities/intake` — **a same-layer cross-import, which FSD forbids**. Do not do that: copy the three-line `documentParams` into `entities/payout/api/usePayouts.ts` and define `Paginated`/`DocumentFilter` locally in `entities/payout/model/payout.ts` (two small duplicates are the FSD-correct price; note it in a comment).

`entities/payout/index.ts`:
```ts
export type { Payout } from './model/payout';
export { usePayoutsQuery } from './api/usePayouts';
```

- [ ] **Step 4: Run tests** — `cd frontend && npx vitest run src/entities/shift` → PASS. Run `npm run lint -w frontend` → clean (FSD rule).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shared/api/queryKeys.ts frontend/src/entities/shift frontend/src/entities/intake frontend/src/entities/payout
git commit -m "feat(entities): shift, intake and payout reads — current/by-date shift, document headers by shift/supplier/point

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `usePointScope` — the point a money screen works on

**Files:**
- Create: `frontend/src/entities/user/model/usePointScope.ts`
- Modify: `frontend/src/entities/user/index.ts`
- Test: `frontend/src/entities/user/model/usePointScope.test.tsx`

**Interfaces:**
- Produces: `usePointScope(): { pointId: string | null; canPick: boolean; setPointId: (id: string | null) => void; isLoading: boolean }`. Operator → their `me.collection_point_id`, `canPick: false`; owner → `?point=` from the URL (`useUrlParam('point')`), `canPick: true`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, Outlet } from 'react-router';
import type { ReactNode } from 'react';
import { usePointScope } from './usePointScope';

const { meMock } = vi.hoisted(() => ({ meMock: vi.fn() }));
vi.mock('../api/useMeQuery', () => ({ useMeQuery: () => meMock() }));

function wrapperAt(entry: string) {
  return ({ children }: { children: ReactNode }) => {
    const router = createMemoryRouter([{ path: '/x', element: <>{children}<Outlet /></> }], { initialEntries: [entry] });
    return <RouterProvider router={router} />;
  };
}

beforeEach(() => meMock.mockReset());

describe('usePointScope', () => {
  it('binds an operator to their own point and offers no picker', () => {
    meMock.mockReturnValue({ data: { role: 'point_operator', collection_point_id: 'p1' }, isPending: false });
    const { result } = renderHook(() => usePointScope(), { wrapper: wrapperAt('/x?point=p9') });
    expect(result.current).toMatchObject({ pointId: 'p1', canPick: false });
  });
  it('lets an owner pick a point through ?point= and starts unpicked', () => {
    meMock.mockReturnValue({ data: { role: 'network_owner', collection_point_id: null }, isPending: false });
    const { result } = renderHook(() => usePointScope(), { wrapper: wrapperAt('/x') });
    expect(result.current).toMatchObject({ pointId: null, canPick: true });
    act(() => result.current.setPointId('p2'));
    expect(result.current.pointId).toBe('p2');
  });
});
```

- [ ] **Step 2: Run it** — FAIL.

- [ ] **Step 3: Implement**

```ts
// frontend/src/entities/user/model/usePointScope.ts
import { useCallback } from 'react';
import { useUrlParam } from '@/shared/lib/url-state';
import { useMeQuery } from '../api/useMeQuery';

/**
 * Which point a money screen (shift, receipts, balances) works on. An operator
 * is pinned to their own point by the token — the server derives it and
 * ignores anything else. An owner has no point and PICKS one; the pick lives
 * in `?point=` so a reload or a shared link lands on the same point, and
 * nothing is written for an owner who has not picked.
 */
export function usePointScope() {
  const { data: me, isPending } = useMeQuery();
  const [param, setParam] = useUrlParam('point');
  const setPointId = useCallback((id: string | null) => setParam(id), [setParam]);

  if (me?.role === 'point_operator') {
    return { pointId: me.collection_point_id, canPick: false, setPointId, isLoading: false };
  }
  return { pointId: param, canPick: me?.role === 'network_owner', setPointId, isLoading: isPending };
}
```
Add to `entities/user/index.ts`: `export { usePointScope } from './model/usePointScope';`

- [ ] **Step 4: Run tests + lint** — PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/entities/user
git commit -m "feat(user): usePointScope — the operator's own point, or the owner's ?point= pick

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `pages/day` — shift mutations, page, route, nav, locales, tests

**Files:**
- Create: `frontend/src/pages/day/api/shiftActions.ts`
- Create: `frontend/src/pages/day/lib/apiErrorToBanner.ts` (+ `apiErrorToBanner.test.ts`)
- Create: `frontend/src/pages/day/ui/DayPage.tsx`, `frontend/src/pages/day/ui/ReopenShiftDialog.tsx`, `frontend/src/pages/day/ui/DayPage.test.tsx`
- Create: `frontend/src/pages/day/index.ts`
- Modify: `frontend/src/app/router.tsx` (add `/day`), `frontend/src/app/layouts/AppLayout.tsx` (`nav.day` gets `to: '/day'`), `frontend/src/shared/lib/i18n/locales/uk.json` + `en.json` (a `day` block)

**Interfaces:**
- Consumes: `usePointScope`, `useShiftOnDateQuery`, `useIntakesQuery`, `usePayoutsQuery`, `sum`/`sub`/`formatUah` from `@/shared/lib/money`, `todayIso`/`addDaysIso`/`isIsoDate`/`formatLongDate`/`formatWeekday`/`formatShortDate` from `@/shared/lib/date`, `DashboardPage` template, `DateStepper`, `Badge`, `ConfirmDialog`, `SelectField`, `usePointOptionsQuery`.
- Produces: `DayPage` at `/day`.

- [ ] **Step 1: Mutations** — `pages/day/api/shiftActions.ts`:

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import type { Shift } from '@/entities/shift';

/** Opening, closing and reopening all change what «today» means for the
 *  documents of that point, so every one invalidates shifts AND both journals. */
function useInvalidateDay() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: queryKeys.shifts }),
      qc.invalidateQueries({ queryKey: queryKeys.intakes }),
      qc.invalidateQueries({ queryKey: queryKeys.payouts }),
    ]);
}

/** Operator only — the point is the actor's own; no body. */
export function useOpenShiftMutation() {
  const invalidate = useInvalidateDay();
  return useMutation({
    mutationFn: async (): Promise<Shift> => (await httpClient.post<Shift>('/shifts')).data,
    onSuccess: invalidate,
  });
}

export function useCloseShiftMutation() {
  const invalidate = useInvalidateDay();
  return useMutation({
    mutationFn: async (id: string): Promise<Shift> => (await httpClient.post<Shift>(`/shifts/${id}/close`)).data,
    onSuccess: invalidate,
  });
}

/** Owner only — a reason is mandatory (intakes spec §6.1). */
export function useReopenShiftMutation() {
  const invalidate = useInvalidateDay();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }): Promise<Shift> =>
      (await httpClient.post<Shift>(`/shifts/${id}/reopen`, { reason })).data,
    onSuccess: invalidate,
  });
}
```

- [ ] **Step 2: Error → banner key** — read `backend/src/shifts/shifts.service.ts` for the exact `code` strings it throws (open when one is open, close a non-open shift, reopen a shift that is not closed, an operator acting on another point) and map each to a `day.errors.*` key; anything else → `day.errors.failed`. Write `apiErrorToBanner.test.ts` first with one case per code plus the fallback (same style as `pages/prices/lib/apiErrorToFields.test.ts`), then the 15-line mapper.

- [ ] **Step 3: Locales** — add to `uk.json` (and the English twin to `en.json`):

```json
"day": {
  "eyebrow": "{{point}} · {{weekday}}",
  "title": "Каса за {{date}}",
  "description": "Скільки ягоди зайшло, скільки грошей вийшло і що пішло в залишок — по документах зміни.",
  "pickPoint": "Оберіть точку",
  "today": "Сьогодні",
  "status": { "open": "Зміна відкрита", "closed": "Зміну закрито", "awaiting_explanation": "Потребує пояснення", "none": "Зміни не було", "noneToday": "Зміну ще не відкрито" },
  "open": "Відкрити зміну",
  "close": "Закрити зміну",
  "reopen": "Переоткрити зміну",
  "confirmClose": { "title": "Закрити зміну?", "body": "Після закриття квитанції й виплати цього дня більше не проводяться. Переоткрити може лише керівник." },
  "reopenDialog": { "title": "Переоткрити зміну", "reason": "Причина", "reasonHint": "Хто попросив і чому — лишається в журналі", "submit": "Переоткрити" },
  "tiles": { "receipts": "Квитанцій", "accrued": "Нараховано", "accruedHint": "вартість прийнятої ягоди", "paid": "Видано", "paidHint": "готівка за день", "toDebt": "У залишок", "toDebtHint": "перейде на баланс постачальників" },
  "feed": { "title": "Стрічка дня", "empty": "Цього дня рухів не було.", "noShift": "Зміну ще не відкрито — квитанцій і виплат немає.", "intake": "Квитанція", "payout": "Виплата", "voided": "анульовано" },
  "toast": { "opened": "Зміну відкрито", "closed": "Зміну закрито", "reopened": "Зміну переоткрито" },
  "errors": { "failed": "Не вдалося змінити зміну", "alreadyOpen": "Зміна на цій точці вже відкрита", "notOpen": "Зміна не відкрита", "notClosed": "Переоткрити можна лише закриту зміну", "reasonRequired": "Вкажіть причину" }
}
```
Also set `nav.day`'s route: in `AppLayout.tsx` change `{ labelKey: 'nav.day', icon: CalendarCheck2 }` to `{ labelKey: 'nav.day', icon: CalendarCheck2, to: '/day' }`.

- [ ] **Step 4: Write the failing page tests** — `pages/day/ui/DayPage.test.tsx`, mocking `@/entities/user` (`usePointScope`, `useMeQuery`), `@/entities/shift`, `@/entities/intake`, `@/entities/payout`, `@/entities/collection-point`, and `../api/shiftActions` with `vi.hoisted` fns; render through `createMemoryRouter` at `/day` (the page uses `useUrlParam('date')`). Cases:
  1. operator, open shift today, 2 intakes (`'10944.00'`, `'1827.00'`, one voided `'99.00'`) and 1 payout `'4000.00'` → heading «Cash for 8 September 2026» (en), tiles `Receipts 2` (voided excluded), `Accrued 12,771.00 ₴`, `Paid 4,000.00 ₴`, `To balance 8,771.00 ₴`; the voided row shows «voided»; «Close shift» button present, «Open shift» absent; axe clean.
  2. operator, no shift today → status «Shift not opened yet», «Open shift» button; clicking it calls `openMock` once.
  3. owner, no `?point=` → the point picker is shown and the feed says «Select a point» state (no queries with a point); with `?point=p1&date=2026-09-07` and a closed shift → «Reopen shift» button, «Close shift» absent; the date stepper's next is enabled (yesterday), clicking «Today» sets the URL date to today.
  4. close flow: click «Close shift» → ConfirmDialog → confirm → `closeMock` called with the shift id.

- [ ] **Step 5: Run them** — FAIL (page missing).

- [ ] **Step 6: Implement `DayPage.tsx`**

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DashboardPage, type StatItem } from '@/shared/ui/templates/dashboard-page';
import { DateStepper } from '@/shared/ui/date-stepper';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { SelectField } from '@/shared/ui/select-field';
import { EmptyState } from '@/shared/ui/empty-state';
import { Spinner } from '@/shared/ui/spinner';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import { toast } from '@/shared/ui/toast';
import { useUrlParam } from '@/shared/lib/url-state';
import { sum, sub, formatUah } from '@/shared/lib/money';
import { todayIso, addDaysIso, isIsoDate, formatLongDate, formatWeekday } from '@/shared/lib/date';
import { cn } from '@/shared/lib/cn';
import { useMeQuery, usePointScope } from '@/entities/user';
import { usePointOptionsQuery } from '@/entities/collection-point';
import { useShiftOnDateQuery, type Shift } from '@/entities/shift';
import { useIntakesQuery, type Intake } from '@/entities/intake';
import { usePayoutsQuery, type Payout } from '@/entities/payout';
import { useOpenShiftMutation, useCloseShiftMutation } from '../api/shiftActions';
import { apiErrorToBanner } from '../lib/apiErrorToBanner';
import { ReopenShiftDialog } from './ReopenShiftDialog';

type FeedRow =
  | { kind: 'intake'; id: string; code: string; amount: string; at: string; voided: boolean; reason: string | null }
  | { kind: 'payout'; id: string; code: string; amount: string; at: string; voided: boolean; reason: string | null };

/**
 * «Каса за день» — one point, one date, its shift and its documents. The date
 * lives in `?date=` (default today) and the owner's point in `?point=`
 * (`usePointScope`), so a reload or a shared link lands on the same day.
 * Totals are DISPLAY sums over document headers in kopiykas; nothing here is
 * money the server has not already computed.
 */
export function DayPage() {
  const { t, i18n } = useTranslation();
  const { data: me } = useMeQuery();
  const { pointId, canPick, setPointId } = usePointScope();
  const { data: points } = usePointOptionsQuery();
  const [dateParam, setDateParam] = useUrlParam('date');
  const today = todayIso();
  const date = isIsoDate(dateParam) && dateParam <= today ? dateParam : today;

  const shift = useShiftOnDateQuery(pointId, date);
  const shiftId = shift.data?.id;
  const intakes = useIntakesQuery({ shiftId });
  const payouts = usePayoutsQuery({ shiftId });

  const open = useOpenShiftMutation();
  const close = useCloseShiftMutation();
  const [confirmClose, setConfirmClose] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>, toastKey: string) => {
    setBanner(null);
    try {
      await action();
      toast.success(t(toastKey));
    } catch (error) {
      setBanner(apiErrorToBanner(error));
    }
  };

  const isOperator = me?.role === 'point_operator';
  const isOwner = me?.role === 'network_owner';
  const isToday = date === today;
  const status: Shift['status'] | 'none' = shift.data?.status ?? 'none';

  const liveIntakes = (intakes.data?.data ?? []).filter((i) => i.voided_at === null);
  const livePayouts = (payouts.data?.data ?? []).filter((p) => p.voided_at === null);
  const accrued = sum(liveIntakes.map((i) => i.amount));
  const paid = sum(livePayouts.map((p) => p.amount));
  const stats: StatItem[] = [
    { label: t('day.tiles.receipts'), value: String(liveIntakes.length) },
    { label: t('day.tiles.accrued'), value: formatUah(accrued, i18n.language), hint: t('day.tiles.accruedHint') },
    { label: t('day.tiles.paid'), value: formatUah(paid, i18n.language), hint: t('day.tiles.paidHint'), tone: 'berry' },
    { label: t('day.tiles.toDebt'), value: formatUah(sub(accrued, paid), i18n.language), hint: t('day.tiles.toDebtHint'), tone: 'amber' },
  ];

  const feed: FeedRow[] = [
    ...(intakes.data?.data ?? []).map((i: Intake): FeedRow => ({ kind: 'intake', id: i.id, code: i.code, amount: i.amount, at: i.created_at, voided: i.voided_at !== null, reason: i.void_reason })),
    ...(payouts.data?.data ?? []).map((p: Payout): FeedRow => ({ kind: 'payout', id: p.id, code: p.code, amount: p.amount, at: p.created_at, voided: p.voided_at !== null, reason: p.void_reason })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  const pointName = (points ?? []).find((p) => p.id === pointId)?.name ?? '';

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      {canPick ? (
        <SelectField aria-label={t('day.pickPoint')} value={pointId ?? ''} onChange={(e) => setPointId(e.target.value || null)} className="w-48">
          <option value="">{t('day.pickPoint')}</option>
          {(points ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </SelectField>
      ) : null}
      <DateStepper
        label={date.slice(8, 10) + '.' + date.slice(5, 7)}
        onPrev={() => setDateParam(addDaysIso(date, -1))}
        onNext={() => setDateParam(addDaysIso(date, 1))}
        canNext={!isToday}
        onToday={isToday ? undefined : () => setDateParam(null)}
        todayLabel={t('day.today')}
      />
      <Badge variant={status === 'open' ? 'default' : status === 'awaiting_explanation' ? 'destructive' : 'secondary'}>
        {t(`day.status.${status === 'none' && isToday ? 'noneToday' : status}`)}
      </Badge>
      {isOperator && isToday && status === 'none' && pointId ? (
        <Button onClick={() => run(() => open.mutateAsync(), 'day.toast.opened')} disabled={open.isPending}>{t('day.open')}</Button>
      ) : null}
      {isOperator && status === 'open' ? (
        <Button variant="outline" onClick={() => setConfirmClose(true)}>{t('day.close')}</Button>
      ) : null}
      {isOwner && status === 'closed' && shift.data ? (
        <Button variant="outline" onClick={() => setReopenOpen(true)}>{t('day.reopen')}</Button>
      ) : null}
    </div>
  );

  const feedContent = pointId === null ? (
    <EmptyState title={t('day.pickPoint')} />
  ) : shift.isPending ? (
    <div className="flex justify-center py-12"><Spinner /></div>
  ) : status === 'none' ? (
    <EmptyState title={t(isToday ? 'day.status.noneToday' : 'day.status.none')} hint={t('day.feed.noShift')} />
  ) : feed.length === 0 ? (
    <EmptyState title={t('day.feed.empty')} />
  ) : (
    <ul className="divide-y divide-border">
      {feed.map((row) => (
        <li key={row.id} className={cn('flex items-center gap-3 py-2.5 text-sm', row.voided && 'text-muted-foreground line-through')} title={row.reason ?? undefined}>
          <span className="font-mono text-xs text-muted-foreground">{row.at.slice(11, 16)}</span>
          <Badge variant={row.kind === 'intake' ? 'secondary' : 'outline'}>{t(`day.feed.${row.kind}`)}</Badge>
          <span className="font-mono">{row.code}</span>
          {row.voided ? <span className="text-xs">{t('day.feed.voided')}</span> : null}
          <span className="ml-auto font-mono tabular-nums">{formatUah(row.amount, i18n.language)}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <DashboardPage
        eyebrow={t('day.eyebrow', { point: pointName, weekday: formatWeekday(date, i18n.language) })}
        title={t('day.title', { date: formatLongDate(date, i18n.language) })}
        description={t('day.description')}
        actions={actions}
        stats={pointId && status !== 'none' ? stats : undefined}
        statColumns={4}
        sections={[{ id: 'feed', eyebrow: t('day.feed.title'), content: feedContent, span: 'full' }]}
      >
        {banner ? <p role="alert" className="mb-4 text-sm text-destructive">{t(banner)}</p> : null}
      </DashboardPage>

      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title={t('day.confirmClose.title')}
        description={t('day.confirmClose.body')}
        confirmLabel={t('day.close')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => { if (shift.data) void run(() => close.mutateAsync(shift.data!.id), 'day.toast.closed'); }}
      />
      {shift.data ? (
        <ReopenShiftDialog shift={shift.data} open={reopenOpen} onClose={() => setReopenOpen(false)} />
      ) : null}
    </>
  );
}
```
Read `shared/ui/templates/dashboard-page.tsx` first and adapt the props used (`stats`, `statColumns`, `sections`, `children` placement) to what it actually renders — the test asserts text, not structure. Time is shown as `created_at.slice(11,16)` which is UTC; replace it with `new Date(row.at).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })` so the operator sees local time.

`ReopenShiftDialog.tsx` — a `Dialog` with a `react-hook-form` `reason` `Textarea` (required → `day.errors.reasonRequired`), submits `useReopenShiftMutation`, toasts `day.toast.reopened`, maps errors with `apiErrorToBanner` into a `role="alert"` paragraph, and closes on success. Follow `pages/prices/ui/SetPriceDialog.tsx` for the dialog/form scaffold (DialogHeader/Title/Description, `Field` + `Textarea`, `DialogFooter` with cancel/submit).

`pages/day/index.ts`: `export { DayPage } from './ui/DayPage';`

`app/router.tsx` — add after `/suppliers`:
```tsx
{
  // Both roles: the operator runs their shift, the owner reads (and reopens).
  path: '/day',
  element: (
    <RequireAuth>
      <DayPage />
    </RequireAuth>
  ),
},
```

- [ ] **Step 7: Run the page tests, lint, then the full suite and build**

```
cd frontend && npx vitest run src/pages/day src/app
npm run lint -w frontend && npm test -w frontend && npm run build -w frontend
```
Expected: all green (existing router/AppLayout tests may need the new nav `to` — read the failure, update the expectation, never weaken it).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/day frontend/src/app/router.tsx frontend/src/app/layouts/AppLayout.tsx frontend/src/shared/lib/i18n/locales
git commit -m "feat(day): «Каса за день» — the point's shift by date, open/close/reopen by role, the day's documents and display totals

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review

- **Spec coverage:** §4.1 (shift/intake/payout entities, money, usePointScope, pages/day) → Tasks 1–5; §4.2 keys/invalidation → Tasks 3, 5; §4.4 → Task 4; §4.5 route+nav → Task 5; §4.6 → Task 1; §5.1 tiles/feed/actions/empty states → Task 5. Not in this plan (next portions): the receipt widget opening from feed rows (§5.1 says intake rows open the receipt — rows are plain here; the reception portion wires the widget in).
- **Placeholders:** none — every step carries code or the exact command; the two «read the source and map» steps name the file and the shape of the output.
- **Type consistency:** `useShiftOnDateQuery(pointId, date)`, `useIntakesQuery({ shiftId })`, `usePayoutsQuery({ shiftId })`, `sum`/`sub`/`formatUah`, `todayIso`/`addDaysIso`/`isIsoDate`/`formatLongDate`/`formatWeekday`, `usePointScope()` → `{ pointId, canPick, setPointId }` — used with the same names in Task 5 as defined in Tasks 1–4.

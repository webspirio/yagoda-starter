# Reweigh Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/reweigh` — the owner's weighing screen at the base — against the §8 API as it was actually built, with the mock's layout and copy intact.

**Architecture:** A new `entities/reweigh` FSD slice owns the reconciliation read and the two line mutations. `pages/reweigh` composes them: a client-side draft buffer (`Draft[]`) that posts line by line, a server-only звірка table, and an all-points day table assembled by a `useQueries` fan-out. Two additive backend changes to `reweighs/` supply what the screen cannot compute: the accepted-grade list and the voided lines.

**Tech Stack:** React 19 · TanStack Query v5 · React Router v8 · Tailwind v4 + the repo's `shared/ui` kit · Vitest + Testing Library · NestJS 12 + TypeORM (backend deltas) · Jest (backend specs)

**Spec:** `docs/superpowers/specs/2026-09-21-yagoda-reweigh-screen-design.md`

**Mock being reproduced:** `.reference/yagoda-crm/src/pages/ReweighPage.tsx` (read it — this plan cites its line numbers for markup)

## Global Constraints

- **Money and weight are decimal strings, end to end.** No `Number()`, no `parseFloat`, no `toFixed`, no `*`/`/` on a money or weight value anywhere in this work. Frontend arithmetic goes through `@/shared/lib/money`; backend through `backend/src/common/money.ts`.
- **`reweigh-reconciliation.service.ts` is money code** (listed in `backend/eslint.config.mjs`'s money `files` array). Any turn touching it is gated by `npm run verify:full`, never the fast tier.
- **FSD import direction:** `shared < entities < features < widgets < pages < app`. A page may not import another page. Lint enforces direction only — same-layer cross-imports are a review discipline.
- **Every user-visible string is an i18n key** under `reweigh.*` in `frontend/src/shared/lib/i18n/locales/uk.json`, mirrored in `en.json`. `uk` is the default; the test suite runs in **English** (`test-setup.ts` calls `changeLanguage('en')`), so assertions use the `en.json` wording.
- **Owner-only.** Route-level `RequireRole('network_owner')`. The backend's `ReweighsController` is `@Auth(UserRole.NetworkOwner)` at class level — do not add a second in-component check.
- **A voided line is never counted.** `products[]` on the reconciliation ignores `voided_at IS NOT NULL` rows, and that is true no matter what `include_voided` says.
- **Thresholds, verbatim from the mock:** `GROSS_SUSPECT_KG = 800`, `TARE_SUSPECT_UNITS = 120`. Season records quoted in the copy: `701,5 кг` and `115 ящиків`.
- **Commit after every task.** Message body explains *why*, not *what*. End every commit with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

---

## File Structure

**Backend (2 files modified, 2 spec files modified):**

| File | Responsibility |
|---|---|
| `backend/src/reweighs/reweigh-reconciliation.service.ts` | `gradeTotals` gains `pg.name`; `forShift` gains `grades[]` and an `includeVoided` argument |
| `backend/src/reweighs/reweighs.controller.ts` | reads the `include_voided` query param |
| `backend/src/reweighs/reweigh-reconciliation.service.spec.ts` | new cases for both deltas |
| `backend/src/reweighs/reweigh-reconciliation.db-spec.ts` | the `grades[]` shape against real Postgres |

**Frontend (created):**

| File | Responsibility |
|---|---|
| `shared/lib/money/decimal.ts` *(modified)* | `mul(value, by)` — a decimal string times a whole count |
| `entities/reweigh/model/reweigh.ts` | wire types: `ReweighItem`, `ReconciliationProduct`, `ReconciliationGrade`, `Reconciliation` |
| `entities/reweigh/api/useReweigh.ts` | `reweighQueryOptions` + `useReweighQuery` |
| `entities/reweigh/api/useReweighMutations.ts` | `useAddReweighItemMutation`, `useVoidReweighItemMutation` |
| `entities/reweigh/index.ts` | public API |
| `entities/user/api/useStaff.ts` | `useStaffQuery` — `GET /users`, for the void trace's author name |
| `pages/reweigh/model/draft.ts` | `Draft`, `newDraftKey`, `tareWeightOf`, `netOf` |
| `pages/reweigh/lib/hints.ts` | `addBlockReason`, `grossHint`, `tareHint` — pure |
| `pages/reweigh/api/useDayReweighs.ts` | the all-points fan-out |
| `pages/reweigh/ui/WeighingForm.tsx` | mock steps 1–3 + чиста вага + «+ ще позиція» |
| `pages/reweigh/ui/DraftLines.tsx` | «Введені позиції» |
| `pages/reweigh/ui/Reconciliation.tsx` | «Звірка з пунктом» |
| `pages/reweigh/ui/DayLines.tsx` | «Проведені переважування за …» + inline void row |
| `pages/reweigh/ui/FieldWarning.tsx` | the amber warning line |
| `pages/reweigh/ui/ReweighPage.tsx` | composition, header, posting |
| `pages/reweigh/index.ts` | public API |

**Frontend (modified):** `shared/api/queryKeys.ts` · `entities/user/index.ts` · `app/router.tsx` · `app/layouts/AppLayout.tsx` · `shared/lib/i18n/locales/{uk,en}.json`

---

### Task 1: Backend — `grades[]` on the reconciliation

**Files:**
- Modify: `backend/src/reweighs/reweigh-reconciliation.service.ts`
- Test: `backend/src/reweighs/reweigh-reconciliation.service.spec.ts`

**Interfaces:**
- Consumes: `gradeTotals(runner, shiftId)`, `GradeTotalsRow`, `ReconciliationResponse` — all already in this file.
- Produces:
  ```ts
  export interface ReconciliationGrade {
    product_grade_id: string;
    product_grade_name: string;
    product_id: string;
    product_name: string;
    intake_net_kg: string;
    reweigh_net_kg: string;   // '0.00' when nothing was weighed — NOT null
  }
  // ReconciliationResponse gains: grades: ReconciliationGrade[]
  // GradeTotalsRow gains: product_grade_name: string
  ```
  `reweigh_net_kg` is `'0.00'` rather than `null` here on purpose: «не перезважено» is a PRODUCT-level state (§3.15) and lives on `products[]`. A grade row exists to populate a picker, and a null there would invite a second, weaker copy of that rule.

- [ ] **Step 1: Write the failing test**

Open `reweigh-reconciliation.service.spec.ts` and read how it stubs `dataSource.query` / the `ReweighItem` repository — reuse that harness exactly. Add:

```ts
describe('grades[]', () => {
  it('lists one row per accepted grade, with its product', async () => {
    rows = [
      gradeRow({
        product_id: 'prod-1', product_name: 'Малина',
        product_grade_id: 'g-1', product_grade_name: 'Малина 1',
        intake_net_kg: '200.00', intake_amount: '20000.00', reweigh_net_kg: '190.00',
      }),
      gradeRow({
        product_id: 'prod-1', product_name: 'Малина',
        product_grade_id: 'g-2', product_grade_name: 'Малина 3',
        intake_net_kg: '100.00', intake_amount: '7000.00', reweigh_net_kg: null,
      }),
    ];

    const res = await service.forShift(actor, 'shift-1');

    expect(res.grades).toEqual([
      {
        product_grade_id: 'g-1', product_grade_name: 'Малина 1',
        product_id: 'prod-1', product_name: 'Малина',
        intake_net_kg: '200.00', reweigh_net_kg: '190.00',
      },
      {
        product_grade_id: 'g-2', product_grade_name: 'Малина 3',
        product_id: 'prod-1', product_name: 'Малина',
        intake_net_kg: '100.00', reweigh_net_kg: '0.00',
      },
    ]);
  });

  it('reports an unweighed grade as 0.00 while still marking the PRODUCT not_reweighed', async () => {
    rows = [
      gradeRow({
        product_id: 'prod-1', product_name: 'Малина',
        product_grade_id: 'g-2', product_grade_name: 'Малина 3',
        intake_net_kg: '100.00', intake_amount: '7000.00', reweigh_net_kg: null,
      }),
    ];

    const res = await service.forShift(actor, 'shift-1');

    expect(res.grades[0].reweigh_net_kg).toBe('0.00');
    expect(res.products[0].state).toBe('not_reweighed');
    expect(res.products[0].missing_kg).toBeNull();
  });

  it('is empty when the shift accepted nothing', async () => {
    rows = [];
    const res = await service.forShift(actor, 'shift-1');
    expect(res.grades).toEqual([]);
    expect(res.accepted_anything).toBe(false);
  });
});
```

Add a `gradeRow` factory beside the file's existing helpers if it has none:

```ts
const gradeRow = (over: Partial<GradeTotalsRow> & Pick<GradeTotalsRow, 'product_grade_id'>): GradeTotalsRow => ({
  product_id: 'prod-1',
  product_name: 'Малина',
  product_grade_name: 'Малина 1',
  intake_net_kg: '100.00',
  intake_amount: '10000.00',
  reweigh_net_kg: null,
  ...over,
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w backend -- reweigh-reconciliation.service`
Expected: FAIL — `res.grades` is `undefined`.

- [ ] **Step 3: Implement**

In `reweigh-reconciliation.service.ts`:

1. Add `product_grade_name: string;` to `GradeTotalsRow`, below `product_grade_id`.
2. Add `pg.name AS product_grade_name,` to the `gradeTotals` SELECT (after the `pg.id` line) and add `pg.name` to the `GROUP BY` list.
3. Add the `ReconciliationGrade` interface from **Interfaces** above, and `grades: ReconciliationGrade[];` to `ReconciliationResponse` — document it:

```ts
  /**
   * ONE ROW PER GRADE THE SHIFT ACCEPTED — the picker on §8.1's screen.
   *
   * The API refuses a grade this shift did not accept (`GRADE_NOT_ACCEPTED`),
   * so the picker has to promise exactly that set, from exactly this query:
   * a list assembled anywhere else drifts from the refusal it is meant to
   * prevent. `gradeTotals` already computes these rows and the product rollup
   * below used to discard the grade identity; this keeps it.
   *
   * `reweigh_net_kg` is '0.00', never null: «не перезважено» is a PRODUCT
   * state (§3.15) and it lives on `products[]`. A second, weaker copy of that
   * rule at grade level is how the two screens drift apart.
   */
```

4. Build it in `forShift`, from `rows`, before the `byProduct` loop:

```ts
    const grades: ReconciliationGrade[] = rows.map((r) => ({
      product_grade_id: r.product_grade_id,
      product_grade_name: r.product_grade_name,
      product_id: r.product_id,
      product_name: r.product_name,
      intake_net_kg: r.intake_net_kg,
      reweigh_net_kg: r.reweigh_net_kg ?? '0.00',
    }));
```

5. Return `grades` in the response object.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w backend -- reweigh-reconciliation.service`
Expected: PASS, including every pre-existing case in the file.

- [ ] **Step 5: Prove the SQL against a real Postgres**

`gradeTotals`'s `GROUP BY` change is exactly the kind of thing a mocked spec cannot see. Add to `backend/src/reweighs/reweigh-reconciliation.db-spec.ts`, following its existing fixture helpers:

```ts
  it('returns one grade row per accepted grade, named', async () => {
    // …seed a shift with an intake covering two grades of one product…
    const res = await service.forShift(owner, shiftId);

    expect(res.grades.map((g) => g.product_grade_name).sort()).toEqual(['Малина 1', 'Малина 3']);
    expect(res.grades.every((g) => g.product_id === productId)).toBe(true);
  });
```

Run: `npm run test:db -w backend -- reweigh-reconciliation`
Expected: PASS. If Postgres is not up: `docker compose up -d postgres redis` first.

- [ ] **Step 6: Commit**

```bash
git add backend/src/reweighs/reweigh-reconciliation.service.ts \
        backend/src/reweighs/reweigh-reconciliation.service.spec.ts \
        backend/src/reweighs/reweigh-reconciliation.db-spec.ts
git commit -m "$(cat <<'EOF'
feat(reweighs): state the accepted grades the picker must promise

The API refuses a grade the shift did not accept (GRADE_NOT_ACCEPTED), but
nothing told a client which grades those are: the reconciliation computed one
row per grade and threw the grade identity away at the product rollup. A
screen would have had to rebuild the set from the receipts, which is an N+1
and, worse, a second definition of a rule the server already enforces.

reweigh_net_kg is '0.00' here and never null on purpose — «не перезважено» is
a product-level state (§3.15) and stays on products[].

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Backend — `?include_voided=true`

**Files:**
- Modify: `backend/src/reweighs/reweigh-reconciliation.service.ts`
- Modify: `backend/src/reweighs/reweighs.controller.ts`
- Test: `backend/src/reweighs/reweigh-reconciliation.service.spec.ts`

**Interfaces:**
- Consumes: `ReconciliationResponse` and `ReconciliationGrade` from Task 1.
- Produces: `forShift(actor, shiftId, includeVoided = false)` — a third positional argument, defaulting to the current behaviour.

- [ ] **Step 1: Write the failing test**

```ts
describe('include_voided', () => {
  it('omits voided lines by default', async () => {
    await service.forShift(actor, 'shift-1');
    expect(itemRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { reweigh: { shift_id: 'shift-1' }, voided_at: IsNull() },
      }),
    );
  });

  it('asks for every line, voided included, when told to', async () => {
    await service.forShift(actor, 'shift-1', true);
    expect(itemRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { reweigh: { shift_id: 'shift-1' } } }),
    );
  });

  it('never lets a voided line move a products[] figure', async () => {
    // `products[]` comes from gradeTotals' SQL, which filters ri.voided_at IS NULL
    // itself — the flag must not reach it.
    rows = [
      gradeRow({
        product_grade_id: 'g-1',
        intake_net_kg: '200.00', intake_amount: '20000.00', reweigh_net_kg: '190.00',
      }),
    ];
    const withVoided = await service.forShift(actor, 'shift-1', true);
    const without = await service.forShift(actor, 'shift-1', false);
    expect(withVoided.products).toEqual(without.products);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w backend -- reweigh-reconciliation.service`
Expected: FAIL — the second case still receives a `voided_at: IsNull()` filter.

- [ ] **Step 3: Implement**

In `forShift`, add the parameter and build the `where` conditionally:

```ts
  async forShift(
    _actor: AuthenticatedUser,
    shiftId: string,
    includeVoided = false,
  ): Promise<ReconciliationResponse> {
```

```ts
    // §8.7's storno leaves the row: «документ НЕ зникає». Filtering voided
    // lines out of `items[]` made that promise false on screen — the line the
    // owner had just voided vanished on the next refetch, taking its reason
    // and its author with it. The flag governs THIS LIST ONLY: `products[]`
    // comes from `gradeTotals`, whose own SQL filters `ri.voided_at IS NULL`,
    // so a voided line can never be counted whatever is passed here.
    const items = await this.dataSource.getRepository(ReweighItem).find({
      where: includeVoided
        ? { reweigh: { shift_id: shiftId } }
        : { reweigh: { shift_id: shiftId }, voided_at: IsNull() },
      relations: { product_grade: { product: true }, tare: { tare_type: true } },
      order: { created_at: 'DESC', item_order: 'DESC' },
    });
```

> **CORRECTED 2026-09-21, during execution.** This step originally specified
> `@Query('include_voided', new ParseBoolPipe({ optional: true }))`. That was a plan
> defect and was replaced during Task 2's fix round 1 (commit `3204c40`). The reasons,
> checked against source: `backend/src/common/dto/boolean-query-param.ts` exists to be
> "the one answer to 'is this query flag on?'"; **nine** DTOs use `BooleanQueryParam()`,
> and `backend/src/intake-top-ups/dto/list-intake-top-ups.query.ts` already carries the
> literal `include_voided` flag. `ParseBoolPipe` would have been the only use of that pipe
> in `backend/src`, and it disagrees with the established decorator on the same parameter
> name — `?include_voided=1` is accepted by one and rejected by the other, `?include_voided=`
> throws because the pipe's optional check is `value === undefined` rather than empty, and
> both failures bypass the global `ValidationPipe`'s 400 shape so the caller gets no field
> name. Do not restore the pipe. What follows is what was actually built.

Add a query DTO beside the module, following `backend/src/intake-top-ups/dto/list-intake-top-ups.query.ts`
for shape and naming — `backend/src/reweighs/dto/reweigh-reconciliation.query.ts`:

```ts
import { BooleanQueryParam } from '../../common/dto/boolean-query-param';

export class ReweighReconciliationQueryDto {
  /**
   * Left OPTIONAL with no DTO-level default on purpose. The default lives on
   * `forShift(…, includeVoided = false)`; a second one here would make one of
   * the two dead, and the dead one is the one a reader would trust.
   */
  @BooleanQueryParam()
  include_voided?: boolean;
}
```

Then in `reweighs.controller.ts` take the DTO whole. `query.include_voided` is `undefined`
when the param is absent, which fires `forShift`'s own default; an explicit `false` is
passed through unchanged, so the default does not fire for it. No `?? false`:

```ts
  @Get('shifts/:shiftId/reweigh')
  reconciliation(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('shiftId', ParseUUIDPipe) shiftId: string,
    @Query() query: ReweighReconciliationQueryDto,
  ): Promise<ReconciliationResponse> {
    return this.reconciliation_.forShift(actor, shiftId, query.include_voided);
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w backend -- reweigh-reconciliation.service`
Expected: PASS.

- [ ] **Step 4b: Prove it against a real Postgres**

> **ADDED 2026-09-21, during execution.** The three unit tests above assert the `where`
> object literal handed to a mocked `itemRepo.find` — that restates the implementation and
> cannot show that TypeORM's nested `where: { reweigh: { shift_id } }`, with the
> `voided_at` key omitted, actually returns voided rows. `backend/CLAUDE.md` is explicit
> that db-specs exist for "Postgres semantics that a mocked spec cannot reach", and
> `backend/src/intake-top-ups/intake-top-ups-list.db-spec.ts` already tests this exact flag
> that way. Landed in commit `3204c40`.

Add to `backend/src/reweighs/reweigh-reconciliation.db-spec.ts`, following that file's
existing uuid-scoped fixture conventions, a case that inserts one live and one voided
`reweigh_items` row (all three void columns — the entity's CHECK is `num_nulls(...) IN (0,3)`)
and then calls `forShift` three ways, asserting:

- with `true`, the voided line APPEARS in `items[]`, carrying its `voided_at` and `void_reason`;
- with `false`, and with the argument OMITTED, it is ABSENT;
- `products[]` is identical across all three calls — a voided line must never move a number,
  which is the requirement the whole task exists for.

Run: `npm run test:db -w backend -- reweigh-reconciliation`
Expected: PASS. (`docker compose up -d postgres redis` first if Postgres is not up.)

- [ ] **Step 5: Run the money gate**

`reweigh-reconciliation.service.ts` is money code, so the fast tier is blind to what matters here.

Run: `npm run verify:full`
Expected: every row `PASSED` or `SKIPPED`. Paste the verdict line and say aloud which rows were skipped and why.

- [ ] **Step 6: Commit**

```bash
git add backend/src/reweighs/reweigh-reconciliation.service.ts \
        backend/src/reweighs/reweighs.controller.ts \
        backend/src/reweighs/reweigh-reconciliation.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(reweighs): let the caller ask for the voided lines too

§8.7 promises a storno leaves the row: «документ НЕ зникає: лишається з
позначкою "сторновано", часом, автором і причиною». items[] filtered
voided_at IS NULL, so on screen the promise was false — the line the owner
had just voided disappeared on the next refetch, with its reason and author.

The flag governs items[] alone. products[] is built by gradeTotals, whose SQL
filters ri.voided_at IS NULL itself, so a voided line stays uncounted no
matter what is passed here — asserted, not argued.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `entities/reweigh` — wire types and the reconciliation read

**Files:**
- Create: `frontend/src/entities/reweigh/model/reweigh.ts`
- Create: `frontend/src/entities/reweigh/api/useReweigh.ts`
- Create: `frontend/src/entities/reweigh/index.ts`
- Modify: `frontend/src/shared/api/queryKeys.ts`
- Test: `frontend/src/entities/reweigh/api/useReweigh.test.tsx`

**Interfaces:**
- Consumes: `httpClient`, `queryKeys`, `STALE` from `@/shared/api`; Task 1's and Task 2's response shape.
- Produces:
  ```ts
  export interface ReweighItemTare { tare_type_id: string; tare_type_name?: string; units: number }
  export interface ReweighItem {
    id: string; reweigh_id: string; item_order: number;
    product_grade_id: string; product_grade_name?: string;
    product_id?: string; product_name?: string;
    gross_kg: string; pallet_kg: string; tare_weight_kg: string; net_kg: string;
    tare: ReweighItemTare[];
    weighed_by_user_id: string;
    voided_at: string | null; voided_by_user_id: string | null; void_reason: string | null;
    created_at: string;
  }
  export interface ReconciliationProduct {
    product_id: string; product_name: string;
    intake_net_kg: string; reweigh_net_kg: string;
    state: 'weighed' | 'not_reweighed';
    missing_kg: string | null; missing_amount: string | null;
  }
  export interface ReconciliationGrade {
    product_grade_id: string; product_grade_name: string;
    product_id: string; product_name: string;
    intake_net_kg: string; reweigh_net_kg: string;
  }
  export interface Reweigh {
    shift_id: string; closed_at: string | null; accepted_anything: boolean;
    items: ReweighItem[]; products: ReconciliationProduct[]; grades: ReconciliationGrade[];
  }
  export function reweighQueryOptions(shiftId: string | undefined, opts?: { includeVoided?: boolean }): UseQueryOptions
  export function useReweighQuery(shiftId: string | undefined, opts?: { includeVoided?: boolean })
  ```
  `reweighQueryOptions` is a `queryOptions()` factory, not just a hook, because Task 8's fan-out passes it to `useQueries` — the same reason `shiftOnDateQueryOptions` is one.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { useReweighQuery, reweighQueryOptions } from './useReweigh';

vi.mock('@/shared/api', async (orig) => ({
  ...(await orig<typeof import('@/shared/api')>()),
  httpClient: { get: vi.fn() },
}));

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

beforeEach(() => vi.clearAllMocks());

describe('useReweighQuery', () => {
  it('reads one shift reconciliation', async () => {
    vi.mocked(httpClient.get).mockResolvedValue({
      data: { shift_id: 's1', closed_at: null, accepted_anything: true, items: [], products: [], grades: [] },
    });

    const { result } = renderHook(() => useReweighQuery('s1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(httpClient.get).toHaveBeenCalledWith('/shifts/s1/reweigh', { params: {} });
  });

  it('asks for the voided lines when told to', async () => {
    vi.mocked(httpClient.get).mockResolvedValue({
      data: { shift_id: 's1', closed_at: null, accepted_anything: true, items: [], products: [], grades: [] },
    });

    renderHook(() => useReweighQuery('s1', { includeVoided: true }), { wrapper });

    await waitFor(() =>
      expect(httpClient.get).toHaveBeenCalledWith('/shifts/s1/reweigh', {
        params: { include_voided: true },
      }),
    );
  });

  it('does not fire without a shift — «no shift» is a state, not a request', () => {
    const { result } = renderHook(() => useReweighQuery(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(httpClient.get).not.toHaveBeenCalled();
  });

  it('keys the two variants apart so one never serves the other', () => {
    const plain = reweighQueryOptions('s1').queryKey;
    const voided = reweighQueryOptions('s1', { includeVoided: true }).queryKey;
    expect(plain).not.toEqual(voided);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w frontend -- useReweigh`
Expected: FAIL — cannot resolve `./useReweigh`.

- [ ] **Step 3: Implement**

`shared/api/queryKeys.ts` — add, beside `crates`:

```ts
  /** Переважування — префікс; читання дописує зміну і прапорець сторнованих. */
  reweighs: ['reweighs'] as const,
```

`entities/reweigh/model/reweigh.ts` — the interfaces from **Interfaces** above, each carrying a one-line doc comment saying what the field means (mirror the wording of `entities/intake/model/intake.ts`: every weight is a STRING, `numeric` carried end to end).

`entities/reweigh/api/useReweigh.ts`:

```ts
import { queryOptions, useQuery } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { STALE } from '@/shared/api/queryClient';
import type { Reweigh } from '../model/reweigh';

/**
 * §8.2's звірка for ONE shift — the point's kilograms next to the base's.
 *
 * Built with `queryOptions()` because the day table fans this exact read out
 * over every point with `useQueries`; a hook alone could not be reused there
 * without duplicating the key and the fetcher.
 *
 * `includeVoided` is part of the KEY, not just the request: the two variants
 * answer different questions («what counts» vs «what happened»), and letting
 * one serve the other from cache would make a voided line flicker in and out
 * of a table depending on which screen asked first.
 */
export function reweighQueryOptions(
  shiftId: string | undefined,
  { includeVoided = false }: { includeVoided?: boolean } = {},
) {
  return queryOptions({
    queryKey: [...queryKeys.reweighs, shiftId, { includeVoided }] as const,
    enabled: shiftId !== undefined,
    queryFn: async (): Promise<Reweigh> => {
      const { data } = await httpClient.get<Reweigh>(`/shifts/${shiftId}/reweigh`, {
        params: includeVoided ? { include_voided: true } : {},
      });
      return data;
    },
    staleTime: STALE.list,
  });
}

export function useReweighQuery(
  shiftId: string | undefined,
  opts: { includeVoided?: boolean } = {},
) {
  return useQuery(reweighQueryOptions(shiftId, opts));
}
```

`entities/reweigh/index.ts`:

```ts
export { reweighQueryOptions, useReweighQuery } from './api/useReweigh';
export type {
  Reweigh, ReweighItem, ReweighItemTare,
  ReconciliationProduct, ReconciliationGrade,
} from './model/reweigh';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w frontend -- useReweigh`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/entities/reweigh frontend/src/shared/api/queryKeys.ts
git commit -m "$(cat <<'EOF'
feat(reweigh): read one shift's звірка

A queryOptions factory rather than a bare hook, because the day table fans
this same read out across every point with useQueries — the shape
shiftOnDateQueryOptions already set.

include_voided is part of the cache key, not just the request. The two
variants answer different questions — «what counts» and «what happened» — and
sharing an entry would make a voided line appear or vanish depending on which
screen asked first.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `entities/reweigh` — the two line mutations

**Files:**
- Create: `frontend/src/entities/reweigh/api/useReweighMutations.ts`
- Modify: `frontend/src/entities/reweigh/index.ts`
- Test: `frontend/src/entities/reweigh/api/useReweighMutations.test.tsx`

**Interfaces:**
- Consumes: `queryKeys.reweighs` (Task 3).
- Produces:
  ```ts
  export interface AddReweighItemInput {
    shiftId: string;
    product_grade_id: string;
    gross_kg: string;
    pallet_kg?: string;
    tare: { tare_type_id: string; units: number }[];
  }
  export function useAddReweighItemMutation(): UseMutationResult<ReweighItem, unknown, AddReweighItemInput>
  export function useVoidReweighItemMutation(): UseMutationResult<ReweighItem, unknown, { id: string; reason: string }>
  ```

- [ ] **Step 1: Write the failing test**

```tsx
describe('useAddReweighItemMutation', () => {
  it('posts one line to its shift and invalidates the reweigh reads', async () => {
    vi.mocked(httpClient.post).mockResolvedValue({ data: { id: 'ri1' } });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useAddReweighItemMutation(), { wrapper: wrapperFor(qc) });
    await result.current.mutateAsync({
      shiftId: 's1',
      product_grade_id: 'g1',
      gross_kg: '120.50',
      pallet_kg: '20.00',
      tare: [{ tare_type_id: 't1', units: 10 }],
    });

    expect(httpClient.post).toHaveBeenCalledWith('/shifts/s1/reweigh-items', {
      product_grade_id: 'g1',
      gross_kg: '120.50',
      pallet_kg: '20.00',
      tare: [{ tare_type_id: 't1', units: 10 }],
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.reweighs });
  });

  it('omits an absent pallet rather than sending a zero string', async () => {
    vi.mocked(httpClient.post).mockResolvedValue({ data: { id: 'ri1' } });
    const { result } = renderHook(() => useAddReweighItemMutation(), { wrapper });
    await result.current.mutateAsync({
      shiftId: 's1', product_grade_id: 'g1', gross_kg: '10.00', tare: [],
    });
    expect(httpClient.post).toHaveBeenCalledWith('/shifts/s1/reweigh-items', {
      product_grade_id: 'g1', gross_kg: '10.00', tare: [],
    });
  });
});

describe('useVoidReweighItemMutation', () => {
  it('voids by LINE id with the reason and invalidates', async () => {
    vi.mocked(httpClient.post).mockResolvedValue({ data: { id: 'ri1' } });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useVoidReweighItemMutation(), { wrapper: wrapperFor(qc) });
    await result.current.mutateAsync({ id: 'ri1', reason: 'двічі ввели ту саму машину' });

    expect(httpClient.post).toHaveBeenCalledWith('/reweigh-items/ri1/void', {
      reason: 'двічі ввели ту саму машину',
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.reweighs });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w frontend -- useReweighMutations`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import type { ReweighItem } from '../model/reweigh';

export interface AddReweighItemInput {
  shiftId: string;
  product_grade_id: string;
  gross_kg: string;
  pallet_kg?: string;
  tare: { tare_type_id: string; units: number }[];
}

/**
 * §8.1 — ONE weighing on the scale, written on its own.
 *
 * There is no document to post: the `reweighs` header is created lazily by the
 * server on the first line of a shift, and each line stands alone. The screen's
 * draft buffer is a convenience in the browser, not a document in waiting.
 *
 * `tare_weight_kg` and `net_kg` are NOT sent. The server computes both from the
 * tare catalogue and snapshots the weights onto the line (§2.5, §2.7) — a
 * client-supplied net weight would be a human's number where the schema wants
 * the scale's.
 *
 * Invalidating the whole `reweighs` prefix, not one key: the line moves this
 * shift's звірка AND its row in the day table, which is a second cache entry
 * with `includeVoided: true`.
 */
export function useAddReweighItemMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ shiftId, ...line }: AddReweighItemInput): Promise<ReweighItem> => {
      const { data } = await httpClient.post<ReweighItem>(`/shifts/${shiftId}/reweigh-items`, line);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.reweighs }),
  });
}

/**
 * §8.7 — the storno of ONE weighing, reason required.
 *
 * Addressed by LINE id, not by document: this backend voids a line at a time,
 * and the row stays in place with its trio so the evidence survives.
 */
export function useVoidReweighItemMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }): Promise<ReweighItem> => {
      const { data } = await httpClient.post<ReweighItem>(`/reweigh-items/${id}/void`, { reason });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.reweighs }),
  });
}
```

Note the `pallet_kg` behaviour the second test pins: spreading `...line` from an input whose `pallet_kg` is absent produces a body without the key, which is what the optional DTO field wants. Do **not** default it to `'0.00'` here — the server already does, and a client default is a second place for that rule to live.

Export both from `entities/reweigh/index.ts`, plus `type AddReweighItemInput`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w frontend -- useReweighMutations`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/entities/reweigh
git commit -m "$(cat <<'EOF'
feat(reweigh): write and void one weighing

Neither call carries tare_weight_kg or net_kg: the server computes both from
the tare catalogue and snapshots them onto the line (§2.5, §2.7), and a
client-supplied net weight would be a human's number where the schema wants
the scale's.

An absent pallet is omitted rather than sent as '0.00'. The DTO already
defaults it, and a second default in the browser is a second place for that
rule to drift.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `shared/lib/money` — `mul`, and the page's draft model

**Files:**
- Modify: `frontend/src/shared/lib/money/decimal.ts`
- Modify: `frontend/src/shared/lib/money/index.ts`
- Test: `frontend/src/shared/lib/money/decimal.test.ts` (existing file)
- Create: `frontend/src/pages/reweigh/model/draft.ts`
- Test: `frontend/src/pages/reweigh/model/draft.test.ts`

**Interfaces:**
- Consumes: `sub`, `sum` from `@/shared/lib/money`; `ReweighItemTare` from `@/entities/reweigh`.
- Produces:
  ```ts
  // shared/lib/money
  export function mul(value: string, by: number): string   // decimal × whole count, exact

  // pages/reweigh/model/draft.ts
  export interface DraftTare { tare_type_id: string; units: number }
  export interface Draft {
    key: string;
    product_grade_id: string; product_grade_name: string;
    product_id: string; product_name: string;
    gross_kg: string; pallet_kg: string;
    tare: DraftTare[]; tare_weight_kg: string; net_kg: string;
  }
  export function newDraftKey(): string
  export function tareWeightOf(tare: DraftTare[], weightById: Map<string, string>): string
  export function netOf(gross: string, pallet: string, tareWeight: string): string
  ```

**Why `mul` belongs in `shared/lib/money`:** the чиста вага preview needs `weight_kg × units`, and this module deliberately has no multiplication — the reception screen avoids needing one by asking the server (`POST /intakes/preview`). There is no reweigh preview endpoint, and adding one to compute a subtraction the browser can do exactly is a round trip per keystroke. A decimal times a **whole count** is exact in kopiykas — no rounding decision, no float — which is why this is a safe addition and `mul(a, b)` over two decimals is not.

- [ ] **Step 1: Write the failing tests**

Append to `shared/lib/money/decimal.test.ts`:

```ts
describe('mul', () => {
  it('multiplies a decimal string by a whole count, exactly', () => {
    expect(mul('1.20', 10)).toBe('12.00');
    expect(mul('0.35', 3)).toBe('1.05');
    expect(mul('12.34', 0)).toBe('0.00');
  });

  it('holds a value a float would drift on', () => {
    // 0.07 * 3 === 0.21000000000000002 in binary floating point
    expect(mul('0.07', 3)).toBe('0.21');
  });

  it('keeps the sign', () => {
    expect(mul('-2.50', 4)).toBe('-10.00');
  });

  it('refuses a non-whole multiplier — that is a caller bug, not a value to round', () => {
    expect(() => mul('1.00', 1.5)).toThrow();
    expect(() => mul('1.00', -1)).toThrow();
  });
});
```

Create `pages/reweigh/model/draft.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { tareWeightOf, netOf, newDraftKey } from './draft';

const WEIGHTS = new Map([
  ['t-crate', '1.20'],
  ['t-box', '0.35'],
]);

describe('tareWeightOf', () => {
  it('sums each tare type at its catalogue weight', () => {
    expect(tareWeightOf([{ tare_type_id: 't-crate', units: 10 }], WEIGHTS)).toBe('12.00');
  });

  it('adds several tare types on one line', () => {
    expect(
      tareWeightOf(
        [{ tare_type_id: 't-crate', units: 10 }, { tare_type_id: 't-box', units: 3 }],
        WEIGHTS,
      ),
    ).toBe('13.05');
  });

  it('is zero with no tare — the mock warns about this, it does not compute around it', () => {
    expect(tareWeightOf([], WEIGHTS)).toBe('0.00');
  });

  it('ignores a tare type the catalogue does not carry rather than guessing a weight', () => {
    expect(tareWeightOf([{ tare_type_id: 'gone', units: 10 }], WEIGHTS)).toBe('0.00');
  });
});

describe('netOf', () => {
  it('subtracts the pallet FIRST, then the tare (§8.1)', () => {
    expect(netOf('701.50', '20.00', '12.00')).toBe('669.50');
  });

  it('can go negative — the screen blocks on that, the arithmetic does not lie about it', () => {
    expect(netOf('10.00', '8.00', '5.00')).toBe('-3.00');
  });

  it('holds a value a float would drift on', () => {
    expect(netOf('0.30', '0.10', '0.00')).toBe('0.20');
  });
});

describe('newDraftKey', () => {
  it('does not repeat', () => {
    const keys = new Set(Array.from({ length: 200 }, newDraftKey));
    expect(keys.size).toBe(200);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w frontend -- decimal draft`
Expected: FAIL — `mul` is not exported; `./draft` does not exist.

- [ ] **Step 3: Implement**

In `shared/lib/money/decimal.ts`, beside `div` (whose doc it mirrors):

```ts
/**
 * A decimal string times a WHOLE COUNT — «скільки важать десять ящиків»: the
 * reweigh screen's tare weight is `Σ units × tare_types.weight_kg`, and the
 * чиста вага falls out of it live, under the owner's hands at the scale.
 *
 * `by` is a COUNT, not money, so it is a `number`; anything but a non-negative
 * integer is a caller bug. NO ROUNDING HAPPENS HERE and none is possible: a
 * scale-2 value times an integer is exact in kopiykas, which is why this is a
 * safe addition to a module that deliberately has no general multiplication.
 * Two decimals multiplied together would need a rounding rule, and that rule
 * belongs on the server, beside the column it writes.
 */
export function mul(value: string, by: number): string {
  if (!Number.isInteger(by) || by < 0) {
    throw new Error(`Not a whole count: ${by}`);
  }
  return fromKopiykas(toKopiykas(value) * BigInt(by));
}
```

Add `mul` to the `export {...}` list in `shared/lib/money/index.ts`.

`pages/reweigh/model/draft.ts`:

```ts
import { mul, sub, sum } from '@/shared/lib/money';

/** One tare type on a line: which crate, how many of them. */
export interface DraftTare {
  tare_type_id: string;
  units: number;
}

/**
 * A position that lives in the memory of the PAGE — there is no document yet.
 *
 * `tare_weight_kg` and `net_kg` are a PREVIEW, computed here so the owner sees
 * the чиста вага fall out of the gross under their hands. The server computes
 * both again from the tare catalogue and snapshots ITS values onto the line;
 * after the post, the list shows the server's. If the two ever disagree, the
 * server is right and the screen is stale — never the other way round.
 */
export interface Draft {
  /** Client-side only; never sent. */
  key: string;
  product_grade_id: string;
  product_grade_name: string;
  product_id: string;
  product_name: string;
  gross_kg: string;
  pallet_kg: string;
  tare: DraftTare[];
  tare_weight_kg: string;
  net_kg: string;
}

let counter = 0;
export function newDraftKey(): string {
  counter += 1;
  return `rwl_${counter}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * `Σ units × weight_kg` from the tare catalogue.
 *
 * A tare type the catalogue does not carry contributes NOTHING rather than a
 * guessed weight: the picker only offers live types, and inventing a weight
 * for an unknown one would print a чиста вага that the server then refuses —
 * the owner would see a number change for no reason they can see.
 */
export function tareWeightOf(tare: DraftTare[], weightById: Map<string, string>): string {
  return sum(
    tare.map((t) => {
      const weight = weightById.get(t.tare_type_id);
      return weight === undefined ? '0.00' : mul(weight, t.units);
    }),
  );
}

/** §8.1: pallet FIRST, tare second. Never a human's number. */
export function netOf(gross: string, pallet: string, tareWeight: string): string {
  return sub(sub(gross, pallet), tareWeight);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w frontend -- decimal draft`
Expected: PASS (`mul`: 4, `draft`: 8), and every pre-existing `decimal` case still green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shared/lib/money frontend/src/pages/reweigh/model
git commit -m "$(cat <<'EOF'
feat(money): multiply a decimal by a whole count, and model a draft line

The reweigh screen computes чиста вага under the owner's hands at the scale,
so the tare weight (Σ units × weight_kg) cannot be a round trip per keystroke
the way the reception screen's preview is. This module had no multiplication
on purpose; a scale-2 value times an INTEGER is exact in kopiykas, so it needs
no rounding rule and invents no authority. Two decimals multiplied would need
one, and that rule stays on the server beside the column it writes.

Both preview weights are labelled as such: the server recomputes and snapshots
its own, and after the post the list shows the server's.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `pages/reweigh/lib/hints.ts` — why the button is inactive

**Files:**
- Create: `frontend/src/pages/reweigh/lib/hints.ts`
- Test: `frontend/src/pages/reweigh/lib/hints.test.ts`

**Interfaces:**
- Consumes: `cmp` from `@/shared/lib/money`.
- Produces:
  ```ts
  export const GROSS_SUSPECT_KG = 800;
  export const TARE_SUSPECT_UNITS = 120;
  export type BlockReason =
    | 'noShift' | 'nothingAccepted' | 'noGrade' | 'noGross' | 'noNet' | null;
  export function addBlockReason(input: {
    hasShift: boolean; acceptedAnything: boolean;
    gradeId: string | null; grossKg: string; netKg: string;
  }): BlockReason
  export function grossHint(grossKg: string): boolean
  export function tareHint(units: number, grossKg: string): 'tooMany' | 'none' | null
  ```
  These return **reason codes, not sentences**: the copy is i18n and the page resolves it. A pure function that returns a formatted Ukrainian string cannot be tested in a suite that runs in English.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { addBlockReason, grossHint, tareHint, GROSS_SUSPECT_KG, TARE_SUSPECT_UNITS } from './hints';

const ok = {
  hasShift: true, acceptedAnything: true,
  gradeId: 'g1', grossKg: '120.00', netKg: '100.00',
};

describe('addBlockReason', () => {
  it('lets a complete line through', () => {
    expect(addBlockReason(ok)).toBeNull();
  });

  it('names the missing shift FIRST — it precedes every other question', () => {
    expect(
      addBlockReason({ ...ok, hasShift: false, acceptedAnything: false, gradeId: null, grossKg: '0.00' }),
    ).toBe('noShift');
  });

  it('names an empty day before a missing grade', () => {
    expect(addBlockReason({ ...ok, acceptedAnything: false, gradeId: null })).toBe('nothingAccepted');
  });

  it('asks for a grade before a weight', () => {
    expect(addBlockReason({ ...ok, gradeId: null, grossKg: '0.00' })).toBe('noGrade');
  });

  it('asks for the gross weight before judging the net', () => {
    expect(addBlockReason({ ...ok, grossKg: '0.00', netKg: '-5.00' })).toBe('noGross');
  });

  it('refuses a line the pallet and tare eat entirely', () => {
    expect(addBlockReason({ ...ok, netKg: '0.00' })).toBe('noNet');
    expect(addBlockReason({ ...ok, netKg: '-0.01' })).toBe('noNet');
  });
});

describe('grossHint', () => {
  it('warns above the season record, not at it', () => {
    expect(grossHint(`${GROSS_SUSPECT_KG}.00`)).toBe(false);
    expect(grossHint(`${GROSS_SUSPECT_KG}.01`)).toBe(true);
    expect(grossHint('701.50')).toBe(false);
  });
});

describe('tareHint', () => {
  it('warns above the season record, not at it', () => {
    expect(tareHint(TARE_SUSPECT_UNITS, '500.00')).toBeNull();
    expect(tareHint(TARE_SUSPECT_UNITS + 1, '500.00')).toBe('tooMany');
  });

  it('warns that berry weight would go into the net when no tare is entered', () => {
    expect(tareHint(0, '500.00')).toBe('none');
  });

  it('says nothing about missing tare before there is a weight to misattribute', () => {
    expect(tareHint(0, '0.00')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w frontend -- hints`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { cmp } from '@/shared/lib/money';

/**
 * Suspicion thresholds — the SAME numbers the reception screen uses; we invent
 * none (`03-scenarios-owner.md:899-900`): the season's record is 701,5 кг
 * gross and 115 crates. These are WARNINGS beside the field, never blocks —
 * the owner standing at the scale reads the weight better than we do.
 */
export const GROSS_SUSPECT_KG = 800;
export const TARE_SUSPECT_UNITS = 120;

export type BlockReason = 'noShift' | 'nothingAccepted' | 'noGrade' | 'noGross' | 'noNet' | null;

/**
 * Why «+ ще позиція» is inactive — a REASON CODE, resolved to copy by the page.
 *
 * The order is the message. «Того дня тут нічого не приймали» has to win over
 * «оберіть сорт», or the owner who picked the wrong point is told to fix the
 * grade. `noShift` sits on top of the mock's ladder and has no counterpart
 * there at all: the mock has documents over a flat date, while here a weighing
 * needs the shift that (point, date) resolves to, and no shift is no screen.
 *
 * The mock's «Товар … не приймали» rung is GONE: the picker is built from the
 * server's `grades[]`, so an unaccepted grade is unpickable rather than
 * pickable-then-refused.
 */
export function addBlockReason({
  hasShift,
  acceptedAnything,
  gradeId,
  grossKg,
  netKg,
}: {
  hasShift: boolean;
  acceptedAnything: boolean;
  gradeId: string | null;
  grossKg: string;
  netKg: string;
}): BlockReason {
  if (!hasShift) return 'noShift';
  if (!acceptedAnything) return 'nothingAccepted';
  if (!gradeId) return 'noGrade';
  if (cmp(grossKg, '0.00') <= 0) return 'noGross';
  if (cmp(netKg, '0.00') <= 0) return 'noNet';
  return null;
}

/** Above the season's heaviest line — «перевірте вагу», not «не можна». */
export function grossHint(grossKg: string): boolean {
  return cmp(grossKg, `${GROSS_SUSPECT_KG}.00`) > 0;
}

/**
 * Two different warnings, never both: too many crates to be believable, or no
 * crates at all under a real gross — in which case the berry's own container
 * weight would walk into the чиста вага untouched.
 */
export function tareHint(units: number, grossKg: string): 'tooMany' | 'none' | null {
  if (units > TARE_SUSPECT_UNITS) return 'tooMany';
  if (units === 0 && cmp(grossKg, '0.00') > 0) return 'none';
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w frontend -- hints`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/reweigh/lib
git commit -m "$(cat <<'EOF'
feat(reweigh): the ladder that says why a line cannot be added

The ORDER is the message, so it is pinned by a test per rung: «того дня тут
нічого не приймали» has to beat «оберіть сорт», or the owner who picked the
wrong point is told to fix the grade instead of the point.

Two rungs differ from the mock. `noShift` is new and sits on top — the mock
has documents over a flat date, while a weighing here needs the shift that
(point, date) resolves to. The mock's «товар не приймали» rung is gone,
because the picker is now built from the server's own grades[]: an unaccepted
grade is unpickable rather than pickable-then-refused.

Reason codes, not sentences — the suite runs in English and the copy is i18n.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `entities/user` — the staff directory for the void trace

**Files:**
- Create: `frontend/src/entities/user/api/useStaff.ts`
- Modify: `frontend/src/entities/user/index.ts`
- Test: `frontend/src/entities/user/api/useStaff.test.tsx`

**Interfaces:**
- Consumes: `httpClient`, `queryKeys.users`, `STALE`, `Paginated` from `@/shared/api`.
- Produces:
  ```ts
  export interface StaffMember {
    id: string; first_name: string | null; last_name: string | null; login: string;
  }
  export function useStaffQuery(enabled: boolean): UseQueryResult<Map<string, string>>
  ```
  It resolves to a **`Map<userId, displayName>`** rather than a list: every consumer wants «who is `voided_by_user_id`», and returning the list would put the same `.find()` in each of them.

**Why here:** `GET /users` exists today only inside `pages/users/api/users.ts`, and a page may not import another page. The read moves down to the entity layer that already owns «who is signed in».

- [ ] **Step 1: Write the failing test**

```tsx
describe('useStaffQuery', () => {
  it('maps user ids to display names', async () => {
    vi.mocked(httpClient.get).mockResolvedValue({
      data: { data: [
        { id: 'u1', first_name: 'Оксана', last_name: 'Гайова', login: 'oksana' },
        { id: 'u2', first_name: null, last_name: null, login: 'admin' },
      ], total: 2, page: 1, limit: 100 },
    });

    const { result } = renderHook(() => useStaffQuery(true), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.get('u1')).toBe('Оксана Гайова');
  });

  it('falls back to the login when a name was never filled in', async () => {
    vi.mocked(httpClient.get).mockResolvedValue({
      data: { data: [{ id: 'u2', first_name: null, last_name: null, login: 'admin' }], total: 1, page: 1, limit: 100 },
    });

    const { result } = renderHook(() => useStaffQuery(true), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.get('u2')).toBe('admin');
  });

  it('does not fire for someone not allowed to read it', () => {
    const { result } = renderHook(() => useStaffQuery(false), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(httpClient.get).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w frontend -- useStaff`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Read `pages/users/api/users.ts` first and reuse its request shape and its `User` field names verbatim — this hook must not invent a second idea of what `GET /users` returns.

```ts
import { useQuery } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import type { Paginated } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { STALE } from '@/shared/api/queryClient';

export interface StaffMember {
  id: string;
  first_name: string | null;
  last_name: string | null;
  login: string;
}

/**
 * WHO — the staff directory, as an id → display-name map.
 *
 * A document stores `weighed_by_user_id` and `voided_by_user_id`, and every
 * screen that prints a storno trace has to turn one into a name. `GET /users`
 * is OWNER-ONLY, so `enabled` is the caller's answer to «is this reader
 * allowed to ask» — an operator screen passes `false` and simply prints no
 * name rather than firing a request that would 403.
 *
 * Resolves to a `Map`, not a list: every consumer wants a lookup, and handing
 * out the array puts the same `.find()` in each of them.
 */
export function useStaffQuery(enabled: boolean) {
  return useQuery({
    queryKey: [...queryKeys.users, 'directory'] as const,
    enabled,
    queryFn: async (): Promise<Map<string, string>> => {
      const { data } = await httpClient.get<Paginated<StaffMember>>('/users', {
        params: { limit: 100 },
      });
      return new Map(
        data.data.map((u) => [
          u.id,
          [u.first_name, u.last_name].filter(Boolean).join(' ') || u.login,
        ]),
      );
    },
    staleTime: STALE.reference,
  });
}
```

Export `useStaffQuery` and `type StaffMember` from `entities/user/index.ts`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w frontend -- useStaff`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/entities/user
git commit -m "$(cat <<'EOF'
feat(user): a staff directory any screen can read a name out of

A document stores weighed_by_user_id and voided_by_user_id, and a storno trace
has to print a name. The only GET /users read lived in pages/users, and a page
cannot import another page — so the read moves down to the layer that already
owns «who is signed in».

Resolves to a Map rather than a list, because every caller wants a lookup, and
`enabled` is the caller's answer to «may this reader ask at all»: the route is
owner-only, so an operator screen passes false and prints no name instead of
firing a request that would 403.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: `pages/reweigh/api/useDayReweighs.ts` — the all-points fan-out

**Files:**
- Create: `frontend/src/pages/reweigh/api/useDayReweighs.ts`
- Test: `frontend/src/pages/reweigh/api/useDayReweighs.test.tsx`

**Interfaces:**
- Consumes: `shiftOnDateQueryOptions` (`@/entities/shift`), `reweighQueryOptions` (Task 3), `PointOption` (`@/entities/collection-point`).
- Produces:
  ```ts
  export interface DayLine {
    item: ReweighItem;
    pointId: string;
    pointName: string;
  }
  export function useDayReweighs(points: PointOption[], date: string): {
    lines: DayLine[];   // newest first across every point
    isPending: boolean;
  }
  ```

**Shape:** two `useQueries` layers — shifts for every reception point on `date`, then the reconciliation for each shift that exists, with `includeVoided: true`. ~2×P requests for P points; `pages/dashboard/api/useNetworkToday.ts` is the precedent and worth reading before writing this.

- [ ] **Step 1: Write the failing test**

```tsx
const POINTS = [
  { id: 'p1', name: 'Шипинки', kind: 'reception' as const, target_crates: null },
  { id: 'p2', name: 'Конищів', kind: 'reception' as const, target_crates: null },
];

describe('useDayReweighs', () => {
  it('asks each point for its shift on that date', () => {
    renderHook(() => useDayReweighs(POINTS, '2026-09-21'), { wrapper });
    expect(shiftsSpy).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ queryKey: expect.arrayContaining(['p1', '2026-09-21']) })]),
    );
  });

  it('labels every line with the point it came from', async () => {
    // p1 -> shift s1 -> one line; p2 -> no shift
    const { result } = renderHook(() => useDayReweighs(POINTS, '2026-09-21'), { wrapper });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.lines).toHaveLength(1);
    expect(result.current.lines[0].pointName).toBe('Шипинки');
  });

  it('orders newest first ACROSS points, not per point', async () => {
    // s1 has a line at 10:00, s2 has one at 11:00
    const { result } = renderHook(() => useDayReweighs(POINTS, '2026-09-21'), { wrapper });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.lines.map((l) => l.pointId)).toEqual(['p2', 'p1']);
  });

  it('asks for the voided lines — a storno must stay visible', () => {
    renderHook(() => useDayReweighs(POINTS, '2026-09-21'), { wrapper });
    expect(reweighSpy).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ queryKey: expect.arrayContaining([{ includeVoided: true }]) }),
      ]),
    );
  });

  it('keeps a point with no shift out of the second wave entirely', () => {
    // p2 resolves to null -> no reconciliation query for it
    renderHook(() => useDayReweighs(POINTS, '2026-09-21'), { wrapper });
    expect(reweighSpy.mock.calls.at(-1)?.[0]).toHaveLength(1);
  });
});
```

Mock `useQueries` per the existing `useNetworkToday` test if that file has one; otherwise mock `@/entities/shift` and `@/entities/reweigh` and let a real `QueryClient` drive both waves.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w frontend -- useDayReweighs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { shiftOnDateQueryOptions } from '@/entities/shift';
import { reweighQueryOptions, type ReweighItem } from '@/entities/reweigh';
import type { PointOption } from '@/entities/collection-point';

export interface DayLine {
  item: ReweighItem;
  pointId: string;
  pointName: string;
}

/**
 * Every weighing recorded for a DAY, across every point — the mock's «по всіх
 * пунктах» table.
 *
 * Assembled client-side from the two per-shift reads this API has, in the
 * pattern `pages/dashboard`'s `useNetworkToday` set: one wave for the shifts,
 * a second for the reconciliations. That is ~2×P requests for P points, which
 * is fine at the five working points this network has and is NOT fine at
 * thirty — a day-wide `GET /reweigh-items?date=` is the follow-up, and this is
 * the code it replaces.
 *
 * `includeVoided` is on: §8.7's storno leaves the row, and this table is the
 * only place it stays readable.
 */
export function useDayReweighs(points: PointOption[], date: string) {
  const shifts = useQueries({
    queries: points.map((p) => shiftOnDateQueryOptions(p.id, date)),
  });

  // Points WITH a shift, paired with their point — a point that never opened
  // that day has nothing to ask about, and firing a reconciliation for an
  // undefined shift id would be a request for `/shifts/undefined/reweigh`.
  const withShift = useMemo(
    () =>
      points
        .map((point, i) => ({ point, shift: shifts[i]?.data ?? null }))
        .filter((x): x is { point: PointOption; shift: { id: string } } => x.shift !== null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `shifts` is a new array each render; its DATA is what matters
    [points, shifts.map((s) => s.data?.id).join('|')],
  );

  const reweighs = useQueries({
    queries: withShift.map((x) => reweighQueryOptions(x.shift.id, { includeVoided: true })),
  });

  const lines = useMemo(() => {
    const all: DayLine[] = [];
    withShift.forEach((x, i) => {
      for (const item of reweighs[i]?.data?.items ?? []) {
        all.push({ item, pointId: x.point.id, pointName: x.point.name });
      }
    });
    // Newest first ACROSS points: each shift's `items` is already newest-first
    // on its own, and concatenating them would order by point instead of by
    // clock — the table's whole claim is that it is the day, not five days.
    return all.sort((a, b) => b.item.created_at.localeCompare(a.item.created_at));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- same reason as above
  }, [withShift, reweighs.map((r) => r.dataUpdatedAt).join('|')]);

  return {
    lines,
    isPending: shifts.some((s) => s.isPending) || reweighs.some((r) => r.isPending),
  };
}
```

If the two `eslint-disable` lines draw a lint complaint under this repo's config, prefer restructuring over suppressing — check how `useNetworkToday.ts` solved the same "array of results changes identity every render" problem and copy that shape exactly.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w frontend -- useDayReweighs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/reweigh/api
git commit -m "$(cat <<'EOF'
feat(reweigh): assemble the day across every point

The mock's table says «по всіх пунктах» and this API answers per shift, so the
day is assembled here: one wave of queries for the shifts, a second for their
reconciliations, in the pattern useNetworkToday already set.

Ordering is across points, not within them. Each shift returns its own lines
newest-first, and concatenating those would order the table by point while
claiming to be a day.

~2×P requests is fine at five working points and is not fine at thirty; the
day-wide endpoint is written down as the follow-up this code makes way for.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: The weighing form — mock steps 1–3, чиста вага, «+ ще позиція»

**Files:**
- Create: `frontend/src/pages/reweigh/ui/FieldWarning.tsx`
- Create: `frontend/src/pages/reweigh/ui/WeighingForm.tsx`
- Create: `frontend/src/pages/reweigh/ui/DraftLines.tsx`
- Modify: `frontend/src/shared/lib/i18n/locales/uk.json`, `en.json`
- Test: `frontend/src/pages/reweigh/ui/WeighingForm.test.tsx`

**Interfaces:**
- Consumes: `Draft`, `tareWeightOf`, `netOf`, `newDraftKey` (Task 5); `addBlockReason`, `grossHint`, `tareHint` (Task 6); `ReconciliationGrade` (Task 3); `useTareTypeOptionsQuery` (`@/entities/tare-type`).
- Produces:
  ```ts
  export function FieldWarning({ text }: { text: string }): JSX.Element
  export function WeighingForm(props: {
    grades: ReconciliationGrade[];
    hasShift: boolean;
    acceptedAnything: boolean;
    pointName: string;
    date: string;
    onAdd: (draft: Draft) => void;
  }): JSX.Element
  export function DraftLines(props: {
    drafts: Draft[];
    onRemove: (key: string) => void;
  }): JSX.Element
  ```

**Markup source:** `.reference/yagoda-crm/src/pages/ReweighPage.tsx:431-583` (the three numbered blocks and the чиста вага footer) and `:586-640` (the draft strip). Keep the structure, the `Eyebrow` numbering («1 · Вага з ягодою і піддон», «2 · Кількість ящиків», «3 · Сорт»), the big `font-mono text-2xl` gross field with its «кг» suffix, the −/+ crate stepper with its `+5 / +10 / +20 ящ.` buttons, and the `text-[34px]` чиста вага readout.

**Kit substitutions** (the mock imports shadcn primitives this repo replaced):

| Mock | Use instead |
|---|---|
| `Input` | `TextInput` (`@/shared/ui/text-input`) |
| `Select`/`SelectTrigger`/`SelectItem`/`SelectGroup` | `SelectField` (`@/shared/ui/select-field`) with native `<optgroup>`/`<option>` |
| `Label` | `Field` (`@/shared/ui/field`) |
| `Button` | `@/shared/ui/button` (same API) |
| `Eyebrow` | `@/shared/ui/eyebrow` |
| `toast` from `sonner` | `toast` from `@/shared/ui/toast` |

The grade `<select>` groups by `product_name` — one `<optgroup label={product_name}>` per product, in the order `grades[]` arrives (the server orders by product name, then grade).

- [ ] **Step 1: Write the failing test**

```tsx
const GRADES = [
  { product_grade_id: 'g1', product_grade_name: 'Малина 1', product_id: 'p1', product_name: 'Малина', intake_net_kg: '200.00', reweigh_net_kg: '0.00' },
  { product_grade_id: 'g2', product_grade_name: 'Малина 3', product_id: 'p1', product_name: 'Малина', intake_net_kg: '100.00', reweigh_net_kg: '0.00' },
];

const base = {
  grades: GRADES, hasShift: true, acceptedAnything: true,
  pointName: 'Шипинки', date: '2026-09-21', onAdd: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  tareMock.mockReturnValue({
    data: [{ id: 't1', name: 'Ящик', weight_kg: '1.20' }],
    isPending: false,
  });
});

describe('WeighingForm', () => {
  it('computes чиста вага as gross − pallet − tare, live', async () => {
    render(<WeighingForm {...base} />);
    await userEvent.type(screen.getByLabelText(/gross|вага з ягодою/i), '120.50');
    await userEvent.type(screen.getByLabelText(/pallet|піддон/i), '20');
    await userEvent.clear(screen.getByLabelText(/crates|кількість ящиків/i));
    await userEvent.type(screen.getByLabelText(/crates|кількість ящиків/i), '10');

    // 120.50 − 20.00 − (10 × 1.20) = 88.50
    expect(screen.getByTestId('net-kg')).toHaveTextContent('88.50');
  });

  it('groups the picker by product and offers only the day's grades', () => {
    render(<WeighingForm {...base} />);
    const group = screen.getByRole('group', { name: 'Малина' });
    expect(within(group).getAllByRole('option').map((o) => o.textContent))
      .toEqual(['Малина 1', 'Малина 3']);
  });

  it('keeps «+ ще позиція» inactive and says why, in order', async () => {
    render(<WeighingForm {...base} acceptedAnything={false} />);
    expect(screen.getByRole('button', { name: /another position|ще позиція/i })).toBeDisabled();
    expect(screen.getByText(/nothing was accepted|нічого не приймали/i)).toBeInTheDocument();
  });

  it('warns above the season record without blocking', async () => {
    render(<WeighingForm {...base} />);
    await userEvent.type(screen.getByLabelText(/gross|вага з ягодою/i), '900');
    expect(screen.getByText(/801|800|check the weight|перевірте вагу/i)).toBeInTheDocument();
    // a warning, never a block: with a grade chosen the button still works
  });

  it('hands up a complete draft and clears itself', async () => {
    const onAdd = vi.fn();
    render(<WeighingForm {...base} onAdd={onAdd} />);
    await userEvent.type(screen.getByLabelText(/gross|вага з ягодою/i), '120.50');
    await userEvent.selectOptions(screen.getByLabelText(/grade|сорт/i), 'g1');
    await userEvent.click(screen.getByRole('button', { name: /another position|ще позиція/i }));

    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({
      product_grade_id: 'g1',
      product_grade_name: 'Малина 1',
      product_id: 'p1',
      gross_kg: '120.50',
      pallet_kg: '0.00',
      net_kg: '120.50',
    }));
    expect(screen.getByLabelText(/gross|вага з ягодою/i)).toHaveValue('');
  });

  it('never sends a computed tare weight as if it were typed', async () => {
    // tare_weight_kg is on the draft for DISPLAY; the POST body (Task 10) omits it.
    const onAdd = vi.fn();
    render(<WeighingForm {...base} onAdd={onAdd} />);
    await userEvent.type(screen.getByLabelText(/gross|вага з ягодою/i), '50');
    await userEvent.selectOptions(screen.getByLabelText(/grade|сорт/i), 'g1');
    await userEvent.click(screen.getByRole('button', { name: /another position|ще позиція/i }));
    expect(onAdd.mock.calls[0][0].tare).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w frontend -- WeighingForm`
Expected: FAIL — module not found.

- [ ] **Step 3: Add the copy**

In `uk.json`, add a `reweigh` block (and the English mirror in `en.json`). The Ukrainian is the mock's, verbatim where a decision did not change it:

```json
"reweigh": {
  "title": "Переважування",
  "eyebrow": "Керівництву · робота на вагах",
  "description": "Ягода приїхала з пункту на базу: переважуємо і бачимо недостачу до того, як машину розвантажили. Аркуш звідси не друкується — це екран біля ваг, а не папір.",
  "berryDayNote": "Дата тут — це день <1>ягоди</1>, а не день заїзду машини: партія за {{date}}, переважена наступного ранку, усе одно належить {{date}}. Перемикач дати локальний — на пунктах робочий день від нього не зсувається.",
  "fromPoint": "з пункту",
  "berryOn": "ягода за",
  "step1": "1 · Вага з ягодою і піддон",
  "step2": "2 · Кількість ящиків",
  "step3": "3 · Сорт",
  "gross": "Вага з ягодою",
  "pallet": "Піддон",
  "crateCount": "Кількість ящиків",
  "grade": "Сорт",
  "gradePlaceholder": "Оберіть сорт",
  "gradeEmpty": "Того дня тут нічого не приймали",
  "gradeNote": "У списку — лише сорти товарів, які того дня приймали на {{point}}: {{products}}. Сорт зберігається, але звіряємо по товару: пересортиця в дорозі — не втрата.",
  "netEyebrow": "Чиста вага · рахує система",
  "netNote": "Вага з ягодою − піддон − тара. Полем вводу вона не є нікому.",
  "addLine": "ще позиція",
  "block": {
    "noShift": "Зміну за цей день на цьому пункті не відкривали",
    "nothingAccepted": "На {{point}} {{date}} нічого не приймали. Перевірте пункт і дату",
    "noGrade": "Оберіть сорт — без нього позиція в документ не піде",
    "noGross": "Введіть вагу з ягодою",
    "noNet": "Чиста вага виходить нульова: піддон і тара зʼїдають усю вагу з ягодою"
  },
  "warn": {
    "gross": "{{value}} — понад {{limit}} кг. Найважчий рядок сезону — 701,5 кг. Перевірте вагу.",
    "tareTooMany": "{{units}} ящиків — понад {{limit}}. Найбільший рядок сезону — 115. Перевірте кількість.",
    "tareNone": "Тару не додано — вага з ягодою пішла б у чисту вагу цілком."
  },
  "drafts": {
    "title": "Введені позиції",
    "hint": "(у памʼяті сторінки — документа ще немає)",
    "empty": "Позицій ще немає. Перезавантаження сторінки їх не збереже — документа поки не існує, і напівдокументів у базі теж.",
    "total": "Разом наша вага",
    "remove": "Прибрати позицію"
  }
}
```

Keep adding to this block in Tasks 10–12 rather than opening a second one.

- [ ] **Step 4: Implement the components**

`FieldWarning.tsx` — the mock's `:871-878`, using `AlertTriangle` from `lucide-react` and the repo's amber token.

`WeighingForm.tsx` — local `useState` for `gross`, `pallet`, `tareId`, `tareCount`, `gradeId` (five fields, no `react-hook-form`: this is `LoginForm`'s reasoning, and the values are decimal strings the page never schema-validates). Derive, never store:

```ts
  const weightById = useMemo(
    () => new Map((tareTypes.data ?? []).map((t) => [t.id, t.weight_kg])),
    [tareTypes.data],
  );
  const tare = tareCount > 0 && tareId ? [{ tare_type_id: tareId, units: tareCount }] : [];
  const tareWeight = tareWeightOf(tare, weightById);
  const net = netOf(gross || '0.00', pallet || '0.00', tareWeight);
  const block = addBlockReason({ hasShift, acceptedAnything, gradeId, grossKg: gross || '0.00', netKg: net });
```

The чиста вага readout carries `data-testid="net-kg"` and prints `formatKg(net, i18n.language)`, clamped at zero for DISPLAY only (`cmp(net,'0.00') < 0 ? '0.00' : net`) — the mock does the same with `Math.max(0, …)`, and `addBlockReason` is what actually stops a negative line.

The two decimal inputs accept only what the backend's `WEIGHT` regex accepts. Use `DECIMAL_INPUT` from `@/shared/lib/money` (the repo's existing input mask) and `normalizeAmount` on blur; do **not** port the mock's `maskDecimalInput`, which is a second mask for the same job.

`onAdd` builds the `Draft` with `newDraftKey()`, the chosen grade's four identity fields copied off `grades`, `pallet_kg: pallet || '0.00'`, and the derived `tare_weight_kg`/`net_kg`; then clears gross, pallet, count and grade, and **keeps `tareId`** — the crate type does not change between pallets.

`DraftLines.tsx` — the mock's `:586-640` list: grade name, `N брутто`, `N × Ящик`, `піддон N`, the net on the right, a `Trash2` remove button with `aria-label` from `reweigh.drafts.remove`, and a «Разом наша вага» footer summing with `sum(drafts.map(d => d.net_kg))`. The empty state is `reweigh.drafts.empty`, verbatim.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -w frontend -- WeighingForm`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/reweigh/ui frontend/src/shared/lib/i18n/locales
git commit -m "$(cat <<'EOF'
feat(reweigh): the form at the scale, in the client's own field order

Вага з ягодою → піддон → кількість ящиків → сорт → «ще позиція» → стрічка,
verbatim from S-13. Чиста вага is derived and has no input anywhere, for
anyone — the readout is clamped at zero for display only, while the ladder is
what actually refuses a line the pallet and tare eat whole.

The picker is built from the server's grades[], so it offers exactly the set
the API will accept, grouped by product: the reconciliation is by TOVAR, and
a grade that wandered in transit is not a loss.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: «Звірка з пунктом»

**Files:**
- Create: `frontend/src/pages/reweigh/ui/Reconciliation.tsx`
- Modify: `frontend/src/shared/lib/i18n/locales/{uk,en}.json`
- Test: `frontend/src/pages/reweigh/ui/Reconciliation.test.tsx`

**Interfaces:**
- Consumes: `ReconciliationProduct` (Task 3); `Draft` (Task 5); `sum`, `cmp`, `formatKg`, `formatUah`, `isNegative` (`@/shared/lib/money`).
- Produces:
  ```ts
  export function Reconciliation(props: {
    products: ReconciliationProduct[];
    drafts: Draft[];
    shiftClosed: boolean;
    acceptedAnything: boolean;
    pointName: string;
  }): JSX.Element
  ```

**The rule this component exists to hold (spec §3.7):** every cell is the server's. Drafts never enter a column; they are reported on one line beneath the table.

**Markup source:** `.reference/yagoda-crm/src/pages/ReweighPage.tsx:645-736`, with `Table` from `@/shared/ui/table`.

- [ ] **Step 1: Write the failing test**

```tsx
const weighed = (over = {}) => ({
  product_id: 'p1', product_name: 'Малина',
  intake_net_kg: '341.00', reweigh_net_kg: '338.50',
  state: 'weighed' as const, missing_kg: '2.50', missing_amount: '175.00',
  ...over,
});

describe('Reconciliation', () => {
  it('shows the point, ours, the difference and the money when the shift is closed', () => {
    render(<Reconciliation products={[weighed()]} drafts={[]} shiftClosed acceptedAnything pointName="Шипинки" />);
    const row = screen.getByRole('row', { name: /Малина/ });
    expect(within(row).getByText('341.00 kg')).toBeInTheDocument();
    expect(within(row).getByText('338.50 kg')).toBeInTheDocument();
    expect(within(row).getByText(/2\.50/)).toBeInTheDocument();
  });

  it('holds the claim back while the shift is open — a dash, and it says why', () => {
    render(
      <Reconciliation
        products={[weighed({ missing_kg: null, missing_amount: null })]}
        drafts={[]} shiftClosed={false} acceptedAnything pointName="Шипинки"
      />,
    );
    const row = screen.getByRole('row', { name: /Малина/ });
    expect(within(row).getAllByText('—')).toHaveLength(2);
    expect(screen.getByText(/still open|ще відкрита/i)).toBeInTheDocument();
  });

  it('renders «не перезважено» as a state and NEVER as a zero', () => {
    render(
      <Reconciliation
        products={[weighed({ state: 'not_reweighed', reweigh_net_kg: '0.00', missing_kg: null, missing_amount: null })]}
        drafts={[]} shiftClosed acceptedAnything pointName="Шипинки"
      />,
    );
    const row = screen.getByRole('row', { name: /Малина/ });
    expect(within(row).getByText(/not reweighed|не перезважено/i)).toBeInTheDocument();
    expect(within(row).queryByText('0.00 kg')).not.toBeInTheDocument();
  });

  it('counts the products still without a line', () => {
    render(
      <Reconciliation
        products={[weighed(), weighed({ product_id: 'p2', product_name: 'Порічка', state: 'not_reweighed', missing_kg: null, missing_amount: null })]}
        drafts={[]} shiftClosed acceptedAnything pointName="Шипинки"
      />,
    );
    expect(screen.getByText(/1/)).toBeInTheDocument();
    expect(screen.getByText(/without a line|без позиції/i)).toBeInTheDocument();
  });

  it('reports unposted drafts on their own line and leaves «Наша» untouched', () => {
    render(
      <Reconciliation
        products={[weighed()]}
        drafts={[{ key: 'k', product_grade_id: 'g', product_grade_name: 'Малина 1', product_id: 'p1', product_name: 'Малина', gross_kg: '12.00', pallet_kg: '0.00', tare: [], tare_weight_kg: '0.00', net_kg: '12.00' }]}
        shiftClosed acceptedAnything pointName="Шипинки"
      />,
    );
    const row = screen.getByRole('row', { name: /Малина/ });
    expect(within(row).getByText('338.50 kg')).toBeInTheDocument();   // NOT 350.50
    expect(screen.getByText(/12\.00/)).toBeInTheDocument();
    expect(screen.getByText(/not recorded yet|не проведено/i)).toBeInTheDocument();
  });

  it('says there is nothing to compare when the day accepted nothing', () => {
    render(<Reconciliation products={[]} drafts={[]} shiftClosed acceptedAnything={false} pointName="Шипинки" />);
    expect(screen.getByText(/nothing to compare|порівнювати ні з чим/i)).toBeInTheDocument();
  });

  it('shows a surplus as a surplus, not as a negative shortfall', () => {
    render(
      <Reconciliation
        products={[weighed({ missing_kg: '-4.00', missing_amount: '-280.00' })]}
        drafts={[]} shiftClosed acceptedAnything pointName="Шипинки"
      />,
    );
    expect(screen.getByText(/surplus|надлишок/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w frontend -- Reconciliation`
Expected: FAIL — module not found.

- [ ] **Step 3: Add the copy**

Extend the `reweigh` block:

```json
  "check": {
    "title": "Звірка з пунктом",
    "byProduct": "по товару, не по сорту",
    "product": "Товар",
    "point": "Пункт",
    "ours": "Наша",
    "diff": "Різниця",
    "money": "У грошах",
    "notReweighed": "не перезважено ⚠",
    "nothingAccepted": "Того дня на {{point}} нічого не приймали — порівнювати ні з чим.",
    "shortfallTotal": "Недостача разом",
    "surplusTotal": "Надлишок разом",
    "shiftOpen": "Зміна ще відкрита — недостача порахується після закриття зміни.",
    "notWeighed": "Товарів без позиції: {{count}}. Це захист від «забули зважити порічку», а не помилка — але поки ⚠ стоїть, недостача по цьому товару не рахується взагалі.",
    "drafted": "Незаписані позиції: +{{kg}} — їх ще не проведено, і в «Нашій» їх немає.",
    "note": "«Наша» — це проведені позиції цього дня по цьому пункту, рівно те, що побачить зведення дня. Гроші — недостача × те, що за ці кілограми справді нарахували; чека постачальника вони не торкаються."
  },
```

Note two edits from the mock's wording, both forced by a decision:
- `notWeighed` ends «не рахується взагалі» where the mock says «рахується на всю вагу пункту» — §3.15 makes `missing_kg` null for that product, so it enters no total.
- `note` drops «середня ставка пункту» for «те, що за ці кілограми справді нарахували» — §3.6 prices the shortfall at what was actually accrued, bonuses included.

- [ ] **Step 4: Implement**

Totals: sum only the products whose `missing_kg` is non-null.

```ts
  const priced = products.filter((p) => p.missing_kg !== null);
  const totalKg = priced.length ? sum(priced.map((p) => p.missing_kg as string)) : null;
  const totalUah = priced.length ? sum(priced.map((p) => p.missing_amount as string)) : null;
  const surplus = totalKg !== null && isNegative(totalKg);
  const notWeighed = products.filter((p) => p.state === 'not_reweighed').length;
  const draftedKg = drafts.length ? sum(drafts.map((d) => d.net_kg)) : null;
```

A `missing_kg` of `null` renders `—` in both right-hand columns. `state === 'not_reweighed'` renders `check.notReweighed` in «Наша» and tints the row amber. The totals row prints `check.surplusTotal` or `check.shortfallTotal` by sign, with the absolute value (`surplus ? sub('0.00', totalKg) : totalKg`) — a surplus is shown as a surplus, never as a minus in front of a shortfall label. When `totalKg` is null the row prints `—` and, if the shift is open, `check.shiftOpen` below it.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -w frontend -- Reconciliation`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/reweigh/ui/Reconciliation.tsx frontend/src/shared/lib/i18n/locales
git commit -m "$(cat <<'EOF'
feat(reweigh): the звірка, every cell of it the server's

The mock folds unposted drafts into «Наша» and computes «Різниця» from that
sum. Here «Різниця» comes from the server, so folding drafts in would leave
one column half-server and half-browser, sitting next to a money claim. The
drafts get their own line beneath the table instead: the owner sees both
quantities and neither is mixed into the other.

Three states stay apart, as the service keeps them apart: a real difference,
«не перезважено» (a state, never a zero), and «the shift is still open» — all
three print a dash, and only the first is ever a number.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: The day table and the inline storno

**Files:**
- Create: `frontend/src/pages/reweigh/ui/DayLines.tsx`
- Modify: `frontend/src/shared/lib/i18n/locales/{uk,en}.json`
- Test: `frontend/src/pages/reweigh/ui/DayLines.test.tsx`

**Interfaces:**
- Consumes: `DayLine` (Task 8); `useVoidReweighItemMutation` (Task 4); `useStaffQuery` (Task 7); `apiErrorToBanner` (`@/shared/lib/api-error`); `formatTime` (`@/shared/lib/date`).
- Produces:
  ```ts
  export function DayLines(props: { lines: DayLine[]; isPending: boolean; date: string }): JSX.Element
  ```

**Markup source:** `.reference/yagoda-crm/src/pages/ReweighPage.tsx:757-866`, including the inline reason row (`:810-849`) — a second `<TableRow>` under the one being voided, not a dialog.

- [ ] **Step 1: Write the failing test**

```tsx
const line = (over = {}) => ({
  pointId: 'p1', pointName: 'Шипинки',
  item: {
    id: 'ri1', reweigh_id: 'rw1', item_order: 1,
    product_grade_id: 'g1', product_grade_name: 'Малина 1', product_id: 'pr1', product_name: 'Малина',
    gross_kg: '120.50', pallet_kg: '0.00', tare_weight_kg: '12.00', net_kg: '108.50',
    tare: [{ tare_type_id: 't1', tare_type_name: 'Ящик', units: 10 }],
    weighed_by_user_id: 'u1',
    voided_at: null, voided_by_user_id: null, void_reason: null,
    created_at: '2026-09-21T10:00:00.000Z',
    ...over,
  },
});

describe('DayLines', () => {
  it('lists a line with its point, time and net weight', () => {
    render(<DayLines lines={[line()]} isPending={false} date="2026-09-21" />);
    const row = screen.getByRole('row', { name: /Шипинки/ });
    expect(within(row).getByText('108.50 kg')).toBeInTheDocument();
  });

  it('asks for a reason and keeps the button inactive until one is typed', async () => {
    render(<DayLines lines={[line()]} isPending={false} date="2026-09-21" />);
    await userEvent.click(screen.getByRole('button', { name: /void|сторнувати/i }));

    const confirm = screen.getAllByRole('button', { name: /void|сторнувати/i }).at(-1)!;
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/reason|причина/i), 'двічі ввели ту саму машину');
    expect(confirm).toBeEnabled();
  });

  it('voids by LINE id with the typed reason', async () => {
    render(<DayLines lines={[line()]} isPending={false} date="2026-09-21" />);
    await userEvent.click(screen.getByRole('button', { name: /void|сторнувати/i }));
    await userEvent.type(screen.getByLabelText(/reason|причина/i), 'двічі ввели ту саму машину');
    await userEvent.click(screen.getAllByRole('button', { name: /void|сторнувати/i }).at(-1)!);

    expect(voidMock).toHaveBeenCalledWith({ id: 'ri1', reason: 'двічі ввели ту саму машину' });
  });

  it('keeps a voided line on screen with its time, author and reason', () => {
    staffMock.mockReturnValue({ data: new Map([['u9', 'Керівник']]) });
    render(
      <DayLines
        lines={[line({ voided_at: '2026-09-21T12:00:00.000Z', voided_by_user_id: 'u9', void_reason: 'двічі ввели' })]}
        isPending={false} date="2026-09-21"
      />,
    );
    const row = screen.getByRole('row', { name: /Шипинки/ });
    expect(within(row).getByText(/voided|сторновано/i)).toBeInTheDocument();
    expect(within(row).getByText(/Керівник/)).toBeInTheDocument();
    expect(within(row).getByText(/двічі ввели/)).toBeInTheDocument();
  });

  it('offers no storno on an already-voided line', () => {
    render(
      <DayLines lines={[line({ voided_at: '2026-09-21T12:00:00.000Z', voided_by_user_id: 'u9', void_reason: 'x' })]} isPending={false} date="2026-09-21" />,
    );
    expect(screen.queryByRole('button', { name: /void|сторнувати/i })).not.toBeInTheDocument();
  });

  it('says nothing happened that day rather than showing an empty frame', () => {
    render(<DayLines lines={[]} isPending={false} date="2026-09-21" />);
    expect(screen.getByText(/no reweighing|переважувань ще немає/i)).toBeInTheDocument();
  });

  it('surfaces the server's own refusal', async () => {
    voidMock.mockRejectedValue(new ApiError(409, 'Already voided', undefined, 'ALREADY_VOIDED'));
    render(<DayLines lines={[line()]} isPending={false} date="2026-09-21" />);
    await userEvent.click(screen.getByRole('button', { name: /void|сторнувати/i }));
    await userEvent.type(screen.getByLabelText(/reason|причина/i), 'x');
    await userEvent.click(screen.getAllByRole('button', { name: /void|сторнувати/i }).at(-1)!);

    await waitFor(() => expect(screen.getByText(/already voided|вже сторновано/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w frontend -- DayLines`
Expected: FAIL — module not found.

- [ ] **Step 3: Add the copy**

```json
  "day": {
    "title": "Проведені переважування за {{date}}",
    "allPoints": "по всіх пунктах",
    "point": "З пункту",
    "time": "Час",
    "what": "Товар",
    "ours": "Наша вага",
    "status": "Статус",
    "posted": "проведено",
    "voided": "сторновано",
    "void": "Сторнувати",
    "cancel": "Скасувати",
    "reason": "Причина — обовʼязкова",
    "reasonPlaceholder": "напр. двічі ввели ту саму машину",
    "empty": "За цей день переважувань ще немає.",
    "note": "Сторноване не рахується, але й не пропадає: позиція лишається в списку з часом, автором і причиною. Сторно перераховує зведення дня — «Собівартість дня» покаже це попередженням, а не мовчки.",
    "errors": {
      "failed": "Позицію не сторновано"
    }
  },
```

`ALREADY_VOIDED` already maps to `void.errors.alreadyVoided` in `apiErrorToBanner` — reuse it, do not add a second wording for the same code. Pass `reweigh.day.errors.failed` as the fallback key.

- [ ] **Step 4: Implement**

One `React.Fragment` per line, exactly as the mock: the data row, then the reason row when `voidingId === item.id`. Local state: `voidingId`, `reason`, `banner`. `onSuccess` clears all three; `onError` sets `banner` from `apiErrorToBanner(error, 'reweigh.day.errors.failed')`.

The mock's three-reason refusal toast (`:301-303`) does not apply here: this backend's void refuses for exactly one reason the screen can reach (`ALREADY_VOIDED`), and owner-only is a route gate. Print what the server said, and nothing it did not.

A voided line prints `formatTime(voided_at)`, `staff.get(voided_by_user_id) ?? ''` and the reason in quotes, with the row dimmed (`text-muted-foreground`). `useStaffQuery(true)` — this screen is owner-only, so the reader is always allowed to ask.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -w frontend -- DayLines`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/reweigh/ui/DayLines.tsx frontend/src/shared/lib/i18n/locales
git commit -m "$(cat <<'EOF'
feat(reweigh): the day's lines, and the storno that leaves a trace

Lines, not documents: this backend voids a weighing at a time, so the table
that carries the storno button is a table of lines. The reason row is inline,
as the mock has it, because the button it belongs to is already in the row.

A voided line stays on screen with its time, author and reason — which is what
?include_voided bought, and the whole point of «документ НЕ зникає».

The mock's refusal toast listed three reasons; this one prints what the server
actually said. Owner-only is a route gate here, and ALREADY_VOIDED is the one
refusal the screen can reach — a list of rules the backend does not apply is a
sentence that lies the first time someone reads it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Compose the page, wire the route, post the drafts

**Files:**
- Create: `frontend/src/pages/reweigh/ui/ReweighPage.tsx`
- Create: `frontend/src/pages/reweigh/index.ts`
- Modify: `frontend/src/app/router.tsx`
- Modify: `frontend/src/app/layouts/AppLayout.tsx`
- Modify: `frontend/src/shared/lib/i18n/locales/{uk,en}.json`
- Test: `frontend/src/pages/reweigh/ui/ReweighPage.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 3–11; `useWorkingPoint` (`@/features/point-scope`); `usePointOptionsQuery`; `useShiftOnDateQuery`; `useUrlParam`; the `date` helpers.
- Produces: `export function ReweighPage(): JSX.Element` and the `/reweigh` route.

**Header:** `pages/day/ui/DayPage.tsx:60-75` and `:201-210` are the template — `useUrlParam('date')`, the same clamp (`isRealIsoDate(dateParam) && dateParam <= today ? dateParam : today`), `DateStepper` with `canNext={date < today}`, and `useWorkingPoint()` for `?point=`. The point `SelectField` lists `points.filter(p => p.kind === 'reception')`.

- [ ] **Step 1: Write the failing test**

```tsx
describe('ReweighPage', () => {
  it('says the shift was never opened, and offers no form', () => {
    shiftMock.mockReturnValue({ data: null, isPending: false });
    render(<ReweighPage />);
    expect(screen.getByText(/never opened|не відкривали/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /another position|ще позиція/i })).toBeDisabled();
  });

  it('posts each draft as its own line, in the order they were entered', async () => {
    render(<ReweighPage />);
    await addDraft({ gross: '100', grade: 'g1' });
    await addDraft({ gross: '50', grade: 'g2' });
    await userEvent.click(screen.getByRole('button', { name: /post|провести/i }));

    await waitFor(() => expect(addMock).toHaveBeenCalledTimes(2));
    expect(addMock.mock.calls[0][0]).toMatchObject({ shiftId: 's1', gross_kg: '100.00', product_grade_id: 'g1' });
    expect(addMock.mock.calls[1][0]).toMatchObject({ shiftId: 's1', gross_kg: '50.00', product_grade_id: 'g2' });
  });

  it('never sends a net or tare weight it computed itself', async () => {
    render(<ReweighPage />);
    await addDraft({ gross: '100', grade: 'g1', crates: 10 });
    await userEvent.click(screen.getByRole('button', { name: /post|провести/i }));

    await waitFor(() => expect(addMock).toHaveBeenCalled());
    expect(addMock.mock.calls[0][0]).not.toHaveProperty('net_kg');
    expect(addMock.mock.calls[0][0]).not.toHaveProperty('tare_weight_kg');
    expect(addMock.mock.calls[0][0].tare).toEqual([{ tare_type_id: 't1', units: 10 }]);
  });

  it('stops at the first refusal and keeps every unposted line on screen', async () => {
    addMock
      .mockResolvedValueOnce({ id: 'ri1' })
      .mockRejectedValueOnce(new ApiError(400, 'no', undefined, 'NET_NOT_POSITIVE'));
    render(<ReweighPage />);
    await addDraft({ gross: '100', grade: 'g1' });
    await addDraft({ gross: '50', grade: 'g2' });
    await addDraft({ gross: '25', grade: 'g1' });
    await userEvent.click(screen.getByRole('button', { name: /post|провести/i }));

    await waitFor(() => expect(addMock).toHaveBeenCalledTimes(2));
    // the posted one is gone, the refused one and the one behind it remain
    expect(screen.getAllByRole('listitem')).toHaveLength(2 + 1); // 2 drafts + the total row
  });

  it('clears the drafts when the point changes — they belonged to another day', async () => {
    render(<ReweighPage />);
    await addDraft({ gross: '100', grade: 'g1' });
    await userEvent.selectOptions(screen.getByLabelText(/point|пункт/i), 'p2');
    expect(screen.getByText(/no positions yet|позицій ще немає/i)).toBeInTheDocument();
  });

  it('keeps the date out of everyone else's working day', async () => {
    render(<ReweighPage />);
    await userEvent.click(screen.getByRole('button', { name: /previous day|попередній день/i }));
    expect(setPointMock).not.toHaveBeenCalled();
    // the date moved in the URL only
    expect(setDateMock).toHaveBeenCalledWith('2026-09-20');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w frontend -- ReweighPage`
Expected: FAIL — module not found.

- [ ] **Step 3: Add the remaining copy**

```json
  "post": "Провести переважування · {{kg}}",
  "postNote": "Позиції пишуться по одній: якщо сервер відмовить на третій, перші дві вже записані, а решта лишиться на екрані.",
  "noShift": "Зміну за {{date}} на {{point}} не відкривали — переважувати нема до чого.",
  "posted": "Переважування проведено · {{kg}}",
  "postFailed": "Позицію «{{grade}}» не проведено",
  "draftsCleared": "Позиції очищено — вони належали іншому дню або пункту",
```

- [ ] **Step 4: Implement**

Posting, the one piece of real logic in this file:

```ts
  /**
   * §3.1 — the drafts are posted ONE LINE AT A TIME, because that is what this
   * API writes. Sequential, not `Promise.all`: `item_order` is allocated under
   * a lock on the header row, so parallel lines would queue on each other
   * anyway, and a failure in the middle of a parallel batch leaves an order
   * nobody can reconstruct from the screen.
   *
   * STOPS AT THE FIRST REFUSAL, and the survivors stay. The alternative —
   * carrying on and reporting a list of failures — leaves the owner holding a
   * screen whose contents no longer match either the server or what they typed.
   */
  async function post() {
    if (!shiftId || drafts.length === 0) return;
    const remaining = [...drafts];
    while (remaining.length > 0) {
      const draft = remaining[0];
      try {
        await addLine.mutateAsync({
          shiftId,
          product_grade_id: draft.product_grade_id,
          gross_kg: draft.gross_kg,
          ...(cmp(draft.pallet_kg, '0.00') > 0 ? { pallet_kg: draft.pallet_kg } : {}),
          tare: draft.tare,
        });
      } catch (error) {
        setDrafts(remaining);
        toast.error(t('reweigh.postFailed', { grade: draft.product_grade_name }), {
          description: t(apiErrorToBanner(error, 'reweigh.day.errors.failed')),
        });
        return;
      }
      remaining.shift();
      setDrafts([...remaining]);
    }
    toast.success(t('reweigh.posted', { kg: formatKg(postedTotal, i18n.language) }));
  }
```

Clearing on context change — one effect keyed on `(date, pointId)`, with the mock's toast, and only when there is something to clear:

```ts
  const context = `${date}|${pointId ?? ''}`;
  const previous = useRef(context);
  useEffect(() => {
    if (previous.current === context) return;
    previous.current = context;
    setDrafts((current) => {
      if (current.length > 0) toast.info(t('reweigh.draftsCleared'));
      return [];
    });
  }, [context, t]);
```

Layout: `PageHeader` with `reweigh.eyebrow` / `reweigh.title` / `reweigh.description` and the point + date controls as `actions`; the «день ягоди» note; then the mock's two-column grid (`xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,1fr)]`) — `WeighingForm` + `DraftLines` on the left, `Reconciliation` + the post card on the right; `DayLines` beneath the grid at full width.

`pages/reweigh/index.ts`: `export { ReweighPage } from './ui/ReweighPage';`

`app/router.tsx` — import `ReweighPage` and add the route beside `/transfers`, copying that entry's guard nesting exactly:

```tsx
      {
        path: '/reweigh',
        element: (
          <RequireAuth>
            <RequireRole role="network_owner">
              <ReweighPage />
            </RequireRole>
          </RequireAuth>
        ),
      },
```

(Check `/transfers`'s actual `RequireRole` prop name and match it — do not guess.)

`app/layouts/AppLayout.tsx` — give the existing entry its destination:

```tsx
      { labelKey: 'nav.reweigh', icon: Weight, to: '/reweigh' },
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -w frontend -- ReweighPage`
Expected: PASS (6 tests).

- [ ] **Step 6: Check accessibility, as every page test in this repo does**

Add to the suite, following `CratesPage.test.tsx`'s import of `expectNoAxeViolations`:

```tsx
  it('has no accessibility violations', async () => {
    const { container } = render(<ReweighPage />);
    await expectNoAxeViolations(container);
  });
```

Run: `npm test -w frontend -- ReweighPage`
Expected: PASS (7 tests).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/reweigh frontend/src/app frontend/src/shared/lib/i18n/locales
git commit -m "$(cat <<'EOF'
feat(reweigh): the screen at /reweigh, owner-only at the route

Posting is sequential and stops at the first refusal, with the survivors left
on screen. Parallel lines would queue anyway — item_order is allocated under a
lock on the header row — and a failure inside a parallel batch leaves an order
nobody can reconstruct from what they are looking at.

The date is local to this screen: the owner works through yesterday while the
points are still buying today, and a global switch would move the working day
under the very people this screen is checking.

The nav item for this screen has existed without a destination since the shell
was built; it finally has one.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Gate the branch and write down what was deferred

**Files:**
- Modify: `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md`

- [ ] **Step 1: Run the full gate**

This branch changed money code (`reweigh-reconciliation.service.ts`) and a `.tsx` surface, so the fast tier cannot see what matters.

Run: `npm run verify:full`
Expected: every row `PASSED` or `SKIPPED`. If anything is `FAILED`, `NOT_RUN` or `UNRUNNABLE`, fix the cause — never widen a baseline, relax a rule, add a suppression or lower a floor to turn it green.

- [ ] **Step 2: Record the evidence**

Paste the runner's verdict line into the turn's report, name every `SKIPPED` row and why it skipped, and quote `coverage`'s own percentages if quoting coverage at all — never a floor.

- [ ] **Step 3: Write the follow-ups**

Append to `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md`, in the file's existing format:

```markdown
### Reweigh screen (2026-09-21)

- **`reweighs.at_point_id`** — the mock's «База» selector records WHERE a load was
  weighed. No column, nothing downstream reads one, so the selector was omitted rather
  than rendered as a control that looks recorded and is not. The contract if it is ever
  wanted: nullable FK to `collection_points`, set on the header, first line wins.
- **An atomic batch post** (`POST /shifts/:id/reweigh` with `lines[]`) — the screen posts
  N lines and stops at the first refusal, so a rejection in the middle leaves the earlier
  lines written. One transaction would make «Провести переважування» mean what the mock's
  button means.
- **A day-wide `GET /reweigh-items?date=`** — `pages/reweigh/api/useDayReweighs.ts` fans
  out ~2×P requests to build the «по всіх пунктах» table. Fine at five working points,
  not at thirty.
- **Operator read access to §8.2** (§3.10 of the reweigh slice spec) — whether the point
  may see the недостача claimed against it is a question the client has not answered.
- **Re-weighing a day at a since-deactivated point** — the picker lists active reception
  points only, so a past day at a closed point is unreachable from this screen.
- **§8.4 «Собівартість дня»** — `GET /shifts/:shiftId/cost-of-day` already serves it and
  no screen reads it.
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/2026-09-05-foundation-slice-follow-ups.md
git commit -m "$(cat <<'EOF'
docs: write down what the reweigh screen deliberately did not do

Six of them, each with the contract it would need, so the next person reads a
decision rather than guessing whether something was missed. The «База»
selector in particular was omitted on purpose: a control that looks recorded
and is not is worse than an absent one.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:** §3.1 → Tasks 4, 11, 12 · §3.2 → Task 12 · §3.3 → Tasks 6, 12 · §3.4 → Tasks 1, 9 · §3.5 → Tasks 12, 13 · §3.6 → Task 10 · §3.7 → Task 10 · §3.8 → Tasks 2, 11 · §3.9 → Task 8 · §3.10 → Task 5 · §3.11 → Task 12 · §3.12 → Tasks 12, 13 · §4 (structure) → Tasks 3–12 · §5 (data flow) → Tasks 3, 7, 8, 12 · §6.1 → Tasks 6, 12 · §6.2 → Task 6 · §6.3 → Tasks 6, 9 · §6.4 → Task 12 · §6.5 → Task 11 · §6.6 → Task 10 · §6.7 → Tasks 9–12 · §7 → Tasks 1, 2 · §8 → every task's test step · §9 → Task 13. No gap.

**Type consistency:** `Reweigh`/`ReweighItem`/`ReconciliationProduct`/`ReconciliationGrade` are defined once in Task 3 and consumed unchanged in Tasks 4, 8, 10, 11. `Draft`/`DraftTare` are defined in Task 5 and consumed in Tasks 9, 10, 12. `BlockReason`'s five codes match the five `reweigh.block.*` keys added in Task 9. `AddReweighItemInput`'s field names match the DTO (`product_grade_id`, `gross_kg`, `pallet_kg`, `tare[].tare_type_id`, `tare[].units`). `mul(value, by)` in Task 5 matches its only caller, `tareWeightOf`.

**Known soft spot:** Task 8's `useQueries` dependency arrays are written defensively with `eslint-disable` lines and the task says to prefer `useNetworkToday`'s shape over suppressing. If that file solved it differently, follow it and drop the suppressions.

---

### Task 14: Cut the screen's explanatory prose down to what a user acts on

> **ADDED 2026-09-21, after Tasks 1-13, at the user's request.** The screen carries
> the mock's full didactic copy — paragraphs explaining business-date semantics, why
> чиста вага has no input, what storno does to the day's summary. The instruction:
> remove the unnecessary hints, keep the warnings that matter to the workflow, and make
> sure a data-entry error still tells the user what they are doing wrong. Cut depth
> agreed as **moderate** (the user chose it from three options; conservative and
> aggressive were the alternatives).

**Files:**
- Modify: `frontend/src/shared/lib/i18n/locales/uk.json` and `en.json`
- Modify: `frontend/src/pages/reweigh/ui/ReweighPage.tsx` (`berryDayNote`)
- Modify: `frontend/src/pages/reweigh/ui/WeighingForm.tsx` (`netNote`, `gradeNote`, both warning texts)
- Modify: `frontend/src/pages/reweigh/ui/DraftLines.tsx` (`drafts.empty`)
- Modify: `frontend/src/pages/reweigh/ui/Reconciliation.tsx` (`check.note`)
- Modify: `frontend/src/pages/reweigh/ui/DayLines.tsx` (`day.note`)
- Tests: the corresponding `*.test.tsx` files, where they assert removed copy

**Interfaces:** no exported signature changes. This task changes rendered copy only.

#### What is CUT — both the render and the i18n key, in both locales

| Key | Why it goes |
|---|---|
| `berryDayNote` | a paragraph on business-date semantics above a header already labelled «ягода за» |
| `netNote` | «Полем вводу вона не є нікому» — the readout is visibly not an input |
| `gradeNote` | the picker already shows only that day's grades; the sentence explains a rule the control enforces |
| `check.note` | a footnote deriving «Наша» and the money column |
| `day.note` | a paragraph on what storno does to the day's summary |

`drafts.empty` is SHORTENED, not removed, to «Позицій ще немає.» (en: «No positions yet.»).

#### What is TRIMMED — the two suspicion warnings keep their teeth, lose their trivia

- `warn.gross`: → «{{value}} — перевірте вагу.» (en: «{{value}} — check the weight.»)
- `warn.tareTooMany`: → «{{units}} ящиків — перевірте кількість.» (en: «{{units}} crates — check the count.»)

Both **drop the `{{limit}}` interpolation and the season-record sentence**. Update the
call sites so no unused interpolation is passed. **`GROSS_SUSPECT_KG` and
`TARE_SUSPECT_UNITS` in `lib/hints.ts` do NOT change** — the thresholds are unchanged,
only the sentence is shorter. Do not touch `hints.ts` at all.

#### What STAYS, and must not be "tidied" while nearby

- All five `block.*` reasons. These ARE the "user understands what they are doing wrong"
  requirement; the ladder and its order are covered by `lib/hints.test.ts`.
- `warn.tareNone` — forgetting the tare silently inflates чиста вага. That is a data-entry
  error, not an explanation.
- `check.shiftOpen` — without it the «—» in Різниця is unexplained.
- `check.drafted` — tells the owner their unposted lines are not in «Наша».
- `check.notWeighed`, `check.notReweighed` — state markers.
- `postNote` — non-atomic posting is a consequence worth knowing BEFORE pressing the
  button, not only from the failure toast afterwards.
- Every toast, every field label, every table header.

#### Steps

- [ ] **Step 1: Find every render site and every test that asserts the removed copy**

Run: `grep -rn "berryDayNote\|netNote\|gradeNote\|check.note\|day.note\|drafts.empty\|warn.gross\|warn.tareTooMany" frontend/src`
Write the list into the report before changing anything. A key removed from the locales
while a `t()` call survives renders the RAW KEY on screen, and nothing in the fast tier
catches that — `typecheck` cannot see i18n keys.

- [ ] **Step 2: Update the tests first, and RUN them to see them fail**

A test that asserted a cut paragraph's presence is deleted with it. A test that used that
paragraph as an ANCHOR to reach something else must be re-anchored to a string that
survives — do not delete such a test, and say in the report which ones you re-anchored.

Run: `npm test -w frontend -- reweigh`
Expected: FAIL, naming the copy assertions you changed.

- [ ] **Step 3: Cut the renders, then the keys, in both locales**

Remove the render first, then the key from `uk.json` AND `en.json`. If removing
`berryDayNote` leaves the `<Trans>` import unused in `ReweighPage.tsx`, remove the import —
lint runs `--max-warnings=0` and will fail on it, which is the check working.

- [ ] **Step 4: Trim the two warnings and their call sites**

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -w frontend -- reweigh`
Expected: PASS.

- [ ] **Step 6: Prove no key was orphaned in either direction**

Two failure modes, and neither is caught by `typecheck`:
- a `t('reweigh.x')` whose key was deleted → renders `reweigh.x` on screen;
- a key left in `uk.json` but deleted from `en.json` (or vice versa) → renders the raw key
  in one language only, and the suite runs in English so the Ukrainian side is unwatched.

Assert both: grep the `reweigh.*` keys still referenced in `pages/reweigh` against the keys
present in each locale file, and paste the comparison into the report.

- [ ] **Step 7: Commit, then run the gate**

`npm run verify` after committing, so the HEAD matches. Paste the verdict line and name any
SKIPPED row.

---

### Task 15: Lazy-load the owner-only routes

> **ADDED 2026-09-21, after Task 13's gate came back red on `bundle`.** The branch
> exceeded the ceiling by 2.4 KiB gzip / 17.8 KiB raw — pure application code, zero new
> dependencies (`git diff main...HEAD -- frontend/package.json` is empty). The budget's
> own note permits a reasoned ceiling raise; the user chose the real fix instead:
> split the owner-only routes so an operator never downloads them.

**Why this is the better answer, not merely the more expensive one:** the app eagerly
imports every page today. An operator on a phone at a collection point downloads the
owner's management screens — reweigh, transfers, journal, users, points, catalog — and
opens none of them. Raising the ceiling would have recorded that as acceptable.

**Files:**
- Modify: `frontend/src/app/router.tsx` (the route definitions)
- Modify: `frontend/src/app/App.tsx` or the layout, wherever the `Suspense` boundary belongs
- Modify: `scripts/verify/baselines/bundle-budget.json` — **LOWERING only**, re-measured
- Test: existing route/page tests must keep passing; add one for the loading state

**This introduces the app's FIRST `React.lazy` boundary.** There is none today — verified
by grep. So this is a pattern change, and the pattern it sets will be copied.

#### Requirements

1. **Split the owner-only group**: `/reweigh`, `/transfers`, `/journal`, `/users`,
   `/points`, `/catalog`. Leave the operator's daily screens eager — `/`, `/reception`,
   `/day`, `/point-cash`, `/crates`, `/prices`, `/suppliers`, `/debts`. An operator must
   not pay a chunk request for a screen they use every shift.
2. **One `Suspense` boundary**, placed so a lazy route's fallback does not blank the app
   shell — the sidebar and top bar must stay rendered while a chunk loads. Read
   `AppLayout.tsx` and decide where; say in the report where you put it and why.
3. **The fallback must not be a bare spinner in an empty page.** This repo has
   `shared/ui/pending-slice.tsx` and `shared/ui/skeleton.tsx` — use what exists.
4. **Route guards still run before the chunk loads.** `RequireAuth` / `RequireRole` wrap
   the element; confirm an unauthorised user is redirected WITHOUT downloading the
   owner chunk. That is a real property worth a test: it is the difference between
   code-splitting and accidental authorisation-by-download.
5. **Re-measure and LOWER the budget.** After splitting, run `npm run build` and the
   `bundle` row, then set `maxGzipBytes`/`maxRawBytes` to the new measurement plus the
   file's own `minHeadroom*`, rounded up by `step*`. Update `measuredAt`,
   `measuredGzipBytes`, `measuredRawBytes`, `headroom*`. **Lowering is an ordinary
   edit** by the note's own words. If the measurement somehow comes out ABOVE today's
   ceiling, stop and report — do not raise it.

#### Steps

- [ ] **Step 1: Record the before-measurement**

Run `npm run build` then the `bundle` row. Paste the current gzip/raw totals and, if the
row prints per-chunk figures, the chunk list. You need the before to prove the after.

- [ ] **Step 2: Write the guard test first, and run it to see it fail**

A test that an operator hitting `/reweigh` is redirected by `RequireRole` without the
reweigh chunk being requested. Express it however the harness allows (a `vi.mock` on the
lazy factory asserting it was never called is the most direct).

- [ ] **Step 3: Convert the six routes and add the Suspense boundary**

- [ ] **Step 4: Run the full route and page suites**

Run: `npm test -w frontend`
Expected: PASS. A page test that rendered a route synchronously may now need `findBy*`
instead of `getBy*`; fix the test, do not un-split the route.

- [ ] **Step 5: Re-measure, lower the budget, prove the win**

Run: `npm run verify:full` (ALONE — this branch has seen `coverage` fail purely from CPU
contention, and two concurrent `tsc -b` runs race on `.tsbuildinfo` and surface as
`UNRUNNABLE`). Paste the `bundle` row's verdict and the new headroom it prints.

State in the report what an OPERATOR now downloads versus before — the sum is not the
number that matters, the first chunk is.

- [ ] **Step 6: Commit**

Two commits: the split, then the re-measured budget with its reasoning in the body.

> **OUTCOME, 2026-09-21 — Step 5's premise was wrong, and the row is green without a
> ceiling raise.** "Re-measure and LOWER the budget" assumed the `bundle` row gates what
> the operator downloads. It gates the SUM of `frontend/dist/assets`, and the sum GREW:
> splitting one chunk into two costs gzip, because two chunks compress worse than one.
> Measured after the split — first load 291,949 gzip / 1,007,840 raw (down 17,893 gzip),
> owner chunk 20,842 gzip, sum 312,791 gzip against a 312,320 ceiling. Red by 471 B, on
> the commit that made the download smaller. Requirement 5's escape hatch ("if the
> measurement somehow comes out ABOVE today's ceiling, stop and report") did not cover
> this, because the measurement that mattered came out BELOW and the one being gated came
> out above.
>
> Three options were put to the user — raise the ceiling per the file's own arithmetic
> (+30 KiB gzip), gate first load instead, or gate both. **The user chose to gate first
> load, ceiling untouched.** Done in `69ee4b5` (the check reads the first-load set from
> `dist/index.html` — entry script, stylesheets, and every modulepreload, so a split that
> hoists shared code into eagerly-preloaded chunks is still caught) and `b40e5c4` (the
> baseline re-records the measured quantity; `maxGzipBytes`/`maxRawBytes` are byte-for-byte
> unchanged). Three commits in the end, not two. `npm run verify:full`: 16 PASSED, 0
> SKIPPED.
>
> The standing consequence is in the follow-ups file: first-load headroom is now 19.9 KiB
> gzip / 75.8 KiB raw against designed minimums of 25.0 / 100.0, so the check warns on
> every green run and the next ordinary commit trips it.

---

### Task 16: Name the product, not only the grade, in the day table

> **ADDED 2026-09-21 at the user's request.** «Товар» in «Проведені переважування»
> renders `product_grade_name` alone (`DayLines.tsx:127`). Checked against the seed:
> grade names are «Вищий сорт», «1 сорт», «2 сорт», «3 сорт», «Стандарт», «Нестандарт»,
> «Дрібна» — they do NOT embed the product. **Eight products** (Суниця, Вишня, Порічка,
> Смородина, Ожина, Бузина, Шипшина, Аронія) each have a grade named exactly
> «Стандарт», so the column currently prints «Стандарт» for eight different berries and
> the owner cannot tell which was weighed.

**Files:**
- Modify: `frontend/src/pages/reweigh/ui/DayLines.tsx`
- Modify: `frontend/src/pages/reweigh/ui/DraftLines.tsx` (same defect — see below)
- Modify: `frontend/src/shared/lib/i18n/locales/uk.json`, `en.json`
- Test: `DayLines.test.tsx`, `DraftLines`' coverage in `WeighingForm.test.tsx`

#### Requirements

1. **Render «product — grade»**: «Малина — 1 сорт», «Порічка — Стандарт». Put the
   separator in an i18n key (`reweigh.productGrade`, `{{product}} — {{grade}}`) rather
   than hard-coding a dash, so a locale can order or punctuate it differently.
2. **Degrade honestly.** `product_name` and `product_grade_name` are BOTH optional on
   `ReweighItem` (they come from loaded relations). If the product is missing, render the
   grade alone; if the grade is missing, render the product alone; if both are missing,
   render what the current code renders. Do NOT print a dangling «— 1 сорт».
3. **`DraftLines.tsx:55` has the same defect** and is on the same screen — a draft line
   reading «Стандарт» is exactly as ambiguous. It is included deliberately; the user
   asked about "the table", and this is the same fix one element away. If it turns out
   the draft strip cannot reach `product_name`, report rather than inventing a lookup.
4. **`Reconciliation.tsx:133` must NOT change.** Its «Товар» column is product-level BY
   DESIGN — the звірка compares by product, not by grade, because a grade that shifted in
   transit is not a loss. Adding a grade there would contradict the column's whole point.

#### Steps

- [ ] **Step 1: Write the failing tests**

For `DayLines`: a row whose item carries product «Малина» and grade «1 сорт» renders
«Малина — 1 сорт». Plus the three degradation cases from requirement 2.
Run them; expected FAIL.

- [ ] **Step 2: Implement, in both components, via the shared i18n key**

- [ ] **Step 3: Run the tests**

Run: `npm test -w frontend -- DayLines WeighingForm`
Expected: PASS.

- [ ] **Step 4: Prove the ambiguity is gone**

Render two rows from DIFFERENT products that share the grade name «Стандарт» and assert
their «Товар» cells differ. Today that assertion fails; after the fix it passes. Paste
both runs — this is the finding in one test.

- [ ] **Step 5: Commit, then run `npm run verify`**

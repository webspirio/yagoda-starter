# UI Layout Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the domain-free layout primitives the page templates (tier 3) will compose — `DataTable`, `LedgerRow`, `SectionCard`, `StatGrid`, `DateStepper` — into `shared/ui`, each with a render + axe test.

**Architecture:** Tier-3-support portion of the frontend migration, stacked on the signature-components portion (#28). All primitives are presentational (props/slots, no store/api/domain imports), composing existing `shared/ui` (`table`, `card`, `button`, `eyebrow`). The `Segmented` control (SegmentedControl role) already exists in `shared/ui/segmented.tsx` and is **reused, not rebuilt**. `Meter` (dashboard bar-list) is deferred to the DashboardPage portion.

**Tech Stack:** React 19, Tailwind v4 (mock tokens), `cn` from `@/shared/lib/cn`, vitest + `@testing-library/react` + `vitest-axe`.

**Spec:** `docs/superpowers/specs/2026-09-08-yagoda-frontend-migration.md` (§5.3, §6)

## Tier → FSD mapping (approved 2026-09-08; recorded here pending umbrella-spec update)

| User's tier | FSD in starter |
|---|---|
| 1 Primitives (button, table…) | `shared/ui` |
| 2 Patterns (Eyebrow, StatTile, EmptyState…; **these primitives**) | `shared/ui` |
| 3 Page templates (ListPage/DocumentPage/DashboardPage) | `shared/ui/templates/` |
| 4 Domain blocks (cash/crates/reception…) | `entities/*` + `features/*` |
| pages | `pages/*` |

One-way import rule = FSD's ESLint-enforced `shared < entities < features < pages`; `shared/*` is domain-free by construction (no store/ports/calc/seed).

## Global Constraints
- **Domain-free:** these live in `shared/ui`; import only React, `cn`, and other `shared/ui`. ESLint forbids importing entities/features/pages.
- **Reuse over duplicate:** `Segmented` already exists — do not add a new SegmentedControl.
- **One component per file** + a co-located `*.test.tsx` (render + `expectNoAxeViolations`).
- **Verify:** `npm run lint`, `npm test`, `npm run build` (`--workspace=frontend`).
- **Delivery:** via `gh stack` — this branch is added with `gh stack add`, PR'd with `gh stack submit --auto`. No manual base-setting or force-push.

---

### Task 1: DataTable<Row>

**Files:** Create `frontend/src/shared/ui/data-table.tsx` + `data-table.test.tsx`

**Interfaces:**
- Produces: `Column<Row>` (`{id, header, cell, align?, className?, hideBelow?}`) and `DataTable<Row>({columns, rows, rowKey?, onRowClick?, empty?, className?})`.

- [ ] **Step 1: Write data-table.tsx** — thin generic wrapper over the shadcn table exports (`Table, TableHeader, TableBody, TableRow, TableHead, TableCell`). Map `columns` → `TableHead` (with `align`/`hideBelow`→responsive class), `rows` → `TableRow` (keyed by `rowKey ?? index`, `onRowClick` → click + `cursor-pointer`), each `column.cell(row,i)` → `TableCell`. When `rows` is empty and `empty` is given, render `empty` in a full-span cell. `hideBelow` maps to `{sm:'max-sm:hidden', md:'max-md:hidden', lg:'max-lg:hidden'}`; `align` to text-alignment; both applied to the `TableHead` and `TableCell` for that column.
- [ ] **Step 2: Write data-table.test.tsx** — render 2 columns × 2 rows, assert headers + a cell value present; assert `onRowClick` fires on row click (userEvent); assert the `empty` node shows when `rows=[]`; an `expectNoAxeViolations` case (table has header cells).
- [ ] **Step 3: Verify + commit** — `npm test --workspace=frontend -- data-table`; commit `feat(ui): DataTable — generic column-driven table over shadcn table`.

### Task 2: LedgerRow

**Files:** Create `frontend/src/shared/ui/ledger-row.tsx` + `ledger-row.test.tsx`

**Interfaces:** `LedgerRow({label, value, hint?, indent?, strong?, tone?, className?})`, `tone: 'default'|'amber'|'bad'|'leaf'`.

- [ ] **Step 1: Write ledger-row.tsx** — a `flex items-baseline justify-between gap-4` row: left = label (+ optional `hint` under/after in muted), right = value in `font-mono tabular-nums`; `indent` → `pl-4`; `strong` → `font-semibold` + heavier value; `tone` maps value color (`default`→foreground, `amber`→`text-[var(--amber)]`, `bad`→`text-destructive`, `leaf`→`text-[var(--leaf)]`).
- [ ] **Step 2: Write ledger-row.test.tsx** — renders label + value; `strong` adds the emphasis class; `tone="bad"` colors the value `text-destructive`; axe case.
- [ ] **Step 3: Verify + commit** — `feat(ui): LedgerRow — the label:value row (was duplicated 3× in the mock)`.

### Task 3: SectionCard

**Files:** Create `frontend/src/shared/ui/section-card.tsx` + `section-card.test.tsx`

**Interfaces:** `SectionCard({eyebrow?, title?, aside?, children, className, card?})` — `card` (default true) wraps in `rounded-xl bg-card p-5 ring-1 ring-foreground/10`.

- [ ] **Step 1: Write section-card.tsx** — header row (`flex items-center justify-between`) with left = optional `Eyebrow` (from `./eyebrow`) + optional `title` (font-medium), right = `aside`; then `children`. When `card` is false, render without the card shell (bare section).
- [ ] **Step 2: Write section-card.test.tsx** — renders eyebrow + title + aside + children; `card={false}` omits the `bg-card` shell; axe case.
- [ ] **Step 3: Verify + commit** — `feat(ui): SectionCard — titled card shell (Eyebrow header + aside)`.

### Task 4: StatGrid

**Files:** Create `frontend/src/shared/ui/stat-grid.tsx` + `stat-grid.test.tsx`

**Interfaces:** `StatGrid({columns?, children, className})` — responsive grid wrapping `StatTile` children. `columns` (2–5, default responsive `2 sm:3 lg:5`). Static column classes (never interpolate).

- [ ] **Step 1: Write stat-grid.tsx** — `grid gap-3` + a statically-mapped columns class (`{2:'grid-cols-2',3:'grid-cols-2 sm:grid-cols-3',4:'grid-cols-2 sm:grid-cols-4',5:'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5'}`), default the 5-map. (This is a LAYOUT grid of StatTiles — distinct from the starter's removed divider-Card StatGrid.)
- [ ] **Step 2: Write stat-grid.test.tsx** — renders children; maps `columns={3}` to the declared class; default applies the responsive 5 class; axe case (wrap two `StatTile`s).
- [ ] **Step 3: Verify + commit** — `feat(ui): StatGrid — responsive layout grid for StatTiles`.

### Task 5: DateStepper + full verification

**Files:** Create `frontend/src/shared/ui/date-stepper.tsx` + `date-stepper.test.tsx`

**Interfaces:** `DateStepper({label, onPrev, onNext, onToday?, canNext?, todayLabel?})` — DOMAIN-FREE: takes a pre-formatted `label` string and callbacks; the page owns all date math.

- [ ] **Step 1: Write date-stepper.tsx** — `‹` button (`onPrev`), the `label` (mono, `min-w` to avoid jitter), `›` button (`onNext`, disabled when `canNext === false`), and an optional "Сьогодні" (`todayLabel` default) button (`onToday`). Uses `lucide-react` chevrons + `shared/ui/button`. Buttons carry `aria-label` (prev/next) for a11y.
- [ ] **Step 2: Write date-stepper.test.tsx** — clicking prev/next/today fires the callbacks (userEvent); next is disabled when `canNext={false}`; axe case (buttons have accessible names).
- [ ] **Step 3: Full-portion verification** — `npm run lint --workspace=frontend`, `npm test --workspace=frontend`, `npm run build --workspace=frontend` (all pass).
- [ ] **Step 4: Commit** — `feat(ui): DateStepper — domain-free ‹ date › + today cluster`.

---

## Self-Review

**Spec coverage:** the tier-3 support primitives from the template proposal minus the reused `Segmented` and the deferred `Meter` (which ships with DashboardPage). DataTable/LedgerRow/SectionCard/StatGrid/DateStepper each map to a template need (ListPage table+stats, DocumentPage ledger, DashboardPage sections+stats, document/dashboard date nav).

**Placeholder scan:** interfaces + composition are concrete; component bodies are written at implementation from these specs (small, single-purpose files).

**Type consistency:** `Column<Row>` is defined in Task 1 and is the same shape the ListPage template's proposal consumes; `StatGrid` wraps `StatTile` (ported in the previous portion); `SectionCard` imports `Eyebrow` (previous portion).

**Note:** no screen consumes these yet (screens are later portions); starter runs no dead-file checker and ESLint doesn't flag unimported modules, so green CI is expected. They are the kit the templates consume next.

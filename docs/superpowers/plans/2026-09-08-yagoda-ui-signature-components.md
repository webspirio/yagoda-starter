# UI Signature Components (bits → shared/ui) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Port the mock's signature presentational components (`common/bits.tsx` + `Sparkline`) into the starter's `shared/ui`, one file per component (starter convention), so screen portions can build on them.

**Architecture:** Second portion of the frontend migration, stacked on the design-system foundation (theme + fonts already in place). Pure presentational components: props in, no store, no `api`. The mock's `StatTile` **supersedes** the starter's (which has no external consumers — verified). All others are additive.

**Tech Stack:** React 19, Tailwind v4 (mock tokens from the foundation portion), `cn` from `@/shared/lib/cn`, vitest + `@testing-library/react` + `vitest-axe`.

**Spec:** `docs/superpowers/specs/2026-09-08-yagoda-frontend-migration.md` (§5.3, §6, §0a)

## Global Constraints

- **Seam (§0a):** structure follows the starter (one component per file under `shared/ui`, `cn` from `@/shared/lib/cn`, a co-located `*.test.tsx` per component); the component look/markup comes verbatim from the mock.
- **Source:** `/home/dz/RC/yagoda-crm/src/components/common/bits.tsx` and `Sparkline.tsx`. The only edit to ported code is the import: `@/lib/utils` → `@/shared/lib/cn`.
- **No new deps.** All components are React + `cn` + tokens; none pull recharts/cmdk (those come with the primitive portion).
- **react-refresh:** one component per file; `chart-colors.ts` is a const-only module (no component) so it is exempt.
- **Tests:** each component gets a render test + `expectNoAxeViolations` (from `../../test-axe`), mirroring `shared/ui/stat-tile.test.tsx`.
- **Verify:** `npm run lint`, `npm test`, `npm run build` (all in `--workspace=frontend`). No Playwright in this repo.

---

### Task 1: Eyebrow + PageHeader

**Files:**
- Create: `frontend/src/shared/ui/eyebrow.tsx`, `frontend/src/shared/ui/eyebrow.test.tsx`
- Create: `frontend/src/shared/ui/page-header.tsx`, `frontend/src/shared/ui/page-header.test.tsx`

**Interfaces:**
- Produces: `Eyebrow({children, className})`; `PageHeader({eyebrow?, title, description?, actions?})`. PageHeader imports Eyebrow.

- [ ] **Step 1: Write eyebrow.tsx** — port `Eyebrow` from bits.tsx verbatim, `cn` from `@/shared/lib/cn`:
```tsx
import * as React from 'react';
import { cn } from '@/shared/lib/cn';

export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground',
        className,
      )}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Write eyebrow.test.tsx**
```tsx
import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { expectNoAxeViolations } from '../../test-axe';
import { Eyebrow } from './eyebrow';

it('renders its text with the eyebrow classes', () => {
  render(<Eyebrow>Разом</Eyebrow>);
  expect(screen.getByText('Разом')).toHaveClass('uppercase', 'text-muted-foreground');
});

it('has no axe violations', async () => {
  const { container } = render(<Eyebrow>Разом</Eyebrow>);
  await expectNoAxeViolations(container);
});
```

- [ ] **Step 3: Write page-header.tsx** — port `PageHeader` verbatim; import `Eyebrow` from `./eyebrow`, `cn` unused here so omit it:
```tsx
import * as React from 'react';
import { Eyebrow } from './eyebrow';

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pb-5">
      <div className="min-w-0">
        {eyebrow ? <Eyebrow className="mb-1.5">{eyebrow}</Eyebrow> : null}
        <h1 className="font-display text-2xl leading-tight font-medium">{title}</h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
```

- [ ] **Step 4: Write page-header.test.tsx**
```tsx
import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { expectNoAxeViolations } from '../../test-axe';
import { PageHeader } from './page-header';

it('renders the title as an h1 and the optional eyebrow + description', () => {
  render(<PageHeader eyebrow="Каса" title="Каса за день" description="Опис" />);
  expect(screen.getByRole('heading', { level: 1, name: 'Каса за день' })).toBeInTheDocument();
  expect(screen.getByText('Каса')).toBeInTheDocument();
  expect(screen.getByText('Опис')).toBeInTheDocument();
});

it('has no axe violations', async () => {
  const { container } = render(<PageHeader title="Каса за день" />);
  await expectNoAxeViolations(container);
});
```

- [ ] **Step 5: Verify + commit**
```bash
npm test --workspace=frontend -- eyebrow page-header
git add frontend/src/shared/ui/eyebrow.tsx frontend/src/shared/ui/eyebrow.test.tsx frontend/src/shared/ui/page-header.tsx frontend/src/shared/ui/page-header.test.tsx
git commit -m "feat(ui): port Eyebrow and PageHeader from the mock"
```

---

### Task 2: StatTile (supersedes the starter's)

**Files:**
- Overwrite: `frontend/src/shared/ui/stat-tile.tsx` (replace the starter's StatTile/StatGrid with the mock's StatTile)
- Overwrite: `frontend/src/shared/ui/stat-tile.test.tsx` (rewrite for the mock's API)

**Interfaces:**
- Produces: `StatTile({label, value, hint?, tone?, icon?, className?})` where `tone: 'default'|'berry'|'amber'|'leaf'`.
- Note: removes the starter's `StatGrid` (no external consumer — verified by grep).

- [ ] **Step 1: Overwrite stat-tile.tsx** with the mock's StatTile, `cn` from `@/shared/lib/cn`:
```tsx
import * as React from 'react';
import { cn } from '@/shared/lib/cn';

export function StatTile({
  label,
  value,
  hint,
  tone = 'default',
  icon,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: 'default' | 'berry' | 'amber' | 'leaf';
  icon?: React.ReactNode;
  className?: string;
}) {
  const toneClass = {
    default: 'text-foreground',
    berry: 'text-primary',
    amber: 'text-[var(--amber)]',
    leaf: 'text-[var(--leaf)]',
  }[tone];

  return (
    <div
      className={cn(
        'flex min-w-0 flex-col justify-between rounded-xl bg-card px-4 py-3.5 ring-1 ring-foreground/10',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="truncate text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          {label}
        </span>
        {icon ? <span className="shrink-0 text-muted-foreground">{icon}</span> : null}
      </div>
      <div className={cn('mt-2 font-mono text-[26px] leading-none font-semibold tracking-tight', toneClass)}>
        {value}
      </div>
      {hint ? <div className="mt-1.5 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
```
(The label is an inline uppercase span rather than importing `Eyebrow`, keeping the component self-contained exactly as the mock's `bits.tsx` renders it.)

- [ ] **Step 2: Rewrite stat-tile.test.tsx** for the mock's API:
```tsx
import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { expectNoAxeViolations } from '../../test-axe';
import { StatTile } from './stat-tile';

it('renders the label, value and hint', () => {
  render(<StatTile label="У шухляді" value="15 416,10 ₴" hint="на ранок" />);
  expect(screen.getByText('У шухляді')).toBeInTheDocument();
  expect(screen.getByText('15 416,10 ₴')).toHaveClass('font-mono');
  expect(screen.getByText('на ранок')).toBeInTheDocument();
});

it('applies the tone colour to the value', () => {
  render(<StatTile label="За ягоду" value="1 616,10 ₴" tone="berry" />);
  expect(screen.getByText('1 616,10 ₴')).toHaveClass('text-primary');
});

it('has no axe violations', async () => {
  const { container } = render(<StatTile label="X" value="1" />);
  await expectNoAxeViolations(container);
});
```

- [ ] **Step 3: Verify no leftover StatGrid consumers, run tests, commit**
```bash
grep -rn "StatGrid" frontend/src && echo "STILL USED — restore StatGrid" || echo "clean"
npm test --workspace=frontend -- stat-tile
git add frontend/src/shared/ui/stat-tile.tsx frontend/src/shared/ui/stat-tile.test.tsx
git commit -m "feat(ui): replace StatTile with the mock's (label/value/hint/tone)"
```

---

### Task 3: ShareBar, EmptyState, Dot

**Files:**
- Create: `share-bar.tsx`, `empty-state.tsx`, `dot.tsx` (+ a `.test.tsx` each) under `frontend/src/shared/ui/`

**Interfaces:**
- `ShareBar({parts: {value,color,label}[], className?})`; `EmptyState({icon?, title, hint?, action?})`; `Dot({color, className?})`.

- [ ] **Step 1: Write the three components** — port verbatim from bits.tsx, `cn` from `@/shared/lib/cn`. `share-bar.tsx`:
```tsx
import { cn } from '@/shared/lib/cn';

export function ShareBar({
  parts,
  className,
}: {
  parts: { value: number; color: string; label: string }[];
  className?: string;
}) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <div className={cn('flex h-2 w-full gap-[2px] overflow-hidden', className)}>
      {parts.map((p, i) => (
        <div
          key={i}
          title={p.label}
          className="h-full rounded-[2px] first:rounded-l-full last:rounded-r-full"
          style={{ width: `${(p.value / total) * 100}%`, background: p.color }}
        />
      ))}
    </div>
  );
}
```
`empty-state.tsx`:
```tsx
import * as React from 'react';

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-6 py-12 text-center">
      {icon ? <div className="text-muted-foreground">{icon}</div> : null}
      <div className="font-medium">{title}</div>
      {hint ? <div className="max-w-sm text-sm text-muted-foreground">{hint}</div> : null}
      {action}
    </div>
  );
}
```
`dot.tsx`:
```tsx
import { cn } from '@/shared/lib/cn';

export function Dot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      className={cn('inline-block size-2.5 shrink-0 rounded-[3px]', className)}
      style={{ background: color }}
    />
  );
}
```

- [ ] **Step 2: Write a render+axe test per component** (mirror Task 1's test shape): `share-bar.test.tsx` (renders one titled segment per part), `empty-state.test.tsx` (renders the title + hint), `dot.test.tsx` (renders a span with the background style). Each ends with an `expectNoAxeViolations` case.

- [ ] **Step 3: Verify + commit**
```bash
npm test --workspace=frontend -- share-bar empty-state dot
git add frontend/src/shared/ui/share-bar.tsx frontend/src/shared/ui/share-bar.test.tsx frontend/src/shared/ui/empty-state.tsx frontend/src/shared/ui/empty-state.test.tsx frontend/src/shared/ui/dot.tsx frontend/src/shared/ui/dot.test.tsx
git commit -m "feat(ui): port ShareBar, EmptyState and Dot from the mock"
```

---

### Task 4: Sparkline

**Files:**
- Create: `frontend/src/shared/ui/sparkline.tsx`, `frontend/src/shared/ui/sparkline.test.tsx`

**Interfaces:**
- `Sparkline({values: number[], color?, height?, className?, zeroBased?})` — pure inline SVG, no deps.

- [ ] **Step 1: Write sparkline.tsx** — port verbatim from the mock's `Sparkline.tsx` (it already imports nothing; keep it dependency-free).

- [ ] **Step 2: Write sparkline.test.tsx**
```tsx
import { it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { expectNoAxeViolations } from '../../test-axe';
import { Sparkline } from './sparkline';

it('renders an svg with a line path for the values', () => {
  const { container } = render(<Sparkline values={[1, 3, 2, 5]} />);
  expect(container.querySelector('svg')).toBeInTheDocument();
  expect(container.querySelectorAll('path').length).toBeGreaterThanOrEqual(2);
});

it('renders nothing for an empty series', () => {
  const { container } = render(<Sparkline values={[]} />);
  expect(container.querySelector('svg')).toBeNull();
});

it('has no axe violations', async () => {
  const { container } = render(<Sparkline values={[1, 2, 3]} />);
  await expectNoAxeViolations(container);
});
```

- [ ] **Step 3: Verify + commit**
```bash
npm test --workspace=frontend -- sparkline
git add frontend/src/shared/ui/sparkline.tsx frontend/src/shared/ui/sparkline.test.tsx
git commit -m "feat(ui): port the SVG Sparkline from the mock"
```

---

### Task 5: chart-colors + full verification

**Files:**
- Create: `frontend/src/shared/ui/chart-colors.ts`

- [ ] **Step 1: Write chart-colors.ts** (const-only module; no component, so react-refresh does not apply):
```ts
/** Validated categorical set — mirrors the --chart-1..5 tokens in index.css. */
export const CHART_COLORS = ['#c81e4e', '#2e7bc4', '#c57a00', '#2e8b3e', '#7c4dc0'] as const;
```

- [ ] **Step 2: Full-portion verification**
```bash
npm run lint --workspace=frontend
npm test --workspace=frontend
npm run build --workspace=frontend
```
Expected: lint clean, all tests pass (including the new component tests and the rewritten stat-tile test), build succeeds.

- [ ] **Step 3: Commit**
```bash
git add frontend/src/shared/ui/chart-colors.ts
git commit -m "feat(ui): add CHART_COLORS mirroring the chart tokens"
```

---

## Self-Review

**Spec coverage (§5.3/§6 signature components):** Eyebrow, PageHeader (Task 1); StatTile supersede (Task 2); ShareBar, EmptyState, Dot (Task 3); Sparkline (Task 4); CHART_COLORS (Task 5). Primitive supersession (button/card/dialog/…) is the *next* portion — not here.

**Placeholder scan:** component code is inlined; Task 3 Step 2 and Task 4 Step 1 describe tests/port by shape against a cited source rather than re-typing — acceptable for a verbatim port, but the implementer must copy the mock source exactly and only change the `cn` import.

**Type consistency:** `StatTile` prop names (`label/value/hint/tone/icon/className`) match between Task 2's component and its test; `tone` union matches the `toneClass` keys. `Eyebrow` is imported by `page-header.tsx` with the signature Task 1 defines.

**Note:** these components have no screen consumers yet (screens are later portions); the starter runs no dead-file checker (no knip), and ESLint does not flag unimported modules, so a green CI is expected. They are the kit the screen portions consume.

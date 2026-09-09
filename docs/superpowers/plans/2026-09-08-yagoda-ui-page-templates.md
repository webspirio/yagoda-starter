# UI Page Templates (tier 3) Implementation Plan

> **For agentic workers:** Built in this session with three parallel subagents (one per template), then verified centrally. Domain-free templates in `shared/ui/templates/`.

**Goal:** Add the three domain-free page-shape templates — `ListPage`, `DocumentPage`, `DashboardPage` — under `shared/ui/templates/`, composing the tier-1/2 primitives, so screens assemble a page by passing data into a template.

**Architecture:** Tier 3 of the migration, stacked on the primitives portion (#29). Templates take ALL data via props/slots and import only React, `cn`, and other `shared/ui` presentational components — never store/ports/calc/domain. Charts/dialogs are passed in as nodes (templates never import recharts or mount dialogs).

**Spec:** `docs/superpowers/specs/2026-09-08-yagoda-frontend-migration.md` (§5.3, §6); design proposal from the 2026-09-08 page-analysis.

## Global Constraints
- Domain-free (`shared/ui`); ESLint forbids importing entities/features/pages.
- Compose existing `shared/ui`: `PageHeader`, `Eyebrow`, `StatTile`, `StatGrid`, `EmptyState`, `DataTable`/`Column`, `LedgerRow`, `SectionCard`, `DateStepper`, `Segmented`, `Button`.
- One template per file under `shared/ui/templates/` + a co-located `*.test.tsx` (render + `expectNoAxeViolations`).
- Templates NEVER import `recharts`/`chart` — charts arrive as `content`/`children` nodes.
- Verify centrally: `npm run lint`, `npm test`, `npm run build` (`--workspace=frontend`).
- Delivery via `gh stack` (branch added with `gh stack add`, PR'd with `gh stack submit --auto --open`).

## Templates

### `templates/list-page.tsx` — `ListPage<Row>`
```tsx
export interface ListPageProps<Row = unknown> {
  eyebrow?: string; title: string; description?: React.ReactNode; actions?: React.ReactNode;
  stats?: React.ReactNode;      // compose StatGrid + StatTile
  toolbar?: React.ReactNode;    // search/select/date-range
  columns?: Column<Row>[]; rows?: Row[];   // data mode → DataTable
  rowKey?: (row: Row, i: number) => React.Key;
  onRowClick?: (row: Row, i: number) => void;
  children?: React.ReactNode;   // slot mode (cards/matrix) — overrides columns/rows
  isEmpty?: boolean; empty?: React.ReactNode;   // compose EmptyState
  footer?: React.ReactNode;
  maxWidth?: number | string; className?: string;   // default ~1200
}
```
Composition: `mx-auto max-w-[maxWidth]` → `PageHeader` → `stats` → `toolbar` → `isEmpty ? empty : (children ?? <DataTable columns rows rowKey onRowClick/>)` → `footer`. Dialogs are NOT part of the template.

### `templates/document-page.tsx` — `DocumentPage` (+ uses `LedgerRow`)
```tsx
export interface DocumentPageProps {
  eyebrow?: string; title: string; description?: React.ReactNode; actions?: React.ReactNode;
  printHeader?: React.ReactNode;   // .print-only block
  meta?: React.ReactNode;          // on-sheet meta row (screen + paper)
  children: React.ReactNode;       // body: LedgerRows / line-item tables / totals
  footer?: React.ReactNode;        // legend or signature
  printable?: boolean;             // wrap body in .printable (default true)
  landscape?: boolean;             // → .print-landscape
  onPrint?: () => void;            // header print button (default window.print())
  maxWidth?: number | string; className?: string;
}
```
Composition: `mx-auto` → `PageHeader` (auto-inject a print `Button` calling `onPrint ?? window.print` unless `onPrint===null`) → `<div className={cn('printable', ...)}>` (when printable) → `printHeader` (`.print-only`) → `meta` → `children` → `footer`.

### `templates/dashboard-page.tsx` — `DashboardPage`
```tsx
export interface StatItem { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: 'default'|'berry'|'amber'|'leaf'; icon?: React.ReactNode; onClick?: () => void }
export interface DashboardSection { id: string; eyebrow?: string; title?: React.ReactNode; aside?: React.ReactNode; content: React.ReactNode; span?: 1|2|'full'; card?: boolean }
export interface DashboardPageProps {
  eyebrow?: string; title: string; description?: React.ReactNode; actions?: React.ReactNode;
  stats?: StatItem[]; statsSlot?: React.ReactNode; statColumns?: 2|3|4|5;
  sections?: DashboardSection[]; children?: React.ReactNode;
  layout?: 'stack' | 'two-column' | 'sidebar';
  maxWidth?: number | string; className?: string;
}
```
Composition: `mx-auto` → `PageHeader` → (`statsSlot` ?? `<StatGrid columns={statColumns}>` mapping `stats`→`StatTile`) → a grid keyed off `layout` mapping `sections`→`SectionCard` (span honored). NEVER import recharts — `section.content` is a passed-in node.

## Testing
Each template: render with representative props (a couple of stats/rows/sections), assert the title (h1) + a slot renders, plus an `expectNoAxeViolations`. `ListPage` also: data mode renders the table; `isEmpty` shows `empty`. `DocumentPage`: renders `.printable` wrapper and the print button. `DashboardPage`: renders the stat band + a section.

## Self-Review
Covers the three templates from the proposal; `Meter` (dashboard bar-list) is out — pass such content as `section.content`. `EntityDetail` (4th template) is explicitly deferred. No screen consumes these yet; green CI expected.

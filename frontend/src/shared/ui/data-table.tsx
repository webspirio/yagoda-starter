import * as React from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { Card } from './card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';

/** Generic column descriptor — no domain types; the page owns every cell renderer. */
export interface Column<Row> {
  id: string;
  header: React.ReactNode;
  cell: (row: Row, index: number) => React.ReactNode;
  align?: 'left' | 'center' | 'right';
  /** Applied to both the th and every td of this column, e.g. 'w-32 tabular-nums'. */
  className?: string;
  /** Hide this column below the given breakpoint. */
  hideBelow?: 'sm' | 'md' | 'lg';
  /** Makes the header a sort toggle. The value is compared, not the rendered cell:
   *  numbers numerically, text in Ukrainian alphabet order; `null` sorts last
   *  in both directions. Sorting is client-side, so only for a table that holds
   *  its whole list — never for a server-paged one. */
  sortValue?: (row: Row) => string | number | null;
}

type SortDir = 'ascending' | 'descending';

const collator = new Intl.Collator('uk', { numeric: true, sensitivity: 'base' });

function compareValues(a: string | number | null, b: string | number | null, dir: SortDir): number {
  // Empty last whichever way the column runs: «—» is no value, not the smallest one.
  if (a == null || b == null) return a == null ? (b == null ? 0 : 1) : -1;
  const order =
    typeof a === 'number' && typeof b === 'number' ? a - b : collator.compare(String(a), String(b));
  return dir === 'ascending' ? order : -order;
}

const HIDE = { sm: 'max-sm:hidden', md: 'max-md:hidden', lg: 'max-lg:hidden' } as const;
const ALIGN = { left: 'text-left', center: 'text-center', right: 'text-right' } as const;

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  onRowClick,
  rowClickable,
  empty,
  frame = true,
  className,
  renderExpanded,
}: {
  columns: Column<Row>[];
  rows: Row[];
  rowKey?: (row: Row, index: number) => React.Key;
  onRowClick?: (row: Row, index: number) => void;
  /** Narrows `onRowClick` (and its pointer cursor) to the rows this accepts —
   *  e.g. only the expandable ones. Omitted: every row is clickable.
   *  A clickable row has no keyboard affordance of its own (no tab stop, no
   *  Enter/Space), so the caller must also render a keyboard-reachable
   *  control in the row — a button — that does the same thing. */
  rowClickable?: (row: Row, index: number) => boolean;
  empty?: React.ReactNode;
  /** Wrap in the card shell (default). Pass `false` when the table already
   *  lives inside a card, so it does not draw a card within a card. */
  frame?: boolean;
  className?: string;
  /** Detail content shown UNDER a row, in one cell spanning every column.
   *  Return `null` for a row that is not expanded (or not expandable) — the
   *  table owns no open/closed state, the caller decides per row. */
  renderExpanded?: (row: Row, index: number) => React.ReactNode | null;
}) {
  const colClass = (c: Column<Row>) =>
    cn(c.align && ALIGN[c.align], c.hideBelow && HIDE[c.hideBelow], c.className);

  // Unsorted until a header is pressed: the rows keep the order the caller gave.
  const [sort, setSort] = React.useState<{ id: string; dir: SortDir } | null>(null);
  const sortColumn = sort && columns.find((c) => c.id === sort.id && c.sortValue);
  const shown = sortColumn
    ? // Sorted with their original index, so `onRowClick`/`cell` still get it.
      rows
        .map((row, i) => ({ row, i }))
        .sort(
          (x, y) =>
            compareValues(sortColumn.sortValue!(x.row), sortColumn.sortValue!(y.row), sort.dir) ||
            x.i - y.i,
        )
    : rows.map((row, i) => ({ row, i }));
  const toggleSort = (id: string) =>
    setSort((cur) =>
      cur?.id === id
        ? { id, dir: cur.dir === 'ascending' ? 'descending' : 'ascending' }
        : { id, dir: 'ascending' },
    );

  const table = (
    <Table className={className}>
      <TableHeader>
        <TableRow>
          {columns.map((c) => {
            if (!c.sortValue) {
              return (
                <TableHead key={c.id} className={colClass(c)}>
                  {c.header}
                </TableHead>
              );
            }
            const dir = sort?.id === c.id ? sort.dir : null;
            const Icon = dir === 'ascending' ? ChevronUp : dir === 'descending' ? ChevronDown : ChevronsUpDown;
            return (
              <TableHead key={c.id} className={colClass(c)} aria-sort={dir ?? 'none'}>
                <button
                  type="button"
                  onClick={() => toggleSort(c.id)}
                  className={cn(
                    'inline-flex items-center gap-1 uppercase tracking-[inherit] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                    c.align === 'right' && 'flex-row-reverse',
                  )}
                >
                  {c.header}
                  <Icon aria-hidden className={cn('size-3.5', !dir && 'opacity-40')} />
                </button>
              </TableHead>
            );
          })}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 && empty ? (
          <TableRow>
            <TableCell colSpan={columns.length}>{empty}</TableCell>
          </TableRow>
        ) : (
          shown.map(({ row, i }) => {
            const expanded = renderExpanded ? renderExpanded(row, i) : null;
            const onClick =
              onRowClick && (rowClickable?.(row, i) ?? true) ? () => onRowClick(row, i) : undefined;
            return (
              <React.Fragment key={rowKey ? rowKey(row, i) : i}>
                <TableRow
                  onClick={onClick}
                  className={onClick ? 'cursor-pointer' : undefined}
                >
                  {columns.map((c) => (
                    <TableCell key={c.id} className={colClass(c)}>
                      {c.cell(row, i)}
                    </TableCell>
                  ))}
                </TableRow>
                {expanded != null ? (
                  <TableRow data-slot="data-table-expanded" className="bg-muted/40 hover:bg-muted/40">
                    <TableCell colSpan={columns.length} className="whitespace-normal">
                      {expanded}
                    </TableCell>
                  </TableRow>
                ) : null}
              </React.Fragment>
            );
          })
        )}
      </TableBody>
    </Table>
  );

  if (!frame) return table;
  // The mock's table shell: every table there sits in a card, never bare on
  // the paper. `Card` owns the outline so a pane and a table frame match.
  return <Card data-slot="data-table-frame">{table}</Card>;
}

import * as React from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
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
  /** Clickable when the table is given `sort` + `onSortChange`; inert otherwise. */
  sortable?: boolean;
}

/** Which column the rows are ordered by. The table renders it; the page decides it. */
export interface SortState {
  key: string;
  order: 'asc' | 'desc';
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
  sort,
  onSortChange,
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
  /** Opt-in. The table reports which header was clicked; direction rules belong to the caller. */
  sort?: SortState;
  onSortChange?: (key: string) => void;
  /** Detail content shown UNDER a row, in one cell spanning every column.
   *  Return `null` for a row that is not expanded (or not expandable) — the
   *  table owns no open/closed state, the caller decides per row. */
  renderExpanded?: (row: Row, index: number) => React.ReactNode | null;
}) {
  const colClass = (c: Column<Row>) =>
    cn(c.align && ALIGN[c.align], c.hideBelow && HIDE[c.hideBelow], c.className);

  const table = (
    <Table className={className}>
      <TableHeader>
        <TableRow>
          {columns.map((c) => {
            const sortableHere = c.sortable && sort && onSortChange;
            const active = sortableHere && sort.key === c.id;
            const ariaSort = !sortableHere
              ? undefined
              : active
                ? sort.order === 'asc'
                  ? 'ascending'
                  : 'descending'
                : 'none';
            const Arrow = !active ? ArrowUpDown : sort.order === 'asc' ? ArrowUp : ArrowDown;
            return (
              <TableHead key={c.id} className={colClass(c)} aria-sort={ariaSort}>
                {sortableHere ? (
                  <button
                    type="button"
                    onClick={() => onSortChange(c.id)}
                    // A button resets text-transform; `uppercase` keeps it level with the plain headers.
                    className={cn(
                      'inline-flex cursor-pointer items-center gap-1 uppercase',
                      c.align === 'right' && 'flex-row-reverse',
                    )}
                  >
                    {c.header}
                    {/* Every sortable header shows an arrow, so the affordance is visible before the first click. */}
                    <Arrow aria-hidden className={cn('size-3.5', !active && 'text-muted-foreground')} />
                  </button>
                ) : (
                  c.header
                )}
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
          rows.map((row, i) => {
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

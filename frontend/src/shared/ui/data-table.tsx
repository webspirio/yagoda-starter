import * as React from 'react';
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
}

const HIDE = { sm: 'max-sm:hidden', md: 'max-md:hidden', lg: 'max-lg:hidden' } as const;
const ALIGN = { left: 'text-left', center: 'text-center', right: 'text-right' } as const;

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  onRowClick,
  empty,
  frame = true,
  className,
}: {
  columns: Column<Row>[];
  rows: Row[];
  rowKey?: (row: Row, index: number) => React.Key;
  onRowClick?: (row: Row, index: number) => void;
  empty?: React.ReactNode;
  /** Wrap in the card shell (default). Pass `false` when the table already
   *  lives inside a card, so it does not draw a card within a card. */
  frame?: boolean;
  className?: string;
}) {
  const colClass = (c: Column<Row>) =>
    cn(c.align && ALIGN[c.align], c.hideBelow && HIDE[c.hideBelow], c.className);

  const table = (
    <Table className={className}>
      <TableHeader>
        <TableRow>
          {columns.map((c) => (
            <TableHead key={c.id} className={colClass(c)}>
              {c.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 && empty ? (
          <TableRow>
            <TableCell colSpan={columns.length}>{empty}</TableCell>
          </TableRow>
        ) : (
          rows.map((row, i) => (
            <TableRow
              key={rowKey ? rowKey(row, i) : i}
              onClick={onRowClick ? () => onRowClick(row, i) : undefined}
              className={onRowClick ? 'cursor-pointer' : undefined}
            >
              {columns.map((c) => (
                <TableCell key={c.id} className={colClass(c)}>
                  {c.cell(row, i)}
                </TableCell>
              ))}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );

  if (!frame) return table;
  // The mock's table shell: every table there sits in a card, never bare on
  // the paper. `Card` owns the outline so a pane and a table frame match.
  return <Card data-slot="data-table-frame">{table}</Card>;
}

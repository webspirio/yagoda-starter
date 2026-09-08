import type * as React from 'react';
import { cn } from '@/shared/lib/cn';
import { PageHeader } from '@/shared/ui/page-header';
import { DataTable, type Column } from '@/shared/ui/data-table';

/**
 * Domain-free admin list/CRUD page scaffold. Owns only layout and spacing —
 * every cell renderer, stat, toolbar control and action stays with the page.
 * Give it `columns` + `rows` for the built-in table, or `children` for a
 * bespoke body; `isEmpty` short-circuits both to render `empty`.
 */
export interface ListPageProps<Row = unknown> {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  stats?: React.ReactNode;
  toolbar?: React.ReactNode;
  columns?: Column<Row>[];
  rows?: Row[];
  rowKey?: (row: Row, index: number) => React.Key;
  onRowClick?: (row: Row, index: number) => void;
  children?: React.ReactNode;
  isEmpty?: boolean;
  empty?: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: number | string;
  className?: string;
}

export function ListPage<Row = unknown>({
  eyebrow,
  title,
  description,
  actions,
  stats,
  toolbar,
  columns,
  rows,
  rowKey,
  onRowClick,
  children,
  isEmpty,
  empty,
  footer,
  maxWidth,
  className,
}: ListPageProps<Row>): React.JSX.Element {
  let body: React.ReactNode = null;
  if (isEmpty) {
    body = empty ?? null;
  } else if (children != null) {
    body = children;
  } else if (columns && rows) {
    body = (
      <DataTable<Row>
        columns={columns}
        rows={rows}
        rowKey={rowKey}
        onRowClick={onRowClick}
        empty={empty}
      />
    );
  }

  return (
    <div className={cn('mx-auto w-full', className)} style={{ maxWidth: maxWidth ?? 1200 }}>
      <PageHeader eyebrow={eyebrow} title={title} description={description} actions={actions} />
      {stats ? <div className="mb-5">{stats}</div> : null}
      {toolbar ? <div className="mb-3">{toolbar}</div> : null}
      {body}
      {footer ? <div className="mt-4">{footer}</div> : null}
    </div>
  );
}

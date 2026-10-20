import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ListPage } from '@/shared/ui/templates/list-page';
import type { Column } from '@/shared/ui/data-table';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';
import { EmptyState } from '@/shared/ui/empty-state';
import { Spinner } from '@/shared/ui/spinner';
import { decimalKey, useClientSort } from '@/shared/ui/data-table-sort';
import { isTruncated } from '@/shared/api';
import { useCollectionPointsQuery } from '../api/collectionPoints';
import { PointFormDialog } from './PointFormDialog';
import type { CollectionPoint } from '../model/collectionPoint';

export function PointsPage() {
  const { t } = useTranslation();
  const { data, isPending, isError } = useCollectionPointsQuery();

  const [editing, setEditing] = useState<CollectionPoint | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // Bumped on every open so the dialog remounts with fresh RHF defaults.
  const [dialogInstance, setDialogInstance] = useState(0);

  const openCreate = () => {
    setEditing(null);
    setDialogInstance((n) => n + 1);
    setDialogOpen(true);
  };
  const openEdit = (point: CollectionPoint) => {
    setEditing(point);
    setDialogInstance((n) => n + 1);
    setDialogOpen(true);
  };

  // What each sortable column orders by (#250) — the value, not the rendered cell.
  const { rows, sort, onSortChange } = useClientSort(
    data?.data ?? [],
    {
      number: (p) => p.number,
      name: (p) => p.name,
      code: (p) => p.code,
      kind: (p) => t(`points.kind.${p.kind}`),
      // An amount: compared as a decimal string, never through a float.
      target_cash: (p) => decimalKey(p.target_cash),
      target_crates: (p) => p.target_crates,
      is_active: (p) => (p.is_active ? t('points.active') : t('points.inactive')),
    },
    { key: 'name', order: 'asc' },
  );

  const columns: Column<CollectionPoint>[] = [
    {
      id: 'number',
      header: t('points.col.number'),
      className: 'font-mono tabular-nums',
      // The receipt header's «Точка № N» (#250) — kept on narrow screens too.
      cell: (p) => p.number,
      sortable: true,
    },
    {
      id: 'name',
      header: t('points.col.name'),
      cell: (p) => <span className="font-medium">{p.name}</span>,
      sortable: true,
    },
    {
      id: 'code',
      header: t('points.col.code'),
      className: 'font-mono',
      cell: (p) => p.code,
      sortable: true,
    },
    {
      id: 'kind',
      header: t('points.col.kind'),
      cell: (p) => t(`points.kind.${p.kind}`),
      sortable: true,
    },
    {
      id: 'target_cash',
      header: t('points.col.targetCash'),
      align: 'right',
      className: 'font-mono tabular-nums',
      hideBelow: 'sm',
      cell: (p) => p.target_cash ?? '—',
      sortable: true,
    },
    {
      id: 'target_crates',
      header: t('points.col.targetCrates'),
      align: 'right',
      className: 'font-mono tabular-nums',
      hideBelow: 'sm',
      cell: (p) => (p.target_crates == null ? '—' : p.target_crates),
      sortable: true,
    },
    {
      id: 'is_active',
      header: t('points.col.status'),
      align: 'right',
      sortable: true,
      cell: (p) => (
        <Badge variant={p.is_active ? 'default' : 'secondary'}>
          {p.is_active ? t('points.active') : t('points.inactive')}
        </Badge>
      ),
    },
  ];

  return (
    <>
      <ListPage<CollectionPoint>
        eyebrow={t('points.eyebrow')}
        title={t('points.title')}
        description={t('points.description')}
        actions={<Button onClick={openCreate}>{t('points.new')}</Button>}
        columns={columns}
        rows={rows}
        rowKey={(p) => p.id}
        onRowClick={openEdit}
        sort={sort}
        onSortChange={onSortChange}
        footer={
          // The server caps a read at 100: past that the table — and its sort —
          // holds only the first page, so say so rather than look complete.
          isTruncated(data) ? (
            <p className="text-xs text-muted-foreground">
              {t('points.truncated', { shown: rows.length, total: data?.total })}
            </p>
          ) : undefined
        }
        isEmpty={!isPending && !isError && rows.length === 0}
        empty={<EmptyState title={t('points.empty.title')} hint={t('points.empty.hint')} />}
      >
        {isPending ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : isError ? (
          <p role="alert" className="py-6 text-center text-destructive">
            {t('common.somethingWentWrong')}
          </p>
        ) : undefined}
      </ListPage>

      <PointFormDialog
        key={dialogInstance}
        point={editing}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />
    </>
  );
}

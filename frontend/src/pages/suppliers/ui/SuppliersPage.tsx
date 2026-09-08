import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ListPage } from '@/shared/ui/templates/list-page';
import type { Column } from '@/shared/ui/data-table';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';
import { TextInput } from '@/shared/ui/text-input';
import { EmptyState } from '@/shared/ui/empty-state';
import { Spinner } from '@/shared/ui/spinner';
import { useDebouncedValue } from '@/shared/lib/useDebouncedValue';
import { usePointOptionsQuery } from '@/entities/collection-point';
import { useSuppliersQuery } from '@/entities/supplier';
import type { Supplier } from '@/entities/supplier';
import { SupplierFormDialog } from './SupplierFormDialog';

export function SuppliersPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  // Debounced so each keystroke does not fire its own request.
  const debouncedSearch = useDebouncedValue(search);
  const { data, isPending, isError } = useSuppliersQuery(debouncedSearch);
  const { data: points } = usePointOptionsQuery();

  const [editing, setEditing] = useState<Supplier | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // Bumped on every open so the dialog remounts with fresh RHF defaults.
  const [dialogInstance, setDialogInstance] = useState(0);

  const openCreate = () => {
    setEditing(null);
    setDialogInstance((n) => n + 1);
    setDialogOpen(true);
  };
  const openEdit = (supplier: Supplier) => {
    setEditing(supplier);
    setDialogInstance((n) => n + 1);
    setDialogOpen(true);
  };

  const rows = data?.data ?? [];
  const pointName = new Map((points ?? []).map((p) => [p.id, p.name]));

  const columns: Column<Supplier>[] = [
    {
      id: 'name',
      header: t('suppliers.col.name'),
      cell: (s) => <span className="font-medium">{`${s.first_name} ${s.last_name}`}</span>,
    },
    { id: 'phone', header: t('suppliers.col.phone'), cell: (s) => s.phone ?? '—' },
    {
      id: 'kind',
      header: t('suppliers.col.kind'),
      hideBelow: 'sm',
      cell: (s) => t(`suppliers.kindLabel.${s.kind}`),
    },
    {
      id: 'point',
      header: t('suppliers.col.point'),
      hideBelow: 'sm',
      cell: (s) => pointName.get(s.collection_point_id) ?? '—',
    },
    {
      id: 'is_active',
      header: t('suppliers.col.status'),
      align: 'right',
      cell: (s) => (
        <Badge variant={s.is_active ? 'default' : 'secondary'}>
          {s.is_active ? t('suppliers.active') : t('suppliers.inactive')}
        </Badge>
      ),
    },
    {
      id: 'card',
      header: t('suppliers.col.card'),
      align: 'right',
      cell: (s) => (
        <Link
          to={`/suppliers/${s.id}`}
          // The row itself opens the edit dialog (`onRowClick` on ListPage) —
          // without this the link's click would bubble into that handler too,
          // opening the dialog behind the navigation it just triggered.
          onClick={(e) => e.stopPropagation()}
          className="text-primary underline-offset-2 hover:underline"
        >
          {t('suppliers.col.card')}
        </Link>
      ),
    },
  ];

  return (
    <>
      <ListPage<Supplier>
        eyebrow={t('suppliers.eyebrow')}
        title={t('suppliers.title')}
        description={t('suppliers.description')}
        actions={<Button onClick={openCreate}>{t('suppliers.new')}</Button>}
        toolbar={
          <TextInput
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('suppliers.searchPlaceholder')}
            aria-label={t('suppliers.searchPlaceholder')}
            className="max-w-xs"
          />
        }
        columns={columns}
        rows={rows}
        rowKey={(s) => s.id}
        onRowClick={openEdit}
        isEmpty={!isPending && !isError && rows.length === 0}
        empty={<EmptyState title={t('suppliers.empty.title')} hint={t('suppliers.empty.hint')} />}
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

      <SupplierFormDialog
        key={dialogInstance}
        supplier={editing}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />
    </>
  );
}

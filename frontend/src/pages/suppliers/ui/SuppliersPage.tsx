import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ListPage } from '@/shared/ui/templates/list-page';
import type { Column } from '@/shared/ui/data-table';
import { Button } from '@/shared/ui/button';
import { TextInput } from '@/shared/ui/text-input';
import { EmptyState } from '@/shared/ui/empty-state';
import { Spinner } from '@/shared/ui/spinner';
import { useDebouncedValue } from '@/shared/lib/useDebouncedValue';
import { useUrlPatch, useUrlParam } from '@/shared/lib/url-state';
import { formatKg, formatUah } from '@/shared/lib/money';
import { useSupplierTotalsInfiniteQuery } from '@/entities/supplier';
import type { Supplier, SupplierTotalsRow } from '@/entities/supplier';
import { SupplierFormDialog } from '@/features/edit-supplier';
import { nextSort, readSort, toUrl } from '../model/supplierSort';

export function SuppliersPage() {
  const { t, i18n } = useTranslation();
  const [search, setSearch] = useState('');
  // Debounced so each keystroke does not fire its own request.
  const debouncedSearch = useDebouncedValue(search);
  // In the URL so Back from a card returns to the same ranking (#230).
  const [sortParam] = useUrlParam('sort');
  const [orderParam] = useUrlParam('order');
  const patchUrl = useUrlPatch();
  const sort = readSort(sortParam, orderParam);
  const { data, isPending, isError, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useSupplierTotalsInfiniteQuery({ search: debouncedSearch, sort: sort.key, order: sort.order });

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

  const rows = data?.pages.flatMap((p) => p.data) ?? [];
  const total = data?.pages[0]?.total ?? 0;
  const locale = i18n.language;

  const columns: Column<SupplierTotalsRow>[] = [
    {
      id: 'name',
      header: t('suppliers.col.name'),
      sortable: true,
      cell: (s) => <span className="font-medium">{`${s.first_name} ${s.last_name}`}</span>,
    },
    {
      id: 'weight',
      header: t('suppliers.col.weight'),
      sortable: true,
      align: 'right',
      className: 'tabular-nums',
      cell: (s) => formatKg(s.kg_total, locale),
    },
    {
      id: 'mainProduct',
      header: t('suppliers.col.mainProduct'),
      hideBelow: 'sm',
      cell: (s) => s.main_product_name ?? '—',
    },
    {
      id: 'kind',
      header: t('suppliers.col.kind'),
      hideBelow: 'sm',
      cell: (s) => t(`suppliers.kindLabel.${s.kind}`),
    },
    {
      id: 'amount',
      header: t('suppliers.col.accrued'),
      sortable: true,
      align: 'right',
      className: 'tabular-nums',
      cell: (s) => formatUah(s.accrued, locale),
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
          aria-label={t('suppliers.cardOf', { name: `${s.first_name} ${s.last_name}` })}
          className="text-primary underline-offset-2 hover:underline"
        >
          {t('suppliers.col.card')}
        </Link>
      ),
    },
  ];

  const footer =
    rows.length > 0 ? (
      <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>{t('suppliers.shownOf', { shown: rows.length, total })}</span>
        {hasNextPage ? (
          <Button variant="outline" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
            {isFetchingNextPage ? <Spinner /> : null}
            {t('suppliers.showMore')}
          </Button>
        ) : null}
      </div>
    ) : null;

  return (
    <>
      <ListPage<SupplierTotalsRow>
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
        onRowClick={(s: Supplier) => openEdit(s)}
        sort={sort}
        onSortChange={(key) => patchUrl(toUrl(nextSort(sort, key)))}
        footer={footer}
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

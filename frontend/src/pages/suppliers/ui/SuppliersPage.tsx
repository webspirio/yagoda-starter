import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
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
import { supplierName, useSupplierTotalsInfiniteQuery } from '@/entities/supplier';
import type { Supplier, SupplierTotalsRow } from '@/entities/supplier';
import { SupplierFormDialog } from '@/features/edit-supplier';
import { nextSort, readSort, toUrl } from '../model/supplierSort';

export function SuppliersPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
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

  // Offset pages shift when a supplier is added between fetches, so one can repeat; keep the first.
  const seen = new Set<string>();
  const rows = (data?.pages.flatMap((p) => p.data) ?? []).filter((s) =>
    seen.has(s.id) ? false : (seen.add(s.id), true),
  );
  // Spinner only when there is nothing to show: a refetch (new sort) keeps the table mounted.
  const showSpinner = isPending && !data;
  const total = data?.pages[0]?.total ?? 0;
  const locale = i18n.language;

  const columns: Column<SupplierTotalsRow>[] = [
    {
      id: 'name',
      header: t('suppliers.col.name'),
      sortable: true,
      cell: (s) => (
        <Link
          to={`/suppliers/${s.id}`}
          // The row itself navigates to the card too (`onRowClick` below) —
          // without this the link's click would bubble into that handler,
          // firing the same navigation twice. The link is what a keyboard
          // reaches; the row is only a bigger target for the mouse.
          onClick={(e) => e.stopPropagation()}
          className="font-medium text-primary underline-offset-2 hover:underline"
        >
          {supplierName(s)}
        </Link>
      ),
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
      id: 'action',
      header: <span className="sr-only">{t('suppliers.col.action')}</span>,
      align: 'right',
      cell: (s) => (
        <Button
          size="sm"
          variant="outline"
          onClick={(e) => {
            // The row itself opens the card — this button must not trigger
            // that when it opens the edit dialog instead (#156).
            e.stopPropagation();
            openEdit(s);
          }}
          aria-label={t('suppliers.editOf', { name: supplierName(s) })}
        >
          {t('suppliers.edit')}
        </Button>
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
        onRowClick={(s) => navigate(`/suppliers/${s.id}`)}
        sort={sort}
        onSortChange={(key) => patchUrl(toUrl(nextSort(sort, key)))}
        footer={footer}
        isEmpty={!showSpinner && !isError && rows.length === 0}
        empty={<EmptyState title={t('suppliers.empty.title')} hint={t('suppliers.empty.hint')} />}
      >
        {showSpinner ? (
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

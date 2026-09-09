import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ListPage } from '@/shared/ui/templates/list-page';
import type { Column } from '@/shared/ui/data-table';
import { Button } from '@/shared/ui/button';
import { SelectField } from '@/shared/ui/select-field';
import { EmptyState } from '@/shared/ui/empty-state';
import { Spinner } from '@/shared/ui/spinner';
import { usePointOptionsQuery } from '@/entities/collection-point';
import { useGradeCatalogQuery, type GradeCatalogItem } from '@/entities/product-grade';
import { useCurrentPricesQuery } from '../api/gradePrices';
import { SetPriceDialog } from './SetPriceDialog';

/** The mock's `PriceMissing` for a reader: a muted dash, never a bare "—" in ink. */
function Missing() {
  return <span className="text-muted-foreground">—</span>;
}

/**
 * Owner-only "Day prices": pick a point, see the current buy price per grade,
 * and set a new one. SIMPLE by design — no history and no all-points matrix; a
 * price correction is a fresh POST (the latest row wins), read back by the
 * `/current` picker one point at a time.
 *
 * Money is rendered RAW — the values are decimal strings straight off the wire,
 * never through `toFixed`/`Number`, so nothing passes through a binary float.
 * The unit (₴/kg) lives in the column header, as the catalog does for deposits.
 */
export function PricesPage() {
  const { t } = useTranslation();
  const { data: points } = usePointOptionsQuery();

  // '' means "no point picked yet" — the SelectField's own empty option.
  const [selectedPointId, setSelectedPointId] = useState('');
  const pointId = selectedPointId === '' ? null : selectedPointId;
  const pointName = (points ?? []).find((p) => p.id === pointId)?.name ?? '';

  const grades = useGradeCatalogQuery();
  const prices = useCurrentPricesQuery(pointId);
  const priceMap = prices.data ?? {};

  const [editing, setEditing] = useState<GradeCatalogItem | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // Bumped on every open so the dialog remounts with fresh RHF defaults.
  const [dialogInstance, setDialogInstance] = useState(0);

  const openSetPrice = (grade: GradeCatalogItem) => {
    setEditing(grade);
    setDialogInstance((n) => n + 1);
    setDialogOpen(true);
  };

  const columns: Column<GradeCatalogItem>[] = [
    {
      id: 'grade',
      header: t('prices.col.grade'),
      cell: (g) => (
        <span className="font-medium">
          {g.productName} · {g.name}
        </span>
      ),
    },
    {
      id: 'base',
      header: t('prices.col.base'),
      align: 'right',
      className: 'font-mono tabular-nums font-medium',
      cell: (g) => priceMap[g.id]?.base_price ?? <Missing />,
    },
    {
      id: 'markup',
      header: t('prices.col.markup'),
      align: 'right',
      className: 'font-mono tabular-nums',
      hideBelow: 'sm',
      cell: (g) => priceMap[g.id]?.max_markup ?? <Missing />,
    },
    {
      id: 'discount',
      header: t('prices.col.discount'),
      align: 'right',
      className: 'font-mono tabular-nums',
      hideBelow: 'sm',
      cell: (g) => priceMap[g.id]?.max_discount ?? <Missing />,
    },
    {
      id: 'action',
      // Visually hidden so the column has an accessible name without a visible
      // header over a button cell.
      header: <span className="sr-only">{t('prices.col.action')}</span>,
      align: 'right',
      // The mock's verb pair: a priced grade is CHANGED (pencil), an unpriced
      // one is SET — the invitation, not the correction.
      cell: (g) => (
        <Button size="sm" variant="outline" onClick={() => openSetPrice(g)}>
          <Pencil className="size-3.5" />
          {priceMap[g.id] ? t('prices.change') : t('prices.set')}
        </Button>
      ),
    },
  ];

  // `prices` is disabled (and so reports isPending) until a point is picked, but
  // the EmptyState branch fires first in that case, so this only gates a live read.
  const isPending = grades.isPending || prices.isPending;
  const isError = grades.isError || prices.isError;

  return (
    <>
      <ListPage<GradeCatalogItem>
        eyebrow={t('prices.eyebrow')}
        title={t('prices.title')}
        description={t('prices.description')}
        toolbar={
          <div className="w-full max-w-xs">
            <SelectField
              aria-label={t('prices.pickPoint')}
              value={selectedPointId}
              onChange={(e) => setSelectedPointId(e.target.value)}
            >
              <option value="">{t('prices.pickPoint')}</option>
              {(points ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </SelectField>
          </div>
        }
        columns={columns}
        rows={grades.data}
        rowKey={(g) => g.id}
        isEmpty={pointId === null}
        empty={<EmptyState title={t('prices.empty.title')} hint={t('prices.empty.hint')} />}
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

      {editing && pointId !== null ? (
        <SetPriceDialog
          key={dialogInstance}
          pointId={pointId}
          pointName={pointName}
          grade={editing}
          current={priceMap[editing.id] ?? null}
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
        />
      ) : null}
    </>
  );
}

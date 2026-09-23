import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/shared/ui/page-header';
import { EmptyState } from '@/shared/ui/empty-state';
import { Spinner } from '@/shared/ui/spinner';
import { useMeQuery } from '@/entities/user';
import type { GradeCatalogItem } from '@/entities/product-grade';
import { usePriceSheetQuery } from '../api/priceSheet';
import { PriceSheet } from './PriceSheet';
import { SetPriceDialog } from './SetPriceDialog';
import { PriceHistoryDialog } from './PriceHistoryDialog';
import { PriceChanges } from './PriceChanges';
import type { SheetPoint, SheetRow } from '../model/gradePrice';

/** What the open dialog is about: which grade, which points, prefilled with what. */
interface Editing {
  grade: GradeCatalogItem;
  pointIds: string[];
  pointName: string;
  current: { base_price: string; max_markup: string; max_discount: string } | null;
}

/**
 * «ЦІНИ ДНЯ» AS A SHEET (#89) — rows are grades, columns are points, with a
 * «Ціна дня загальна» column carrying the «встановити всім» gesture.
 *
 * THIS REPLACED A POINT PICKER, and the reason is in the server's own DTO:
 * `CurrentGradePricesQueryDto` caps at 100 rows and its header says «the
 * owner's price screen must therefore fetch one point at a time». That is why
 * the old screen made the owner choose a point before seeing anything — a
 * limitation, read by everyone as a feature. `GET /grade-prices/sheet` removes
 * it, and the whole network fits on one screen.
 *
 * THERE IS NO DATE PICKER, AND THAT IS NOT AN OMISSION. #89 states the rule as
 * the trio «день + точка + сорт», but this implementation deliberately has no
 * `business_date` on `grade_prices` — prices carry over until changed (owner's
 * decision 2026-09-07, cost recorded in spec `2026-09-07` §8.1). The sheet
 * therefore shows CURRENT prices and must not promise a date it cannot honour.
 * Restoring the daily key is a separate slice, not something to smuggle in
 * behind a date control that would silently read the wrong rows.
 *
 * THE OPERATOR IS SCOPED BY THE SERVER, not by this component: the sheet route
 * runs `resolvePointFilter`, so their response has one column. Nothing here
 * filters by role except the WRITE affordances.
 */
export function PricesPage() {
  const { t } = useTranslation();
  const { data: me } = useMeQuery();
  const sheet = usePriceSheetQuery();

  const canEdit = me?.role === 'network_owner';

  const [editing, setEditing] = useState<Editing | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // Bumped on every open so the dialog remounts with fresh RHF defaults.
  const [dialogInstance, setDialogInstance] = useState(0);

  /** §4.2's journal for one (point, grade). Reachable by BOTH roles: the owner
   *  from inside the set-price dialog, the operator by clicking a locked cell. */
  const [history, setHistory] = useState<{ pointId: string; grade: GradeCatalogItem } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyInstance, setHistoryInstance] = useState(0);

  const openHistory = (pointId: string, grade: GradeCatalogItem) => {
    setHistory({ pointId, grade });
    setHistoryInstance((n) => n + 1);
    setHistoryOpen(true);
  };

  const openDialog = (next: Editing) => {
    setEditing(next);
    setDialogInstance((n) => n + 1);
    setDialogOpen(true);
  };

  /** `SheetRow` carries the grade's names; `GradeCatalogItem` is what the dialog
   *  takes. The two describe the same grade, so this is a rename, not a lookup. */
  const asCatalogItem = (row: SheetRow): GradeCatalogItem =>
    ({
      id: row.product_grade_id,
      name: row.grade_name,
      productName: row.product_name,
    }) as GradeCatalogItem;

  const editCell = (row: SheetRow, point: SheetPoint) =>
    openDialog({
      grade: asCatalogItem(row),
      pointIds: [point.id],
      pointName: point.name,
      current: row.prices[point.id] ?? null,
    });

  const setEverywhere = (row: SheetRow, pointIds: string[]) => {
    // Prefilled from a point that HAS a price, so the owner nudges the common
    // number rather than retyping it. Which one is immaterial — if they
    // disagree, the owner is about to overwrite all of them anyway.
    const seeded = pointIds.map((id) => row.prices[id]).find((cell) => cell !== undefined) ?? null;
    openDialog({
      grade: asCatalogItem(row),
      pointIds,
      pointName: t('prices.sheet.allPoints', { count: pointIds.length }),
      current: seeded,
    });
  };

  return (
    <>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6">
        <PageHeader
          eyebrow={t('prices.eyebrow')}
          title={t('prices.title')}
          description={t('prices.description')}
        />

        {canEdit ? null : (
          <p className="rounded-md bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
            {t('prices.banner')}
          </p>
        )}

        {sheet.isPending ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : sheet.isError ? (
          <p role="alert" className="py-6 text-center text-destructive">
            {t('common.somethingWentWrong')}
          </p>
        ) : sheet.data && sheet.data.rows.length > 0 && sheet.data.points.length > 0 ? (
          <PriceSheet
            sheet={sheet.data}
            canEdit={canEdit}
            onEditCell={editCell}
            onSetEverywhere={setEverywhere}
            onShowHistory={(row, point) => openHistory(point.id, asCatalogItem(row))}
          />
        ) : (
          <EmptyState title={t('prices.empty.title')} hint={t('prices.empty.hint')} />
        )}

        {/* #151 — its own read, so a failed or slow feed never hides the sheet. */}
        <PriceChanges />
      </div>

      {editing ? (
        <SetPriceDialog
          key={dialogInstance}
          pointIds={editing.pointIds}
          pointName={editing.pointName}
          grade={editing.grade}
          current={editing.current}
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          onShowHistory={
            editing.pointIds.length === 1
              ? () => {
                  setDialogOpen(false);
                  openHistory(editing.pointIds[0], editing.grade);
                }
              : undefined
          }
        />
      ) : null}

      {history ? (
        <PriceHistoryDialog
          key={historyInstance}
          pointId={history.pointId}
          grade={history.grade}
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
        />
      ) : null}
    </>
  );
}

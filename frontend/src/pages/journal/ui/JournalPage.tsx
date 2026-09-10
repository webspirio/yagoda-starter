import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { ListPage } from '@/shared/ui/templates/list-page';
import { StatGrid } from '@/shared/ui/stat-grid';
import { StatTile } from '@/shared/ui/stat-tile';
import { Tabs, TabsContent } from '@/shared/ui/tabs';
import { isTruncated } from '@/shared/api';
import { useUrlPatch } from '@/shared/lib/url-state';
import { sum, formatUah } from '@/shared/lib/money';
import { usePointOptionsQuery } from '@/entities/collection-point';
import { useIntakesQuery, type DocumentFilter } from '@/entities/intake';
import { usePayoutsQuery } from '@/entities/payout';
import { useSuppliersQuery, useSupplierBalancesQuery, supplierName } from '@/entities/supplier';
import { ReceiptDialog } from '@/widgets/receipt';
import { monthRange, parseFilters, PAGE_SIZE } from '../model/journalFilters';
import { JournalToolbar } from './JournalToolbar';
import { JournalTable, type JournalRow } from './JournalTable';

type JournalKind = 'intakes' | 'payouts';

/** The shape `Intake` and `Payout` share — every field a journal row needs
 *  to resolve into a `JournalRow`. Structural, so the same function reduces
 *  either document type without a same-layer `entities/payout` ->
 *  `entities/intake` import. */
interface JournalDocument {
  id: string;
  code: string;
  business_date: string;
  created_at: string;
  collection_point_id: string;
  supplier_id: string;
  amount: string;
  voided_at: string | null;
  void_reason: string | null;
}

function toJournalRow(
  doc: JournalDocument,
  pointName: Map<string, string>,
  supplierLabel: (supplierId: string) => string,
): JournalRow {
  return {
    id: doc.id,
    code: doc.code,
    businessDate: doc.business_date,
    createdAt: doc.created_at,
    pointName: pointName.get(doc.collection_point_id) ?? '—',
    supplierLabel: supplierLabel(doc.supplier_id),
    amount: doc.amount,
    voided: doc.voided_at !== null,
    reason: doc.void_reason,
  };
}

/**
 * «Журнал прийомки» — the owner's register of every receipt and payout,
 * filtered by point, calendar month and supplier. Unlike «Каса за день»
 * (one point's one working day, scoped by its shift), this reads straight
 * off `from`/`to` business dates — a season of documents, not a day's — so
 * every filter lives in the URL rather than in `usePointScope`, and the
 * table is server-paginated instead of truncated at a fixed limit.
 *
 * «Квитанції» and «Виплати» are two tabs over the SAME filters, because the
 * API has no merged read: `useIntakesQuery`/`usePayoutsQuery` both run on
 * every render (React hooks can't be conditional), and the active tab only
 * decides which result renders.
 */
export function JournalPage() {
  const { t, i18n } = useTranslation();
  const [searchParams] = useSearchParams();
  const patch = useUrlPatch();

  const filters = parseFilters(searchParams);
  const kind: JournalKind = searchParams.get('kind') === 'payouts' ? 'payouts' : 'intakes';

  const { data: points } = usePointOptionsQuery();
  const pointName = new Map((points ?? []).map((p) => [p.id, p.name]));

  const suppliersQuery = useSuppliersQuery('', filters.pointId);
  const suppliers = suppliersQuery.data?.data ?? [];

  // Name source for TABLE ROWS — every supplier at the scope, one call,
  // never the browsable-suppliers picker above: a voided or long-inactive
  // supplier can still own a historic document this journal has to label.
  const balancesQuery = useSupplierBalancesQuery({ pointId: filters.pointId, includeZero: true });
  const supplierNameById = new Map(
    (balancesQuery.data?.data ?? []).map((r) => [r.supplier_id, supplierName(r)]),
  );
  const supplierLabel = (supplierId: string) =>
    supplierNameById.get(supplierId) ?? supplierId.slice(0, 8);

  const documentFilter: DocumentFilter = {
    from: filters.from,
    to: filters.to,
    pointId: filters.pointId ?? undefined,
    supplierId: filters.supplierId ?? undefined,
    includeVoided: filters.includeVoided,
    page: filters.page,
    limit: PAGE_SIZE,
  };

  const intakesQuery = useIntakesQuery(documentFilter);
  const payoutsQuery = usePayoutsQuery(documentFilter);
  const activeQuery = kind === 'payouts' ? payoutsQuery : intakesQuery;

  const activeTotal = activeQuery.data?.total ?? 0;
  const liveAmounts = (activeQuery.data?.data ?? [])
    .filter((doc) => doc.voided_at === null)
    .map((doc) => doc.amount);
  const amountSum = sum(liveAmounts);
  // The count tile is always the server's true `total`; only the money sum
  // is a display total over what actually reached the browser, so only IT
  // needs the «на цій сторінці» caveat once a page held back the rest.
  const pageOnly = isTruncated<JournalDocument>(activeQuery.data);

  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const openReceipt = (row: JournalRow) => {
    setReceiptId(row.id);
    setReceiptOpen(true);
  };

  const setPage = (page: number) => patch({ page: page === 1 ? null : page });

  return (
    <>
      <Tabs
        value={kind}
        onValueChange={(next) => patch({ kind: next === 'intakes' ? null : next, page: null })}
      >
        <ListPage
          eyebrow={t('journal.eyebrow')}
          title={t('journal.title')}
          description={t('journal.description')}
          toolbar={
            <JournalToolbar
              points={points ?? []}
              pointId={filters.pointId ?? ''}
              onPointChange={(value) => patch({ point: value || null, supplier: null, page: null })}
              month={filters.from.slice(0, 7)}
              onMonthChange={(value) => {
                if (!value) return;
                const { from, to } = monthRange(`${value}-01`);
                patch({ from, to, page: null });
              }}
              suppliers={suppliers}
              supplierId={filters.supplierId ?? ''}
              onSupplierChange={(value) => patch({ supplier: value || null, page: null })}
              includeVoided={filters.includeVoided}
              onIncludeVoidedChange={(next) => patch({ voided: next ? null : '0', page: null })}
            />
          }
          stats={
            <StatGrid columns={2}>
              <StatTile
                label={kind === 'payouts' ? t('journal.tiles.payouts') : t('journal.tiles.receipts')}
                value={String(activeTotal)}
              />
              <StatTile
                label={kind === 'payouts' ? t('journal.tiles.paid') : t('journal.tiles.accrued')}
                value={formatUah(amountSum, i18n.language)}
                hint={pageOnly ? t('journal.tiles.pageHint') : undefined}
              />
            </StatGrid>
          }
        >
          <TabsContent value="intakes">
            <JournalTable
              isPending={intakesQuery.isPending}
              isError={intakesQuery.isError}
              rows={(intakesQuery.data?.data ?? []).map((doc) =>
                toJournalRow(doc, pointName, supplierLabel),
              )}
              total={intakesQuery.data?.total ?? 0}
              page={filters.page}
              limit={PAGE_SIZE}
              onPageChange={setPage}
              onRowClick={openReceipt}
            />
          </TabsContent>
          <TabsContent value="payouts">
            <JournalTable
              isPending={payoutsQuery.isPending}
              isError={payoutsQuery.isError}
              rows={(payoutsQuery.data?.data ?? []).map((doc) =>
                toJournalRow(doc, pointName, supplierLabel),
              )}
              total={payoutsQuery.data?.total ?? 0}
              page={filters.page}
              limit={PAGE_SIZE}
              onPageChange={setPage}
            />
          </TabsContent>
        </ListPage>
      </Tabs>

      <ReceiptDialog
        key={receiptId}
        intakeId={receiptId}
        open={receiptOpen}
        onClose={() => setReceiptOpen(false)}
      />
    </>
  );
}

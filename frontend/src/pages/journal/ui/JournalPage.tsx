import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { ListPage } from '@/shared/ui/templates/list-page';
import { StatGrid } from '@/shared/ui/stat-grid';
import { StatTile } from '@/shared/ui/stat-tile';
import { Tabs, TabsContent } from '@/shared/ui/tabs';
import { useUrlPatch } from '@/shared/lib/url-state';
import { formatUah } from '@/shared/lib/money';
import { usePointOptionsQuery } from '@/entities/collection-point';
import { useIntakesQuery, type DocumentFilter } from '@/entities/intake';
import { usePayoutsQuery } from '@/entities/payout';
import { useSuppliersQuery, useSupplierBalancesQuery, supplierName } from '@/entities/supplier';
import { useMeQuery } from '@/entities/user';
import { PayoutReceiptDialog, ReceiptDialog, useReceiptOpener } from '@/widgets/receipt';
import { parseFilters, PAGE_SIZE } from '../model/journalFilters';
import { useJournalTotalsQuery } from '../api/journalTotals';
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
 * filtered by point, a «з»/«по» date range (the current month by default)
 * and supplier. Unlike «Каса точки»'s «Документи дня»
 * (one point's one working day, scoped by its shift), this reads straight
 * off `from`/`to` business dates — a season of documents, not a day's — so
 * every filter lives in the URL rather than in `usePointScope`, and the
 * table is server-paginated instead of truncated at a fixed limit.
 *
 * «Квитанції» and «Виплати» are two tabs over the SAME filters, because the
 * API has no merged read: `useIntakesQuery`/`usePayoutsQuery` both run on
 * every render (React hooks can't be conditional), and the active tab only
 * decides which result renders.
 *
 * The two tiles are the same on both tabs (#257): `/journal-totals` sums the
 * whole range on the server — live documents only, whatever the voided switch
 * says, since that switch shapes the tables, not the money.
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
  const totalsQuery = useJournalTotalsQuery({
    from: filters.from,
    to: filters.to,
    pointId: filters.pointId,
    supplierId: filters.supplierId,
  });
  const totalTile = (amount: string | undefined) =>
    amount === undefined ? '—' : formatUah(amount, i18n.language);

  const receipt = useReceiptOpener();
  const { openReceipt } = receipt;
  const payoutReceipt = useReceiptOpener();
  const { data: me } = useMeQuery();

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
              from={filters.from}
              to={filters.to}
              // Both bounds every time: a URL holding only one falls back to the month.
              onFromChange={(from) => patch({ from, to: filters.to, page: null })}
              onToChange={(to) => patch({ from: filters.from, to, page: null })}
              suppliers={suppliers}
              supplierId={filters.supplierId ?? ''}
              onSupplierChange={(value) => patch({ supplier: value || null, page: null })}
              includeVoided={filters.includeVoided}
              onIncludeVoidedChange={(next) => patch({ voided: next ? null : '0', page: null })}
            />
          }
          stats={
            <StatGrid columns={2}>
              <StatTile label={t('journal.tiles.accrued')} value={totalTile(totalsQuery.data?.accrued)} />
              <StatTile label={t('journal.tiles.paid')} value={totalTile(totalsQuery.data?.paid)} />
            </StatGrid>
          }
        >
          <TabsContent value="intakes">
            <JournalTable
              isPending={intakesQuery.isPending}
              isError={intakesQuery.isError}
              rows={(intakesQuery.data?.data ?? []).map((doc) => ({
                ...toJournalRow(doc, pointName, supplierLabel),
                intake: doc,
              }))}
              total={intakesQuery.data?.total ?? 0}
              page={filters.page}
              limit={PAGE_SIZE}
              onPageChange={setPage}
              onRowClick={(row) => openReceipt(row.id)}
              me={me}
              onVoid={(row) => openReceipt(row.id, { void: true })}
            />
          </TabsContent>
          <TabsContent value="payouts">
            <JournalTable
              isPending={payoutsQuery.isPending}
              isError={payoutsQuery.isError}
              rows={(payoutsQuery.data?.data ?? []).map((doc) => ({
                ...toJournalRow(doc, pointName, supplierLabel),
                standalonePayout: doc.intake_id === null,
              }))}
              total={payoutsQuery.data?.total ?? 0}
              page={filters.page}
              limit={PAGE_SIZE}
              onPageChange={setPage}
              onRowClick={(row) => payoutReceipt.openReceipt(row.id)}
              rowClickable={(row) => row.standalonePayout === true}
            />
          </TabsContent>
        </ListPage>
      </Tabs>

      <ReceiptDialog
        key={receipt.receiptId}
        intakeId={receipt.receiptId}
        open={receipt.open}
        startWithVoid={receipt.startWithVoid}
        onClose={receipt.close}
      />

      <PayoutReceiptDialog
        key={`payout-${payoutReceipt.receiptId}`}
        payoutId={payoutReceipt.receiptId}
        open={payoutReceipt.open}
        onClose={payoutReceipt.close}
      />
    </>
  );
}

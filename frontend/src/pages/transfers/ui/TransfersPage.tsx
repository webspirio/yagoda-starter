import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ListPage } from '@/shared/ui/templates/list-page';
import { StatGrid } from '@/shared/ui/stat-grid';
import { StatTile } from '@/shared/ui/stat-tile';
import { Spinner } from '@/shared/ui/spinner';
import { sum, cmp, formatUah } from '@/shared/lib/money';
import { usePointCashQuery } from '@/entities/point-cash';
import { useTransfersQuery, type Transfer } from '@/entities/transfer';
import { usePointOptionsQuery } from '@/entities/collection-point';
import { SendTransferDialog } from '@/features/send-transfer';
import { ResolveTransferDialog } from '@/features/resolve-transfer';
import { VoidDocumentDialog } from '@/features/void-document';
import { PointDebtTable } from './PointDebtTable';
import { TransferHistory } from './TransferHistory';

/**
 * «Перекази» — the owner's view of money in flight and what each point is
 * short (§7.10, §7.9). OWNER-ONLY, and that is a ROUTE-level gate (Task 21's
 * `RequireRole`), not a check made here: this page reads no `me`/role at all,
 * so it never needs to remember to hide a button for an operator — there is
 * nothing role-conditional in this tree to forget.
 *
 * ONE `useTransfersQuery({})` READ SERVES TWO JOBS, deliberately not two
 * separate calls: `TransferHistory` renders it as the document log, and the
 * same array is filtered client-side to `status === 'disputed'` so
 * `PointDebtTable` can hand `ResolveTransferDialog` a full `Transfer` (id
 * included) for whichever point's `latest_transfer` names a dispute — the
 * `GET /point-cash` row itself carries only `{ status, sent_at }`, no id.
 *
 * RULE 4 — this read is never given `includeVoided: true`. A voided
 * transfer stopped counting toward any point's cash (§9.3); showing it in
 * the working history or matching it into a resolve action would be the
 * exact quiet-untruth this page's honesty rules exist to prevent.
 */
export function TransfersPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;

  const pointCash = usePointCashQuery();
  const transfers = useTransfersQuery({});
  const { data: points } = usePointOptionsQuery();

  // Each dialog keeps its own {target, open, key} triple — the same shape
  // `PointCashPage`/`DebtsPage`/`SupplierCardPage` use: `target` stays set
  // after a close (so the wrapper below never unmounts the dialog once
  // opened once), `open` toggles it so the Dialog's own close animation gets
  // to play, and `key` forces a remount on the NEXT open so a different
  // document's props don't leak in as stale React Hook Form defaults.
  const [sendTarget, setSendTarget] = useState<{ pointId: string; pointName: string } | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendKey, setSendKey] = useState(0);

  const [resolveTarget, setResolveTarget] = useState<Transfer | null>(null);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveKey, setResolveKey] = useState(0);

  const [voidTarget, setVoidTarget] = useState<Transfer | null>(null);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidKey, setVoidKey] = useState(0);

  const openSend = (pointId: string, pointName: string) => {
    setSendTarget({ pointId, pointName });
    setSendKey((k) => k + 1);
    setSendOpen(true);
  };
  const openResolve = (transfer: Transfer) => {
    setResolveTarget(transfer);
    setResolveKey((k) => k + 1);
    setResolveOpen(true);
  };
  const openVoid = (transfer: Transfer) => {
    setVoidTarget(transfer);
    setVoidKey((k) => k + 1);
    setVoidOpen(true);
  };

  const isPending = pointCash.isPending || transfers.isPending;
  const isError = pointCash.isError || transfers.isError;

  const rows = useMemo(() => pointCash.data?.data ?? [], [pointCash.data]);
  const allTransfers = useMemo(() => transfers.data?.data ?? [], [transfers.data]);
  const disputedTransfers = useMemo(
    () => allTransfers.filter((tr) => tr.status === 'disputed'),
    [allTransfers],
  );
  const pointName = useMemo(
    () => new Map((points ?? []).map((p) => [p.id, p.name])),
    [points],
  );

  // RULE 1 — a point with no target (`shortfall: null`) is deliberately
  // absent from this sum, not counted as owing 0. A settled/overfunded point
  // (`shortfall <= 0`) is excluded too — the network does not owe it
  // anything either. Built with an explicit loop rather than
  // `filter().map()` so the `!= null` check actually narrows the string
  // pushed into `owed`, instead of needing a cast to satisfy `sum`.
  const owed: string[] = [];
  for (const row of rows) {
    if (row.shortfall != null && cmp(row.shortfall, '0') === 1) owed.push(row.shortfall);
  }
  const totalOwed = sum(owed);

  // Transfers carry no human-readable code (unlike an intake's or payout's
  // receipt number) — this composes one for the void confirmation's title
  // from what a person would actually use to recognise the document: how
  // much, and to which point.
  const voidCode = (transfer: Transfer): string =>
    `${formatUah(transfer.cash, locale)} · ${pointName.get(transfer.collection_point_id) ?? transfer.collection_point_id}`;

  return (
    <>
      <ListPage
        eyebrow={t('transfers.eyebrow')}
        title={t('transfers.title')}
        description={t('transfers.description')}
        stats={
          <StatGrid columns={2}>
            <StatTile
              label={t('transfers.tiles.totalOwed')}
              value={formatUah(totalOwed, locale)}
              tone="amber"
            />
          </StatGrid>
        }
      >
        {isPending ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : isError ? (
          <p role="alert" className="py-6 text-center text-destructive">
            {t('common.somethingWentWrong')}
          </p>
        ) : (
          <div className="flex flex-col gap-5">
            <PointDebtTable
              rows={rows}
              disputedTransfers={disputedTransfers}
              onSend={openSend}
              onResolve={openResolve}
            />
            <TransferHistory
              transfers={allTransfers}
              pointName={(id) => pointName.get(id) ?? id}
              onVoid={openVoid}
            />
          </div>
        )}
      </ListPage>

      {sendTarget ? (
        <SendTransferDialog
          key={sendKey}
          pointId={sendTarget.pointId}
          pointName={sendTarget.pointName}
          open={sendOpen}
          onClose={() => setSendOpen(false)}
        />
      ) : null}

      {resolveTarget ? (
        <ResolveTransferDialog
          key={resolveKey}
          transfer={resolveTarget}
          open={resolveOpen}
          onClose={() => setResolveOpen(false)}
        />
      ) : null}

      {voidTarget ? (
        <VoidDocumentDialog
          key={voidKey}
          kind="transfer"
          id={voidTarget.id}
          code={voidCode(voidTarget)}
          open={voidOpen}
          onClose={() => setVoidOpen(false)}
        />
      ) : null}
    </>
  );
}

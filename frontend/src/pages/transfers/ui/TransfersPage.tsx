import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ListPage } from '@/shared/ui/templates/list-page';
import { StatGrid } from '@/shared/ui/stat-grid';
import { StatTile } from '@/shared/ui/stat-tile';
import { Spinner } from '@/shared/ui/spinner';
import { sum, cmp, formatUah } from '@/shared/lib/money';
import { usePointCashQuery } from '@/entities/point-cash';
import { useTransfersQuery, type Transfer } from '@/entities/transfer';
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
 * same array is filtered client-side to `status === 'disputed' &&
 * resolved_at === null` so `PointDebtTable` can hand `ResolveTransferDialog`
 * a full `Transfer` (id included) for whichever point still has an open
 * dispute — the `GET /point-cash` row itself carries only
 * `{ status, sent_at }`, no id and no `resolved_at`.
 *
 * RULE 4 — this read is never given `includeVoided: true`. A voided
 * transfer stopped counting toward any point's cash (§9.3); showing it in
 * the working history or matching it into a resolve action would be the
 * exact quiet-untruth this page's honesty rules exist to prevent.
 *
 * POINT NAMES COME FROM `pointCash.data`, NEVER FROM `usePointOptionsQuery`
 * (fix round 1, findings 1+2). That entity hook is `include_inactive: false`
 * — right for a picker that must not offer a retired point as a new
 * assignment, wrong here: `point-cash.service.ts`'s own doc comment says a
 * deactivated point KEEPS ITS ROW in `GET /point-cash` on purpose ("hiding
 * the row would blind the owner to real money … a person must not vanish
 * from the debts list because their card was retired"). Sourcing the name
 * map from `usePointOptionsQuery` instead would render a raw UUID —
 * permanently — for any point retired mid-season, in `TransferHistory`'s
 * point column and in the void dialog's title. It also dropped a whole
 * query: `pointCash.data` already carries `.name` on every row, so there is
 * nothing left for `usePointOptionsQuery` to add, and no third `isPending`
 * to forget gating on (finding 2 — the old third query's loading state was
 * never checked, so a name could flash as a UUID before it resolved).
 */
export function TransfersPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;

  const pointCash = usePointCashQuery();
  const transfers = useTransfersQuery({});

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
  // Only a dispute nobody has closed yet is actionable — see this
  // component's own doc comment (fix round 1, finding 4) for why `status`
  // alone is not enough.
  const unresolvedDisputes = useMemo(
    () => allTransfers.filter((tr) => tr.status === 'disputed' && tr.resolved_at === null),
    [allTransfers],
  );
  // §7.10 — every point in scope, deactivated ones included: see this
  // component's own doc comment (fix round 1, findings 1+2) for why this is
  // NOT `usePointOptionsQuery`.
  const pointName = useMemo(
    () => new Map(rows.map((r) => [r.collection_point_id, r.name])),
    [rows],
  );
  // Finding 3 — `useTransfersQuery({})` is unscoped across the WHOLE
  // network at its default `limit: 100`, the first such use in this
  // codebase (every other caller scopes by point, where 100 is never
  // reached). Missing rows here are worse than a short list: an older
  // still-open dispute at a quieter point can fall outside the top 100 and
  // silently lose its «Вирішити» button, which reads exactly like "nothing
  // to resolve". `DebtsPage.tsx`'s own `total > rows.length` convention
  // names the gap instead of hiding it — deliberately NOT fixed by paging
  // to completion, which would turn one screen's load into an unbounded
  // fetch.
  const transfersTruncated = transfers.data ? transfers.data.total > transfers.data.data.length : false;

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
            {transfersTruncated ? (
              <p className="text-xs text-muted-foreground">{t('transfers.truncatedHint')}</p>
            ) : null}
            <PointDebtTable
              rows={rows}
              unresolvedDisputes={unresolvedDisputes}
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

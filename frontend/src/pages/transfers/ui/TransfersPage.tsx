import { useCallback, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { isTruncated } from '@/shared/api';
import { ListPage } from '@/shared/ui/templates/list-page';
import { StatGrid } from '@/shared/ui/stat-grid';
import { StatTile } from '@/shared/ui/stat-tile';
import { Spinner } from '@/shared/ui/spinner';
import { TraceScope, TraceTerm } from '@/shared/ui/trace';
import { sum, cmp, isZero, formatUah } from '@/shared/lib/money';
import { usePointCashQuery } from '@/entities/point-cash';
import { usePointOptionsQuery } from '@/entities/collection-point';
import { useTransfersQuery, type Transfer } from '@/entities/transfer';
import { SendTransferDialog } from '@/features/send-transfer';
import { ResolveTransferDialog } from '@/features/resolve-transfer';
import { VoidDocumentDialog } from '@/features/void-document';
import { PointDebtTable } from './PointDebtTable';
import { TransferHistory } from './TransferHistory';

/** This page's three dialogs are never open at once — one target, one kind. */
type DialogTarget =
  | { kind: 'send'; pointId: string; pointName: string }
  | { kind: 'resolve'; transfer: Transfer }
  | { kind: 'void'; transfer: Transfer };

/**
 * «Перекази» — the owner's view of money in flight and what each point is
 * short (§7.10, §7.9). OWNER-ONLY, and that is a ROUTE-level gate (Task 21's
 * `RequireRole`), not a check made here: this page reads no `me`/role at all,
 * so it never needs to remember to hide a button for an operator — there is
 * nothing role-conditional in this tree to forget.
 *
 * THREE TRANSFER READS, each for one job (audit 2026-10-24, C10/C4):
 *   - `useTransfersQuery({})` — `TransferHistory`'s document log, the newest
 *     100 across the network;
 *   - `{ status: 'disputed' }` — every dispute, so `PointDebtTable` can hand
 *     `ResolveTransferDialog` a full `Transfer` (id included) for EVERY open
 *     one (#76). It used to be filtered out of the history page above, where
 *     an older open dispute fell off the newest-100 cut and lost its
 *     «Вирішити» (Конищів had 3, the page showed 2);
 *   - `{ status: 'sent' }` — money on the road, summed per point with `sum`
 *     for «з них … уже в дорозі» under each shortfall.
 * The `GET /point-cash` row itself carries only `latest_transfer: { status,
 * sent_at, resolved_at }` — no id, and only the point's latest transfer.
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
  const disputed = useTransfersQuery({ status: 'disputed' });
  const sent = useTransfersQuery({ status: 'sent' });
  // ACTIVE points, for one thing only: hiding a retired point that has
  // nothing left to say (below). Names still come from `pointCash` rows.
  const activePoints = usePointOptionsQuery();

  // One dialog target for all three actions — never open at once, so one
  // `{ kind, ... }` union replaces three parallel `{ target, open, key }`
  // triples. No remount counter: each dialog below is rendered ONLY while
  // its own `kind` is active — the way `IncomingTransfers.tsx`/
  // `CashCountHistory.tsx` (`pages/point-cash`) already render their single
  // dialog — so it unmounts on close, and every open is therefore already a
  // fresh mount; a bumped `key` would force a second, needless one.
  const [dialogTarget, setDialogTarget] = useState<DialogTarget | null>(null);

  const openSend = (pointId: string, pointName: string) => {
    setDialogTarget({ kind: 'send', pointId, pointName });
  };
  const openResolve = (transfer: Transfer) => {
    setDialogTarget({ kind: 'resolve', transfer });
  };
  // `useCallback` (empty deps — `setDialogTarget` is a stable setter) so
  // `TransferHistory`'s own `useMemo`, keyed in part on this `onVoid` prop,
  // actually memoizes instead of recomputing its columns on every render off
  // a fresh function identity.
  const openVoid = useCallback((transfer: Transfer) => {
    setDialogTarget({ kind: 'void', transfer });
  }, []);
  const closeDialog = () => setDialogTarget(null);

  const isPending =
    pointCash.isPending || transfers.isPending || disputed.isPending || sent.isPending;
  const isError = pointCash.isError || transfers.isError || disputed.isError || sent.isError;

  const allRows = useMemo(() => pointCash.data?.data ?? [], [pointCash.data]);
  const allTransfers = useMemo(() => transfers.data?.data ?? [], [transfers.data]);
  // Only a dispute nobody has closed yet is actionable — see this
  // component's own doc comment (fix round 1, finding 4) for why `status`
  // alone is not enough.
  const unresolvedDisputes = useMemo(
    () =>
      (disputed.data?.data ?? []).filter(
        (tr) => tr.status === 'disputed' && tr.resolved_at === null,
      ),
    [disputed.data],
  );
  // C4 — Σ of what is on the road to each point, through `sum`.
  const inTransit = useMemo(() => {
    const byPoint = new Map<string, string[]>();
    for (const tr of sent.data?.data ?? []) {
      if (tr.status !== 'sent') continue;
      const list = byPoint.get(tr.collection_point_id);
      if (list) list.push(tr.cash);
      else byPoint.set(tr.collection_point_id, [tr.cash]);
    }
    return new Map([...byPoint].map(([id, cash]) => [id, sum(cash)]));
  }, [sent.data]);
  // C10 — a retired point is hidden once it has nothing left to say: no cash,
  // no open dispute, nothing on the road. One that still holds or is owed
  // money stays — `point-cash.service.ts` keeps its row for exactly that.
  // Until the active list arrives (or if it fails) nothing is hidden.
  const rows = useMemo(() => {
    const active = activePoints.data ? new Set(activePoints.data.map((p) => p.id)) : null;
    if (active === null) return allRows;
    const disputedPoints = new Set(unresolvedDisputes.map((tr) => tr.collection_point_id));
    return allRows.filter(
      (r) =>
        active.has(r.collection_point_id) ||
        !isZero(r.cash) ||
        disputedPoints.has(r.collection_point_id) ||
        inTransit.has(r.collection_point_id),
    );
  }, [allRows, activePoints.data, unresolvedDisputes, inTransit]);
  // §7.10 — every point in scope, deactivated ones included: see this
  // component's own doc comment (fix round 1, findings 1+2) for why this is
  // NOT `usePointOptionsQuery`.
  const pointName = useMemo(
    () => new Map(allRows.map((r) => [r.collection_point_id, r.name])),
    [allRows],
  );
  // `useCallback`, keyed on the `pointName` map above, so `TransferHistory`'s
  // own `useMemo` (also keyed in part on this prop) actually memoizes rather
  // than recomputing its columns on every render off a fresh arrow-function
  // identity.
  const lookupPointName = useCallback((id: string) => pointName.get(id) ?? id, [pointName]);
  // Finding 3 — `useTransfersQuery({})` is unscoped across the WHOLE
  // network at its default `limit: 100`, so the HISTORY can be a partial
  // page; it says so rather than read as the whole log. Open disputes no
  // longer depend on it (their own `status: 'disputed'` read, C10), so the
  // cut costs no «Вирішити». Deliberately NOT paged to completion, which
  // would turn one screen's load into an unbounded fetch.
  const transfersTruncated = isTruncated(transfers.data);

  // RULE 1 — a point with no target (`shortfall: null`) is deliberately
  // absent from this sum, not counted as owing 0. A settled/overfunded point
  // (`shortfall <= 0`) is excluded too — the network does not owe it
  // anything either. Built with an explicit loop rather than
  // `filter().map()` so the `!= null` check actually narrows the string
  // pushed into `owed`, instead of needing a cast to satisfy `sum`.
  const owed: string[] = [];
  // …and of that, what is already on the road — capped per point at what the
  // point is owed, so «з них» never exceeds the whole.
  const owedOnTheRoad: string[] = [];
  for (const row of rows) {
    if (row.shortfall != null && cmp(row.shortfall, '0') === 1) {
      owed.push(row.shortfall);
      const road = inTransit.get(row.collection_point_id);
      if (road) owedOnTheRoad.push(cmp(road, row.shortfall) === 1 ? row.shortfall : road);
    }
  }
  const totalOwed = sum(owed);
  const totalOnTheRoad = sum(owedOnTheRoad);

  // Transfers carry no human-readable code (unlike an intake's or payout's
  // receipt number) — this composes one for the void confirmation's title
  // from what a person would actually use to recognise the document: how
  // much, and to which point.
  const voidCode = (transfer: Transfer): string =>
    `${formatUah(transfer.cash, locale)} · ${pointName.get(transfer.collection_point_id) ?? transfer.collection_point_id}`;

  return (
    <>
      {/* One trace scope: the tile's figures light the table rows they sum. */}
      <TraceScope>
        <ListPage
          eyebrow={t('transfers.eyebrow')}
          title={t('transfers.title')}
          description={t('transfers.description')}
          stats={
            <StatGrid columns={2}>
              <StatTile
                label={t('transfers.tiles.totalOwed')}
                // Σ of the owed rows' «Не вистачає» — pointing at it lights them
                // (`debt:owed`, `PointDebtTable`), as the «з них» figure lights
                // their «у дорозі» lines.
                value={
                  <TraceTerm refs="debt:owed" tone="amber" hint={t('transfers.tiles.traceOwed')}>
                    {formatUah(totalOwed, locale)}
                  </TraceTerm>
                }
                tone="amber"
                // Same truncation-honesty convention as `DebtsPage`'s own
                // equivalent tile: `rows` is `pointCash.data.data`, capped at
                // `limit: 100` with no paging (`usePointCash.ts`). A network
                // with more than 100 points would otherwise sum only the first
                // page and print that as if it were the whole network's total.
                hint={
                  isTruncated(pointCash.data) ? (
                    t('transfers.tiles.totalOwedHint', { count: rows.length })
                  ) : !isZero(totalOnTheRoad) ? (
                    <Trans
                      t={t}
                      i18nKey="transfers.tiles.onTheRoad"
                      values={{ uah: formatUah(totalOnTheRoad, locale) }}
                      components={{
                        road: (
                          <TraceTerm
                            refs="debt:road"
                            tone="amber"
                            hint={t('transfers.tiles.traceRoad')}
                          />
                        ),
                      }}
                    />
                  ) : undefined
                }
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
                inTransit={inTransit}
                onSend={openSend}
                onResolve={openResolve}
              />
              <TransferHistory
                transfers={allTransfers}
                pointName={lookupPointName}
                onVoid={openVoid}
                onResolve={openResolve}
              />
            </div>
          )}
        </ListPage>
      </TraceScope>

      {dialogTarget?.kind === 'send' ? (
        <SendTransferDialog
          pointId={dialogTarget.pointId}
          pointName={dialogTarget.pointName}
          open
          onClose={closeDialog}
        />
      ) : null}

      {dialogTarget?.kind === 'resolve' ? (
        <ResolveTransferDialog transfer={dialogTarget.transfer} open onClose={closeDialog} />
      ) : null}

      {dialogTarget?.kind === 'void' ? (
        <VoidDocumentDialog
          kind="transfer"
          id={dialogTarget.transfer.id}
          code={voidCode(dialogTarget.transfer)}
          open
          onClose={closeDialog}
        />
      ) : null}
    </>
  );
}

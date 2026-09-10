import { useTranslation } from 'react-i18next';
import { Send, HandCoins } from 'lucide-react';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { PendingSlice } from '@/shared/ui/pending-slice';
import { cn } from '@/shared/lib/cn';
import { cmp, formatUah } from '@/shared/lib/money';
import type { PointCashRow } from '@/entities/point-cash';
import type { Transfer } from '@/entities/transfer';
import { TransferStatusBadge } from './TransferStatusBadge';

/**
 * §7.10's table, one row per point: наділ · у касі · не хватає · ящиків ·
 * стан. `GET /point-cash` gives every column except crates.
 *
 * RULE 1 — `target_cash`/`shortfall` are `null` = «не призначали», NEVER
 * `0.00` (§6.9, §7.10): both branch on `== null` explicitly and print «—»,
 * a point never silently reads as fully-funded or debt-free.
 *
 * RULE 2 — the crates cell is a `PendingSlice` (`variant="inline"`), never
 * an em dash: «—» already means «no target» in the column right next to it,
 * and never a bare `0 ящ.`, which would be a claim this backend cannot make
 * (no crate tables exist yet).
 *
 * RULE 3 — «Вирішити» renders only when the point's LATEST transfer is
 * `disputed`. `GET /point-cash` names that transfer only by
 * `{ status, sent_at }` (no id), so resolving it needs the full `Transfer`
 * looked up from `disputedTransfers` — matched by point AND `sent_at`
 * (not merely status) so an OLDER dispute at the same point, left
 * permanently `disputed` because `resolve()` never touches `status`
 * (transfers.service.ts), is never mistaken for the one this row's badge
 * is actually about.
 */
export function PointDebtTable({
  rows,
  disputedTransfers,
  onSend,
  onResolve,
}: {
  rows: PointCashRow[];
  /** Non-voided transfers with `status: 'disputed'`, from the SAME
   *  `useTransfersQuery` read the page also uses for its history —
   *  never a per-row query (`points.map(useX)` would break rules-of-hooks). */
  disputedTransfers: Transfer[];
  onSend: (pointId: string, pointName: string) => void;
  onResolve: (transfer: Transfer) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;

  const findDisputed = (row: PointCashRow): Transfer | undefined =>
    disputedTransfers.find(
      (tr) =>
        tr.collection_point_id === row.collection_point_id &&
        tr.sent_at === row.latest_transfer?.sent_at,
    );

  const columns: Column<PointCashRow>[] = [
    {
      id: 'point',
      header: t('transfers.col.point'),
      cell: (row) => <span className="font-medium">{row.name}</span>,
    },
    {
      id: 'target',
      header: t('transfers.col.target'),
      align: 'right',
      className: 'font-mono tabular-nums',
      cell: (row) => (row.target_cash == null ? '—' : formatUah(row.target_cash, locale)),
    },
    {
      id: 'cash',
      header: t('transfers.col.cash'),
      align: 'right',
      className: 'font-mono tabular-nums',
      cell: (row) => formatUah(row.cash, locale),
    },
    {
      id: 'shortfall',
      header: t('transfers.col.shortfall'),
      align: 'right',
      className: 'font-mono font-semibold tabular-nums',
      // Same tone convention as «Каса точки»'s own shortfall tile: owed
      // (> 0) reads amber, settled (<= 0) reads leaf — a null stays the
      // default text colour, since «—» is not a value to colour-code.
      cell: (row) =>
        row.shortfall == null ? (
          '—'
        ) : (
          <span className={cn(cmp(row.shortfall, '0') === 1 ? 'text-amber' : 'text-leaf')}>
            {formatUah(row.shortfall, locale)}
          </span>
        ),
    },
    {
      id: 'crates',
      header: t('transfers.col.crates'),
      align: 'right',
      cell: () => (
        <PendingSlice
          label={t('transfers.crates.label')}
          note={t('transfers.crates.note')}
          variant="inline"
        />
      ),
    },
    {
      id: 'status',
      header: t('transfers.col.status'),
      align: 'right',
      cell: (row) => {
        const disputed = row.latest_transfer?.status === 'disputed' ? findDisputed(row) : undefined;
        return (
          <div className="flex items-center justify-end gap-2">
            {row.latest_transfer ? <TransferStatusBadge status={row.latest_transfer.status} /> : null}
            {disputed ? (
              <Button size="sm" variant="outline" onClick={() => onResolve(disputed)}>
                <HandCoins className="size-3.5" />
                {t('transfers.resolve')}
              </Button>
            ) : null}
            <Button size="sm" onClick={() => onSend(row.collection_point_id, row.name)}>
              <Send className="size-3.5" />
              {t('transfers.send')}
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <DataTable<PointCashRow>
      columns={columns}
      rows={rows}
      rowKey={(row) => row.collection_point_id}
      empty={<EmptyState title={t('transfers.empty.title')} />}
    />
  );
}

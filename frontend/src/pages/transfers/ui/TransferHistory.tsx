import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Ban, ChevronDown } from 'lucide-react';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { SectionCard } from '@/shared/ui/section-card';
import { cn } from '@/shared/lib/cn';
import { formatUah } from '@/shared/lib/money';
import { formatDateTime } from '@/shared/lib/date';
import type { Transfer } from '@/entities/transfer';
import { TransferStatusBadge } from './TransferStatusBadge';
import { DisputeList } from './DisputeDetails';

/** A disputed document — open or already settled — opens to its details (#76). */
const isDisputed = (row: Transfer) => row.status === 'disputed';

/**
 * The owner's document log for `/transfers` — every DOCUMENT (as opposed to
 * `PointDebtTable`, which is one row per POINT). Reads the same
 * `useTransfersQuery({})` call the page uses to find a disputed transfer's
 * full record, so this list and the badges in the table above never
 * disagree about what «disputed» means.
 *
 * RULE 4 — a voided transfer stops being added to a point's cash (§9.3),
 * and `useTransfersQuery`'s `include_voided` default (`false`) is exactly
 * why: this list is fed by that SAME default read, never overridden to
 * `true`, so a document that stopped counting also stops looking like it
 * still does. Voiding one here simply drops it off this list on the next
 * fetch — the row is not deleted (§9.3, «документ не витирається»), it is
 * still readable at `/transfers/:id`, just not through this working view.
 *
 * A DISPUTED row expands (#76) — via the chevron on its status or a click on
 * the row — to `DisputeDetails`: what the point counted and why, and for a
 * settled one, what it was settled at. An open one carries its own
 * «Вирішити» there when the page passes `onResolve`.
 */
export function TransferHistory({
  transfers,
  pointName,
  onVoid,
  onResolve,
}: {
  transfers: Transfer[];
  pointName: (collectionPointId: string) => string;
  onVoid: (transfer: Transfer) => void;
  /** Settles an OPEN dispute from its expanded row; omitted, no button. */
  onResolve?: (transfer: Transfer) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const [openId, setOpenId] = useState<string | null>(null);
  const toggle = (row: Transfer) => setOpenId((prev) => (prev === row.id ? null : row.id));

  const columns: Column<Transfer>[] = useMemo(
    () => [
      {
        id: 'sent',
        header: t('transfers.history.col.sent'),
        className: 'font-mono text-xs text-muted-foreground',
        // `sent_at` is a full timestamp, not a business-date string —
        // `formatDateTime` goes through plain `Date`/`Intl` in the LOCAL time
        // zone, not `shared/lib/date`'s business-date helpers (which expect
        // `YYYY-MM-DD` and force UTC). One parse of `sent_at` per cell.
        cell: (row) => formatDateTime(row.sent_at, locale),
      },
      {
        id: 'point',
        header: t('transfers.history.col.point'),
        cell: (row) => pointName(row.collection_point_id),
      },
      {
        id: 'cash',
        header: t('transfers.history.col.cash'),
        align: 'right',
        className: 'font-mono tabular-nums',
        cell: (row) => formatUah(row.cash, locale),
      },
      {
        id: 'crates',
        header: t('transfers.history.col.crates'),
        align: 'right',
        className: 'font-mono tabular-nums',
        cell: (row) => row.crates,
      },
      {
        id: 'carrier',
        header: t('transfers.history.col.carrier'),
        hideBelow: 'sm',
        cell: (row) => row.carrier,
      },
      {
        id: 'status',
        header: t('transfers.history.col.status'),
        // `row` is the FULL `Transfer` here, so `resolved_at` tells a settled
        // dispute from an open one (fix round 1, finding 4) — the same field
        // `PointDebtTable` reads off `latest_transfer.resolved_at` since #76.
        cell: (row) => {
          const badge = <TransferStatusBadge status={row.status} resolvedAt={row.resolved_at} />;
          if (!isDisputed(row)) return badge;
          const expanded = openId === row.id;
          return (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={(e) => {
                e.stopPropagation();
                setOpenId(expanded ? null : row.id);
              }}
              className="inline-flex items-center gap-1 rounded-4xl focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {badge}
              <ChevronDown
                aria-hidden="true"
                className={cn('size-4 text-muted-foreground transition-transform', expanded ? undefined : '-rotate-90')}
              />
            </button>
          );
        },
      },
      {
        id: 'action',
        header: <span className="sr-only">{t('transfers.history.col.action')}</span>,
        align: 'right',
        cell: (row) => (
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              onVoid(row);
            }}
          >
            <Ban className="size-3.5" />
            {t('transfers.history.void')}
          </Button>
        ),
      },
    ],
    [t, locale, pointName, onVoid, openId],
  );

  return (
    <SectionCard title={t('transfers.history.title')}>
      <DataTable<Transfer>
        columns={columns}
        rows={transfers}
        rowKey={(row) => row.id}
        onRowClick={toggle}
        rowClickable={isDisputed}
        renderExpanded={(row) =>
          isDisputed(row) && openId === row.id ? (
            <DisputeList
              transfers={[row]}
              label={t('transfers.dispute.listLabel', { point: pointName(row.collection_point_id) })}
              onResolve={onResolve}
            />
          ) : null
        }
        frame={false}
        empty={<EmptyState title={t('transfers.history.empty')} />}
      />
    </SectionCard>
  );
}

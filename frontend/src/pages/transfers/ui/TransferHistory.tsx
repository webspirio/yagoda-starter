import { useTranslation } from 'react-i18next';
import { Ban } from 'lucide-react';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { SectionCard } from '@/shared/ui/section-card';
import { formatUah } from '@/shared/lib/money';
import type { Transfer } from '@/entities/transfer';
import { TransferStatusBadge } from './TransferStatusBadge';

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
 */
export function TransferHistory({
  transfers,
  pointName,
  onVoid,
}: {
  transfers: Transfer[];
  pointName: (collectionPointId: string) => string;
  onVoid: (transfer: Transfer) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;

  const columns: Column<Transfer>[] = [
    {
      id: 'sent',
      header: t('transfers.history.col.sent'),
      className: 'font-mono text-xs text-muted-foreground',
      // `sent_at` is a full timestamp, not a business-date string — it goes
      // through plain `Date`/`Intl`, not `shared/lib/date`'s `formatShortDate`
      // (which expects `YYYY-MM-DD` and throws on anything else).
      cell: (row) =>
        `${new Date(row.sent_at).toLocaleDateString(locale, {
          day: '2-digit',
          month: '2-digit',
        })} · ${new Date(row.sent_at).toLocaleTimeString(locale, {
          hour: '2-digit',
          minute: '2-digit',
        })}`,
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
      // `row` is the FULL `Transfer` here (unlike `PointDebtTable`'s thin
      // `latest_transfer`), so this is the one place that can actually tell
      // a settled dispute from an open one (fix round 1, finding 4).
      cell: (row) => <TransferStatusBadge status={row.status} resolvedAt={row.resolved_at} />,
    },
    {
      id: 'action',
      header: <span className="sr-only">{t('transfers.history.col.action')}</span>,
      align: 'right',
      cell: (row) => (
        <Button size="sm" variant="ghost" onClick={() => onVoid(row)}>
          <Ban className="size-3.5" />
          {t('transfers.history.void')}
        </Button>
      ),
    },
  ];

  return (
    <SectionCard title={t('transfers.history.title')}>
      <DataTable<Transfer>
        columns={columns}
        rows={transfers}
        rowKey={(row) => row.id}
        frame={false}
        empty={<EmptyState title={t('transfers.history.empty')} />}
      />
    </SectionCard>
  );
}

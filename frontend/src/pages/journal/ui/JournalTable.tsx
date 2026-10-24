import { useTranslation } from 'react-i18next';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { Spinner } from '@/shared/ui/spinner';
import { formatShortDate } from '@/shared/lib/date';
import { formatDecimal } from '@/shared/lib/money';
import { cn } from '@/shared/lib/cn';
import { canVoidIntake, type Intake } from '@/entities/intake';
import type { Me } from '@/entities/user';
import { ReceiptVoidButton } from '@/widgets/receipt';

/** One journal row — an `Intake` or a `Payout` reduced to the fields the two
 *  document kinds share, plus the names a bare id doesn't carry (resolved by
 *  the page before this ever renders). */
export interface JournalRow {
  id: string;
  code: string;
  businessDate: string;
  createdAt: string;
  pointName: string;
  supplierLabel: string;
  amount: string;
  voided: boolean;
  reason: string | null;
  /** The receipt behind a receipts-tab row — what `canVoidIntake` reads. */
  intake?: Intake;
  /** A payout-tab row with no receipt behind it — the only payout that has a
   *  document of its own to open. */
  standalonePayout?: boolean;
}

/**
 * The journal's table body: loading/error/empty states, the shared column
 * set (identical for a receipts page and a payouts page — both documents
 * carry the same header shape), and the «Назад»/«Далі» pager. `onRowClick`
 * opens a row's receipt: every receipts-tab row, but on the payouts tab only
 * a standalone payout (`standalonePayout`) — one tied to a receipt is read on
 * that receipt. `onVoid` is receipts-only, the row's «Анулювати», shown where
 * `canVoidIntake(me, row.intake)` holds.
 */
export function JournalTable({
  isPending,
  isError,
  rows,
  total,
  page,
  limit,
  onPageChange,
  codeHeader,
  onRowClick,
  rowClickable,
  me,
  onVoid,
}: {
  isPending: boolean;
  isError: boolean;
  rows: JournalRow[];
  total: number;
  page: number;
  limit: number;
  onPageChange: (page: number) => void;
  /** «Квитанція» on the receipts tab, «Документ» on the payouts tab (audit D9). */
  codeHeader: string;
  onRowClick?: (row: JournalRow) => void;
  rowClickable?: (row: JournalRow) => boolean;
  me?: Me;
  onVoid?: (row: JournalRow) => void;
}) {
  const { t, i18n } = useTranslation();

  if (isPending) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }
  if (isError) {
    return (
      <p role="alert" className="py-6 text-center text-destructive">
        {t('common.somethingWentWrong')}
      </p>
    );
  }
  if (rows.length === 0) {
    return <EmptyState title={t('journal.empty')} />;
  }

  const columns: Column<JournalRow>[] = [
    {
      id: 'date',
      header: t('journal.col.date'),
      className: 'font-mono text-xs text-muted-foreground',
      cell: (r) => formatShortDate(r.businessDate, i18n.language),
    },
    {
      id: 'time',
      header: t('journal.col.time'),
      className: 'font-mono text-xs text-muted-foreground',
      // Local wall clock, not the UTC slice of `createdAt` — a date, not
      // money, so it goes through `Intl` rather than `shared/lib/money`.
      cell: (r) =>
        new Date(r.createdAt).toLocaleTimeString(i18n.language, {
          hour: '2-digit',
          minute: '2-digit',
        }),
    },
    {
      id: 'code',
      header: codeHeader,
      className: 'font-mono',
      cell: (r) => r.code,
    },
    {
      id: 'point',
      header: t('journal.col.point'),
      hideBelow: 'sm',
      cell: (r) => r.pointName,
    },
    {
      id: 'supplier',
      header: t('journal.col.supplier'),
      cell: (r) => r.supplierLabel,
    },
    {
      id: 'amount',
      // The unit lives in the header; a voided sum is struck through — it
      // counts for nothing, and the tiles above already leave it out.
      header: t('journal.col.amount'),
      align: 'right',
      className: 'font-mono tabular-nums whitespace-nowrap',
      cell: (r) => (
        <span className={cn(r.voided && 'text-muted-foreground line-through')}>
          {formatDecimal(r.amount, i18n.language)}
        </span>
      ),
    },
    {
      // Empty for a live row: «—» in every cell of a column only says nothing louder.
      id: 'status',
      header: t('journal.col.status'),
      align: 'right',
      cell: (r) =>
        r.voided ? (
          <Badge variant="secondary" title={r.reason ?? undefined}>
            {t('journal.voided')}
          </Badge>
        ) : null,
    },
  ];
  if (onVoid) {
    columns.push({
      id: 'actions',
      header: <span className="sr-only">{t('journal.col.action')}</span>,
      align: 'right',
      cell: (r) =>
        me && r.intake && canVoidIntake(me, r.intake) ? (
          <ReceiptVoidButton code={r.code} onClick={() => onVoid(r)} />
        ) : null,
    });
  }

  const start = (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);

  return (
    <>
      <DataTable<JournalRow>
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        onRowClick={onRowClick}
        rowClickable={rowClickable}
      />
      <div className="mt-3 flex items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>{t('journal.pagination.range', { from: start, to: end, total })}</span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            {t('journal.pagination.prev')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={end >= total}
            onClick={() => onPageChange(page + 1)}
          >
            {t('journal.pagination.next')}
          </Button>
        </div>
      </div>
    </>
  );
}

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/shared/ui/badge';
import { EmptyState } from '@/shared/ui/empty-state';
import { Spinner } from '@/shared/ui/spinner';
import { formatUah } from '@/shared/lib/money';
import { cn } from '@/shared/lib/cn';
import type { Me } from '@/entities/user';
import { canVoidIntake } from '@/entities/intake';
import { useSuppliersQuery, supplierName } from '@/entities/supplier';
import { ReceiptVoidButton } from '@/widgets/receipt';
import type { DayFeedRow } from '../model/useDayDocuments';

/**
 * «Документи дня» — every receipt and payout the shift on screen wrote, newest
 * first (#221: lifted from «Каса за день»). An intake row opens its receipt
 * and, when `canVoidIntake` allows, offers «Анулювати» beside it; a standalone
 * payout opens its own slip; a payout tied to a receipt is read on that
 * receipt, so it stays a plain row. The dialogs are the page's.
 *
 * No card of its own: the page shows the feed as one tab of a card it owns,
 * beside the recount history.
 */
export function DayFeed({
  me,
  pointId,
  hasShift,
  isToday,
  isLoading,
  isError,
  feed,
  onOpenReceipt,
  onOpenPayoutReceipt,
  quietError = false,
}: {
  me: Me | undefined;
  pointId: string;
  hasShift: boolean;
  isToday: boolean;
  /** The shift or either journal not answered yet. */
  isLoading: boolean;
  isError: boolean;
  feed: DayFeedRow[];
  onOpenReceipt: (id: string, opts?: { void: boolean }) => void;
  onOpenPayoutReceipt: (id: string) => void;
  /** Say the failure WITHOUT `role="alert"` — for a failure some other part of
   *  the page (the shift panel) already announces. */
  quietError?: boolean;
}) {
  const { t, i18n } = useTranslation();
  // §5.1 — every feed row (intake AND payout) carries the supplier's name; the
  // point already scopes the suppliers this feed can possibly reference.
  const suppliers = useSuppliersQuery('', pointId);
  const supplierNameById = useMemo(
    () => new Map((suppliers.data?.data ?? []).map((s) => [s.id, supplierName(s)])),
    [suppliers.data],
  );

  return isError ? (
    <p role={quietError ? undefined : 'alert'} className="py-6 text-center text-destructive">
      {t('common.somethingWentWrong')}
    </p>
  ) : isLoading ? (
    <div className="flex justify-center py-12">
      <Spinner />
    </div>
  ) : !hasShift ? (
    <EmptyState
      title={t(isToday ? 'day.status.noneToday' : 'day.status.none')}
      hint={t('day.feed.noShift')}
    />
  ) : feed.length === 0 ? (
    <EmptyState title={t('day.feed.empty')} />
  ) : (
    // C13 — ONE grid for the whole list: the row and its action column are
    // subgrid tracks, so every amount ends on the same line whether or not
    // the row carries «Анулювати», and the button never sits over a figure.
    // Below `sm` each row is a two-line card: time · kind · code, then the
    // supplier, with the amount on the right of both.
    <ul className="grid grid-cols-[minmax(0,1fr)_auto] divide-y divide-border">
      {feed.map((row) => {
        const rowContent = (
          <>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
              <span className="flex items-center gap-3">
                {/* Local wall clock, not the UTC slice of created_at — the
                    operator reads this against the clock on their own wall. */}
                <span className="font-mono text-xs text-muted-foreground">
                  {new Date(row.at).toLocaleTimeString(i18n.language, {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
                <Badge variant={row.kind === 'intake' ? 'secondary' : 'outline'}>
                  {t(`day.feed.${row.kind}`)}
                </Badge>
                <span className="font-mono">{row.code}</span>
              </span>
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="min-w-0 truncate">
                  {supplierNameById.get(row.supplierId) ?? '—'}
                </span>
                {row.voided ? <span className="shrink-0 text-xs">{t('day.feed.voided')}</span> : null}
              </span>
            </span>
            <span className="shrink-0 whitespace-nowrap font-mono tabular-nums">
              {formatUah(row.amount, i18n.language)}
            </span>
          </>
        );
        const rowClassName = cn(
          'flex min-w-0 items-center gap-3 text-sm',
          row.voided && 'text-muted-foreground line-through',
        );

        return (
          <li
            key={`${row.kind}-${row.id}`}
            className="col-span-2 grid grid-cols-subgrid items-center gap-x-1 py-2.5"
          >
            {row.intake ? (
              // The void action is a SIBLING of the row button, never nested in it.
              <button
                type="button"
                onClick={() => onOpenReceipt(row.id)}
                className={cn(rowClassName, 'text-left')}
              >
                {rowContent}
              </button>
            ) : row.standalonePayout ? (
              <button
                type="button"
                onClick={() => onOpenPayoutReceipt(row.id)}
                className={cn(rowClassName, 'text-left')}
              >
                {rowContent}
              </button>
            ) : (
              <div className={rowClassName}>{rowContent}</div>
            )}
            {/* The action track — empty on rows with nothing to void, so the
                amounts above and below still line up. */}
            <div className="flex justify-end">
              {row.intake && me && canVoidIntake(me, row.intake) ? (
                <ReceiptVoidButton
                  code={row.code}
                  onClick={() => onOpenReceipt(row.id, { void: true })}
                />
              ) : null}
            </div>
            {row.voided && row.reason ? (
              <p className="col-span-2 mt-1 text-xs text-muted-foreground">
                {t('day.feed.voidedReason', { reason: row.reason })}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

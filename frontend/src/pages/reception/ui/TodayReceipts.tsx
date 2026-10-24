import { Receipt } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { formatTime } from '@/shared/lib/date';
import { cmp, formatKg, formatUah } from '@/shared/lib/money';
import { useIntakesQuery } from '@/entities/intake';

/**
 * Today's receipts: every receipt of the CURRENT shift, newest first, each one
 * a way back into its own printable copy — in the «Сьогодні» popover and, as
 * `layout="columns"`, in the card under the reception form (client, 24.10).
 * Reads the same `intakes` journal the day screen does — a saved receipt
 * invalidates that prefix, so this list is the confirmation that the document
 * landed.
 *
 * A row is READ, not recomputed: `net_kg`, `lines_count`, `supplier_name` and
 * `open_amount` all arrive already on the `Intake` header.
 *
 * No «Анулювати» on the row: the receipt it opens already carries one.
 */
export function TodayReceipts({
  shiftId,
  onOpen,
  layout = 'list',
}: {
  shiftId: string | undefined;
  onOpen: (intakeId: string) => void;
  /** `list` packs a row into the 420 px popover; `columns` lines the figures
   *  up in fixed columns across a full-width card. */
  layout?: 'list' | 'columns';
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';
  const intakes = useIntakesQuery({ shiftId });

  const columns = layout === 'columns';
  // An optional cell is always rendered so the columns stay put; in the
  // popover's flex row an empty one is hidden so it adds no gap.
  // Below `sm` the columns fold into a two-line card (a phone cannot hold eight
  // fixed columns), so an empty cell hides there too.
  const optional = columns ? 'text-right empty:hidden sm:empty:inline' : 'empty:hidden';

  const rows = [...(intakes.data?.data ?? [])].sort((a, b) =>
    a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0,
  );

  return (
    <>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t('reception.today.empty')}
        </p>
      ) : (
        <ul className="max-h-[360px] divide-y divide-border overflow-y-auto">
          {rows.map((row) => {
            // The server's open figure (allocations), not amount − paid_amount:
            // older money can close a receipt nothing was handed over with.
            const remainder = row.open_amount;
            const hasRemainder = row.voided_at === null && cmp(remainder, '0') === 1;
            return (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => onOpen(row.id)}
                  className={cn(
                    'w-full min-w-0 items-center py-2 text-left text-sm transition-colors hover:text-brand',
                    columns
                      ? 'flex flex-wrap gap-x-3 gap-y-0.5 sm:grid sm:grid-cols-[3rem_minmax(0,1fr)_6rem_6rem_minmax(0,11rem)_6rem_8rem_1rem] sm:gap-3'
                      : 'flex gap-2',
                    row.voided_at !== null && 'text-muted-foreground line-through',
                  )}
                >
                  <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                    {formatTime(row.created_at, locale)}
                  </span>
                  <span className="min-w-0 flex-1 basis-1/2 truncate">{row.supplier_name}</span>
                  <span className={cn('shrink-0 text-xs text-muted-foreground', optional)}>
                    {row.lines_count > 1
                      ? t('reception.today.positions', { count: row.lines_count })
                      : null}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 font-mono text-xs tabular-nums text-muted-foreground',
                      columns && 'text-right',
                    )}
                  >
                    {formatKg(row.net_kg, locale)}
                  </span>
                  <span className={cn('min-w-0 shrink-0 truncate text-xs text-amber', optional)}>
                    {hasRemainder
                      ? t('reception.today.remainder', { uah: formatUah(remainder, locale) })
                      : null}
                  </span>
                  <span className={cn('shrink-0 text-xs', optional)}>
                    {row.voided_at !== null ? t('reception.today.voided') : null}
                  </span>
                  <span className={cn('shrink-0 font-mono tabular-nums', columns && 'text-right')}>
                    {formatUah(row.amount, locale)}
                  </span>
                  <Receipt className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

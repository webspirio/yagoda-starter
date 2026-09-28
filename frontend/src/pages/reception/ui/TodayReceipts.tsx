import { Receipt } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/shared/ui/badge';
import { Card } from '@/shared/ui/card';
import { Eyebrow } from '@/shared/ui/eyebrow';
import { cn } from '@/shared/lib/cn';
import { formatTime } from '@/shared/lib/date';
import { cmp, formatKg, formatUah, sum } from '@/shared/lib/money';
import { canVoidIntake, useIntakesQuery } from '@/entities/intake';
import type { Me } from '@/entities/user';
import { ReceiptVoidButton } from '@/widgets/receipt';

/**
 * The right column: every receipt of the CURRENT shift, newest first, each one
 * a way back into its own printable copy. Reads the same `intakes` journal the
 * day screen does — a saved receipt invalidates that prefix, so this list is
 * the confirmation that the document landed.
 *
 * A row is READ, not recomputed: `net_kg`, `lines_count`, `supplier_name` and
 * `open_amount` all arrive already on the `Intake` header.
 */
export function TodayReceipts({
  shiftId,
  me,
  onOpen,
}: {
  shiftId: string | undefined;
  me: Me | undefined;
  onOpen: (intakeId: string, options?: { void?: boolean }) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';
  const intakes = useIntakesQuery({ shiftId });

  const rows = [...(intakes.data?.data ?? [])].sort((a, b) =>
    a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0,
  );
  // A voided receipt stays LISTED (struck through, below) but is not one of
  // "today's receipts" any more — the badge and the tonnage count only the
  // live ones.
  const liveRows = rows.filter((row) => row.voided_at === null);
  const liveNetKg = sum(liveRows.map((row) => row.net_kg));

  return (
    <Card className="h-fit p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <Eyebrow className="truncate">{t('reception.today.title')}</Eyebrow>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="secondary">{liveRows.length}</Badge>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {formatKg(liveNetKg, locale)}
          </span>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t('reception.today.empty')}
        </p>
      ) : (
        <ul className="max-h-[560px] divide-y divide-border overflow-y-auto">
          {rows.map((row) => {
            // The server's open figure (allocations), not amount − paid_amount:
            // older money can close a receipt nothing was handed over with.
            const remainder = row.open_amount;
            const hasRemainder = row.voided_at === null && cmp(remainder, '0') === 1;
            return (
              // The void action is a SIBLING of the row button, never nested in it.
              <li key={row.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onOpen(row.id)}
                  className={cn(
                    'flex min-w-0 flex-1 items-center gap-2 py-2 text-left text-sm transition-colors hover:text-brand',
                    row.voided_at !== null && 'text-muted-foreground line-through',
                  )}
                >
                  <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                    {formatTime(row.created_at, locale)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{row.supplier_name}</span>
                  {row.lines_count > 1 ? (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {t('reception.today.positions', { count: row.lines_count })}
                    </span>
                  ) : null}
                  <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                    {formatKg(row.net_kg, locale)}
                  </span>
                  {hasRemainder ? (
                    <span className="shrink-0 text-xs text-amber">
                      {t('reception.today.remainder', { uah: formatUah(remainder, locale) })}
                    </span>
                  ) : null}
                  {row.voided_at !== null ? (
                    <span className="shrink-0 text-xs">{t('reception.today.voided')}</span>
                  ) : null}
                  <span className="shrink-0 font-mono tabular-nums">
                    {formatUah(row.amount, locale)}
                  </span>
                  <Receipt className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </button>
                {me && canVoidIntake(me, row) ? (
                  <ReceiptVoidButton code={row.code} onClick={() => onOpen(row.id, { void: true })} />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

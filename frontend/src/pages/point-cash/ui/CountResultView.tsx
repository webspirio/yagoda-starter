import { useTranslation } from 'react-i18next';
import { CheckCircle2, TriangleAlert } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';
import { LedgerRow } from '@/shared/ui/ledger-row';
import { formatUah, isZero } from '@/shared/lib/money';
import type { CashCount } from '@/entities/cash-count';

/**
 * R4's result view after opening or closing a shift from `ShiftCountPanel` —
 * NOT the recount dialog's own result (that one lives inline inside
 * `features/count-shift/ui/RecountDrawerDialog.tsx`, which cannot import
 * from `pages`). `PointCashPage` owns `resultFor` (`'open' | 'close' | null`)
 * and reads `row` back from the counts query it already fetches for the
 * panel — `mode`/`row` are BOTH required to render anything, deliberately:
 * the 09.09 rule says a discrepancy never blocks the close, so the row this
 * view needs can lag the mutation's own success by one refetch, and
 * rendering ahead of it would either show a stale row or force a
 * setState-in-effect to wait for one. `null` here just means "not yet" —
 * the caller keeps the dialog's `open` gated on the same condition so
 * nothing flashes empty.
 */
export function CountResultView({
  open,
  mode,
  row,
  onClose,
}: {
  open: boolean;
  mode: 'open' | 'close' | null;
  row: CashCount | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;

  if (mode === null || row === null) return null;

  const settled = isZero(row.discrepancy);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === 'open'
              ? t('pointCash.result.opened')
              : settled
                ? t('pointCash.result.closedSettled')
                : t('pointCash.result.closedDiscrepancy', {
                    amount: formatUah(row.discrepancy, locale),
                  })}
          </DialogTitle>
        </DialogHeader>

        <dl className="flex flex-col gap-1">
          <LedgerRow
            label={t('pointCash.result.counted')}
            value={formatUah(row.counted_amount, locale)}
            strong
          />
        </dl>

        {/* Opening carries no discrepancy — §7.3, the first count IS the
            opening balance, nothing to compare it against yet. */}
        {mode === 'close' ? (
          <div>
            <Badge
              variant="outline"
              className={settled ? 'border-leaf/40 text-leaf' : 'border-destructive/40 text-destructive'}
            >
              {settled ? <CheckCircle2 aria-hidden="true" /> : <TriangleAlert aria-hidden="true" />}
              {t('pointCash.result.discrepancy')}
            </Badge>
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" onClick={onClose}>
            {t('pointCash.result.done')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

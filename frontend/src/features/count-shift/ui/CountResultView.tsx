import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, TriangleAlert } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';
import { LedgerRow } from '@/shared/ui/ledger-row';
import { formatUah } from '@/shared/lib/money';
import { discrepancyTone } from '../lib/discrepancyTone';

/**
 * The ONE result view every drawer count ends on — the recount (this
 * feature's own `RecountDrawerDialog`) and `pages/point-cash`'s open/close
 * result alike. It used to be two near-identical components (one per
 * caller) until review folded them into this one: same rows, same pill, same
 * "Done" button, different TITLE and different OPTIONAL bits.
 *
 * Deliberately dumb about WHOSE result this is: `title` and `note` are
 * caller-supplied `ReactNode`s (each caller's own copy, its own i18n
 * namespace — «Перерахунок каси» never changes, but «Зміна закрита...» is
 * computed per row), and `expected`/`discrepancy` are individually optional
 * because a recount shows all three figures while an open/close result shows
 * only `counted` (plus `discrepancy` for a close, never for an open — §7.3,
 * the first count IS the balance, nothing to compare it against yet).
 *
 * Callers gate `open` on having real data (see `RecountDrawerDialog`'s
 * `result` state and `PointCashPage`'s `resultRow`) rather than this
 * component tolerating `null` props — there is nothing honest to render
 * before the row exists, and a dialog that flashes empty is worse than one
 * that simply isn't mounted yet.
 */
export function CountResultView({
  open,
  title,
  counted,
  expected = null,
  discrepancy = null,
  note = null,
  onClose,
}: {
  open: boolean;
  title: ReactNode;
  /** The counted figure — every result shows this one. */
  counted: string;
  /** The recount's own «Очікувано» row — omitted by the open/close result. */
  expected?: string | null;
  /** Renders the «Розбіжність» pill when given; `null` (open) shows no pill at all. */
  discrepancy?: string | null;
  /** An optional line under the pill — the recount's «cannot be changed» note; the close result folds its own equivalent into `title` instead. */
  note?: ReactNode | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const tone = discrepancy === null ? null : discrepancyTone(discrepancy);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <dl className="flex flex-col gap-1">
          {expected !== null ? (
            <LedgerRow label={t('countResult.expected')} value={formatUah(expected, locale)} />
          ) : null}
          <LedgerRow label={t('countResult.counted')} value={formatUah(counted, locale)} strong />
        </dl>

        {tone !== null ? (
          <div>
            <Badge
              variant="outline"
              className={tone === 'leaf' ? 'border-leaf/40 text-leaf' : 'border-destructive/40 text-destructive'}
            >
              {tone === 'leaf' ? (
                <CheckCircle2 aria-hidden="true" />
              ) : (
                <TriangleAlert aria-hidden="true" />
              )}
              {t('countResult.discrepancy')}
            </Badge>
          </div>
        ) : null}

        {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}

        <DialogFooter>
          <Button type="button" onClick={onClose}>
            {t('countResult.done')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

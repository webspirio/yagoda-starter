import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, TriangleAlert } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';
import { LedgerRow } from '@/shared/ui/ledger-row';
import { formatUah } from '@/shared/lib/money';
import { discrepancyTone } from '../lib/discrepancyTone';

interface CountResultBodyProps {
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
}

/**
 * The result's own markup — everything from `DialogHeader` through
 * `DialogFooter`, with no `Dialog`/`DialogContent` of its own. `RecountDrawerDialog`
 * renders this DIRECTLY inside the one `Dialog` it already owns, so opening
 * the result never means mounting a second `Dialog`/overlay beside the
 * first one — see that component's own doc comment for why that used to be
 * a real bug (two `role="dialog"` elements briefly coexisting during the
 * exit/enter animation, review round 3).
 *
 * Deliberately dumb about WHOSE result this is: `title` and `note` are
 * caller-supplied `ReactNode`s (each caller's own copy, its own i18n
 * namespace — «Перерахунок каси» never changes, but «Зміна закрита...» is
 * computed per row), and `expected`/`discrepancy` are individually optional
 * because a recount shows all three figures while an open/close result shows
 * only `counted` (plus `discrepancy` for a close, never for an open — §7.3,
 * the first count IS the balance, nothing to compare it against yet).
 *
 * Callers gate visibility on having real data (see `RecountDrawerDialog`'s
 * `result` state and `PointCashPage`'s `resultRow`) rather than this
 * component tolerating `null` props — there is nothing honest to render
 * before the row exists.
 */
export function CountResultBody({
  title,
  counted,
  expected = null,
  discrepancy = null,
  note = null,
  onClose,
}: CountResultBodyProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const tone = discrepancy === null ? null : discrepancyTone(discrepancy);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>

      {/* Plain rows, not a `<dl>` — `LedgerRow` renders a `div`/`span` pair,
          not a `dt`/`dd` pair, so wrapping it in a description list used to
          be markup for a description list with no descriptions in it
          (review, minor 12). */}
      <div className="flex flex-col gap-1">
        {expected !== null ? (
          <LedgerRow label={t('countResult.expected')} value={formatUah(expected, locale)} />
        ) : null}
        <LedgerRow label={t('countResult.counted')} value={formatUah(counted, locale)} strong />
      </div>

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
    </>
  );
}

/**
 * The ONE result view every drawer count ends on for a caller that shows
 * NOTHING else in its own dialog — `PointCashPage`'s open/close result.
 * A thin `Dialog`/`DialogContent` wrapper around `CountResultBody` above;
 * `RecountDrawerDialog` renders `CountResultBody` directly instead of this,
 * because it already owns a `Dialog` whose body swaps between the form and
 * the result rather than opening a second one.
 */
export function CountResultView({
  open,
  onClose,
  ...body
}: { open: boolean; onClose: () => void } & Omit<CountResultBodyProps, 'onClose'>) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <CountResultBody {...body} onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}

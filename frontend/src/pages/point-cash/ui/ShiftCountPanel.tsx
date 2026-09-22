import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calculator, CheckCircle2, TriangleAlert } from 'lucide-react';
import { SectionCard } from '@/shared/ui/section-card';
import { LedgerRow } from '@/shared/ui/ledger-row';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Spinner } from '@/shared/ui/spinner';
import { formatUah } from '@/shared/lib/money';
import { formatTime } from '@/shared/lib/date';
import type { Shift } from '@/entities/shift';
import type { CashCount } from '@/entities/cash-count';
import { RecountDrawerDialog, discrepancyTone } from '@/features/count-shift';

/**
 * The action states (R4), in the order the mock lists them. Computed once
 * from `shift`/`isToday` rather than as independent booleans, so the panel
 * can never show two of them at once — the OWNER never sees any of them
 * (`isOperator` gates the whole block, not each branch).
 *
 *   - `openToday`   — an open shift, and it is today's: recount + close.
 *   - `closed`      — any shift whose `status !== 'open'`, ANY date: the
 *                     settled note, no buttons. This covers the legacy
 *                     `awaiting_explanation` value too — the 09.09 rule
 *                     retired that branch (a discrepancy never blocks
 *                     anything, `ShiftStatus`'s own doc comment), so any row
 *                     still carrying it from before that decision reads
 *                     exactly like `closed` rather than falling through to
 *                     nothing.
 *   - `noneToday`   — no shift at all, but the date on screen is today: open.
 *   - `openPastDay` — an open shift left over from a date that is no longer
 *                     today. R4 only promises live actions "today", so there
 *                     is no button — but unlike `other` below, the shift
 *                     itself IS real: its own line still renders, with a
 *                     note that its actions live on its own day, not a
 *                     generic "no shift" claim that would misdescribe it.
 *   - `other`       — the genuine no-shift case on a date that is not today:
 *                     nothing to attach a recount to.
 */
type PanelActionState = 'openToday' | 'closed' | 'noneToday' | 'openPastDay' | 'other';

function panelActionState(shift: Shift | null, isToday: boolean): PanelActionState {
  if (isToday && shift?.status === 'open') return 'openToday';
  if (shift && shift.status !== 'open') return 'closed';
  if (isToday && shift === null) return 'noneToday';
  if (shift?.status === 'open') return 'openPastDay';
  return 'other';
}

function DiscrepancyPill({ discrepancy }: { discrepancy: string }) {
  const { t } = useTranslation();
  const tone = discrepancyTone(discrepancy);
  return (
    <Badge
      variant="outline"
      className={tone === 'leaf' ? 'border-leaf/40 text-leaf' : 'border-destructive/40 text-destructive'}
    >
      {tone === 'leaf' ? <CheckCircle2 aria-hidden="true" /> : <TriangleAlert aria-hidden="true" />}
      {t('pointCash.panel.discrepancy')}
    </Badge>
  );
}

/**
 * «Зміна і перерахунок каси» (R4) — the shift's own line (open/closed, its
 * times, who closed it, the owner's explanation if any), the day's opening
 * and closing counts, the day's midday recounts, and the operator's actions.
 *
 * `counts` is the RAW `GET /cash-counts?shift_id=` page — narrowed to the
 * berry book and sorted by `counted_at` HERE (not by the caller), so the
 * fixtures a test hands this component can include a stray crates-book or
 * out-of-order row and still exercise the real filter/sort, the same way
 * `PointCashPage` already lets `CashLedger`/`buildLedger` own their own
 * derivations rather than pre-chewing them.
 *
 * Opening/closing/recounting a shift all live at the PAGE level
 * (`PointCashPage` owns `CountDrawerDialog` and `CountResultView`'s
 * `resultFor` state — see its own doc comment) because their result has to
 * be read back from a query this panel does not own. The midday recount is
 * the one action with no cross-cutting result to track, so it is
 * self-contained here: `RecountDrawerDialog` shows its own result and needs
 * nothing back from this panel beyond being opened.
 */
export function ShiftCountPanel({
  shift,
  isShiftLoading,
  isShiftError,
  counts,
  isOperator,
  isToday,
  onOpenShift,
  onCloseShift,
}: {
  shift: Shift | null;
  isShiftLoading: boolean;
  /**
   * `shift.isError || shiftCashCounts.isError` — a FAILED read is not «no
   * shift». Both reads settle to `data: undefined` on failure, which the
   * page turns into `shift ?? null` / an empty `counts` array — exactly the
   * shape a genuinely shift-less day has. Without this flag the panel would
   * silently offer an operator «Відкрити зміну» over a shift it never
   * actually confirmed doesn't exist (the same failure mode `DayPage`'s own
   * `isError` guards against, and `IncomingTransfers`'s doc comment names
   * directly: "A FAILED READ IS NOT «NOTHING IN TRANSIT»").
   */
  isShiftError: boolean;
  counts: CashCount[];
  isOperator: boolean;
  isToday: boolean;
  onOpenShift: () => void;
  onCloseShift: (shiftId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  // `formatTime` (unlike `formatUah`) takes a required locale — same
  // fallback `IncomingTransfers` uses for the same reason.
  const locale = i18n.resolvedLanguage ?? 'uk';

  const [recountOpen, setRecountOpen] = useState(false);
  // Bumped on every open so the dialog remounts with a blank form and no
  // stale result/banner from the last recount — the convention
  // `CountDrawerDialog`'s own callers already follow (`DayPage`'s `countInstance`).
  const [recountInstance, setRecountInstance] = useState(0);
  const openRecount = () => {
    setRecountInstance((n) => n + 1);
    setRecountOpen(true);
  };

  const berry = counts.filter((c) => c.book === 'berry');
  const opening = berry.find((c) => c.kind === 'opening') ?? null;
  const closing = berry.find((c) => c.kind === 'closing') ?? null;
  const middays = berry
    .filter((c) => c.kind === 'midday')
    .sort((a, b) => (a.counted_at < b.counted_at ? -1 : a.counted_at > b.counted_at ? 1 : 0));

  const state = panelActionState(shift, isToday);

  const timeRange =
    shift === null
      ? null
      : shift.status === 'open'
        ? t('pointCash.panel.since', { from: formatTime(shift.created_at, locale) })
        : shift.closed_at
          ? t('pointCash.panel.sinceUntil', {
              from: formatTime(shift.created_at, locale),
              to: formatTime(shift.closed_at, locale),
            })
          : t('pointCash.panel.since', { from: formatTime(shift.created_at, locale) });

  const actionContent =
    state === 'openToday' && shift ? (
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={openRecount}>
          <Calculator className="size-3.5" aria-hidden="true" />
          {t('pointCash.panel.actions.recount')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => onCloseShift(shift.id)}>
          {t('pointCash.panel.actions.close')}
        </Button>
      </div>
    ) : state === 'closed' ? (
      <p className="text-xs text-muted-foreground">{t('pointCash.panel.actions.closedNote')}</p>
    ) : state === 'noneToday' ? (
      <div className="flex flex-col items-start gap-1">
        <Button size="sm" onClick={onOpenShift}>
          {t('pointCash.panel.actions.open')}
        </Button>
        <p className="text-xs text-muted-foreground">{t('pointCash.panel.actions.openCaption')}</p>
      </div>
    ) : state === 'openPastDay' ? (
      <p className="text-xs text-muted-foreground">{t('pointCash.panel.actions.openPastDayNote')}</p>
    ) : (
      <p className="text-xs text-muted-foreground">{t('pointCash.panel.actions.noShiftNote')}</p>
    );

  return (
    <SectionCard eyebrow={t('pointCash.panel.title')}>
      {isShiftLoading ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : isShiftError ? (
        // No shift line, no midday list, no actions — none of those claims
        // ("no shift today", "you've never recounted") are ones a failed
        // read can honestly make.
        <p role="alert" className="text-sm text-destructive">
          {t('pointCash.shiftPanel.readFailed')}
        </p>
      ) : (
        <>
          {shift ? (
            <div className="flex flex-col gap-1 border-b border-line2 pb-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">
                  {/* Any status other than `open` reads as «Зміна закрита» —
                      including the legacy, otherwise-unreachable
                      `awaiting_explanation` value (`ShiftStatus`'s own doc
                      comment, the 09.09 rule): there is no copy left for it
                      to show, and a settled shift is the honest reading of
                      one either way. */}
                  {t(`pointCash.panel.status.${shift.status === 'open' ? 'open' : 'closed'}`)}
                </span>
                <span className="font-mono text-xs text-muted-foreground">{timeRange}</span>
              </div>

              {opening ? (
                <LedgerRow
                  label={t('pointCash.panel.opening')}
                  value={formatUah(opening.counted_amount, locale)}
                />
              ) : null}
              {closing ? (
                <LedgerRow
                  label={t('pointCash.panel.closing')}
                  value={formatUah(closing.counted_amount, locale)}
                />
              ) : null}
              {closing ? <DiscrepancyPill discrepancy={closing.discrepancy} /> : null}

              {shift.status !== 'open' ? (
                <p className="text-xs text-muted-foreground">
                  {t('pointCash.panel.closedBy', { name: shift.closed_by_name ?? '—' })}
                </p>
              ) : null}

              {shift.explanation ? (
                <p className="text-xs italic text-muted-foreground">
                  {t('pointCash.panel.explanation', { text: shift.explanation })}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5 border-b border-line2 py-3">
            {middays.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('pointCash.panel.recountsEmpty')}</p>
            ) : (
              middays.map((c) => (
                <div key={c.id} className="flex items-baseline justify-between gap-4 text-sm">
                  <span className="flex items-baseline gap-1.5 text-muted-foreground">
                    <span>
                      {t('pointCash.panel.recountAt', { time: formatTime(c.counted_at, locale) })}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span
                      className={
                        discrepancyTone(c.discrepancy) === 'leaf' ? 'text-leaf' : 'text-destructive'
                      }
                    >
                      {discrepancyTone(c.discrepancy) === 'leaf'
                        ? t('pointCash.panel.matched')
                        : t('pointCash.panel.mismatched')}
                    </span>
                  </span>
                  <span className="font-mono tabular-nums">
                    {formatUah(c.counted_amount, locale)}
                  </span>
                </div>
              ))
            )}
          </div>

          {/* §10.3 — opening/closing/recounting a shift is the operator's
              alone; the owner sees this whole block replaced by nothing, not
              a disabled button (same rule §10.2 already applies to the
              target button on this page). */}
          {isOperator ? <div className="pt-3">{actionContent}</div> : null}

          <p className="pt-3 text-xs leading-relaxed text-muted-foreground">
            {t('pointCash.panel.footnote')}
          </p>
        </>
      )}

      <RecountDrawerDialog
        key={`recount-${recountInstance}`}
        open={recountOpen}
        onClose={() => setRecountOpen(false)}
      />
    </SectionCard>
  );
}

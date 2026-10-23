import { Link } from 'react-router';
import { AlertTriangle, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { Eyebrow } from '@/shared/ui/eyebrow';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover';
import { cn } from '@/shared/lib/cn';
import { formatTime } from '@/shared/lib/date';
import { cmp, formatKg, formatUah, sum } from '@/shared/lib/money';
import { isTruncated } from '@/shared/api';
import { usePointCashForPointQuery } from '@/entities/point-cash';
import { useCashCountsQuery } from '@/entities/cash-count';
import { usePayoutsQuery } from '@/entities/payout';
import { useIntakesQuery } from '@/entities/intake';
import { useCrateBalancesQuery } from '@/entities/crate';
import type { Shift } from '@/entities/shift';
import { TodayReceipts } from './TodayReceipts';

type StripShift =
  | { status: 'pending' }
  | { status: 'error' }
  | { status: 'none' }
  | { status: 'open'; shift: Shift };

/**
 * One horizontal strip above the intake form: shift status, the berry drawer,
 * the crates out with people and today's receipts — what the operator would
 * otherwise have to leave the form to look up. The figures come from the SAME
 * reads «Каса точки» and «Ящики» use for themselves: every one is a straight
 * `sum` over the live rows of the same entity reads, never re-derived a
 * different way (a second arithmetic path could silently disagree with the
 * first).
 *
 * A document needs an open shift at the point (§10.3), and only the OPERATOR
 * may open one — so the owner is told whose job it is rather than shown a
 * button the server would refuse.
 */
export function PointStrip({
  pointId,
  shift,
  isOwner,
  canOpen,
  isOpening,
  onOpenShift,
  targetCrates,
  onOpenReceipt,
}: {
  pointId: string;
  shift: StripShift;
  isOwner: boolean;
  canOpen: boolean;
  isOpening: boolean;
  onOpenShift: () => void;
  /** `collection_points.target_crates` — `null` means «не задано», never
   *  zero (see `PointOption`'s own doc for why that distinction matters). */
  targetCrates: number | null;
  onOpenReceipt: (intakeId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';
  const shiftId = shift.status === 'open' ? shift.shift.id : undefined;

  // Not gated on the shift being open (unlike the page's own read for
  // «Видано готівкою») — the drawer has a figure whether or not a shift is
  // open today, and this is the one place on the intake screen that says so.
  const cash = usePointCashForPointQuery(pointId);
  const cashCounts = useCashCountsQuery({ shiftId });
  const payouts = usePayoutsQuery({ shiftId });
  const intakes = useIntakesQuery({ shiftId });
  const balances = useCrateBalancesQuery({ pointId, isOwner });

  const openingBerry = (cashCounts.data?.data ?? []).find(
    (row) => row.kind === 'opening' && row.book === 'berry',
  );
  const paidOut = sum(
    (payouts.data?.data ?? []).filter((row) => row.voided_at === null).map((row) => row.amount),
  );
  // «Відкрито за сьогоднішніми квитанціями» — Σ open_amount over today's LIVE
  // receipts: what is still owed for them now, from allocations. Never
  // negative, unlike amount − paid_amount when cash also closed older debt.
  const liveRows = (intakes.data?.data ?? []).filter((row) => row.voided_at === null);
  const openToday = sum(liveRows.map((row) => row.open_amount));
  const liveNetKg = sum(liveRows.map((row) => row.net_kg));
  // The sums above run over `page.data` — capped at 100 rows, server-side
  // (`Paginated<T>`'s `limit`) — never the whole shift. A busy point can
  // legitimately clear 100 receipts or payouts before close, and without
  // this caption the cell would silently read as the day's true total.
  const paidOutTruncated = isTruncated(payouts.data);
  const todayTruncated = isTruncated(intakes.data);
  // A row COUNT, never money — see `entities/crate`'s header for why the two
  // must not mix.
  const outstanding = (balances.data?.data ?? []).reduce(
    (total, row) => total + row.outstanding_units,
    0,
  );

  const pointCashHref = isOwner ? `/point-cash?point=${pointId}` : '/point-cash';
  const cratesHref = isOwner ? `/crates?point=${pointId}` : '/crates';

  return (
    // One row at `lg` (spec §5.1 budgets the strip one ~56 px row): every
    // cell is a label line over a value line, and what does not fit
    // truncates rather than wrapping. Below `lg` the wrapping grid stays.
    <div className="mb-3 grid gap-x-6 gap-y-2 rounded-xl border border-line2 bg-card px-3 py-2 sm:grid-cols-2 lg:flex lg:flex-nowrap lg:items-center lg:gap-x-4">
      <StatusCell
        shift={shift}
        canOpen={canOpen}
        isOpening={isOpening}
        onOpenShift={onOpenShift}
        locale={locale}
      />

      <Cell
        to={pointCashHref}
        label={t('reception.state.currentCash')}
        value={cash.data ? formatUah(cash.data.cash, locale) : '…'}
        emphasised
      />
      <Cell
        to={pointCashHref}
        label={t('reception.state.paidOut')}
        value={formatUah(paidOut, locale)}
        caption={paidOutTruncated ? t('reception.state.truncatedCaption') : undefined}
      />
      <Cell
        to={pointCashHref}
        label={t('reception.state.openingCash')}
        value={openingBerry ? formatUah(openingBerry.counted_amount, locale) : '—'}
      />
      <Cell
        to={cratesHref}
        label={t('reception.state.crates')}
        value={t('reception.state.cratesValue', {
          out: outstanding,
          target: targetCrates === null ? '—' : targetCrates,
        })}
      />

      <Popover>
        <PopoverTrigger className="min-w-0 rounded-md text-left outline-none hover:text-brand focus-visible:ring-2 focus-visible:ring-ring lg:ml-auto">
          {/* Two lines, never three: the amber «відкрито …» and the
              truncation caption ride on the LABEL line and truncate there. */}
          <span className="flex min-w-0 items-baseline gap-2 leading-4">
            <Eyebrow className="flex shrink-0 items-center gap-1 leading-4 tracking-wide">
              {t('reception.today.trigger')}
              <ChevronDown className="size-3" aria-hidden="true" />
            </Eyebrow>
            {cmp(openToday, '0') === 1 ? (
              <span className="min-w-0 truncate font-mono text-xs font-semibold text-amber">
                {t('reception.today.open', { uah: formatUah(openToday, locale) })}
              </span>
            ) : null}
            {todayTruncated ? (
              <span className="min-w-0 truncate text-[10px] text-muted-foreground">
                {t('reception.state.truncatedCaption')}
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 block truncate font-mono text-sm leading-5 font-semibold">
            {t('reception.today.summary', {
              count: liveRows.length,
              kg: formatKg(liveNetKg, locale),
            })}
          </span>
        </PopoverTrigger>
        <PopoverContent className="w-[420px] max-w-[calc(100vw-2rem)]">
          <Eyebrow className="mb-2 truncate">{t('reception.today.title')}</Eyebrow>
          <TodayReceipts shiftId={shiftId} onOpen={onOpenReceipt} />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function StatusCell({
  shift,
  canOpen,
  isOpening,
  onOpenShift,
  locale,
}: {
  shift: StripShift;
  canOpen: boolean;
  isOpening: boolean;
  onOpenShift: () => void;
  locale: string;
}) {
  const { t } = useTranslation();

  if (shift.status === 'pending') {
    return <div className="text-sm text-muted-foreground">…</div>;
  }
  // A failed read and «no shift» are the same `null` in the data, and an
  // «Open shift» button on the first one lets an operator open a shift that
  // is already open.
  if (shift.status === 'error') {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t('common.somethingWentWrong')}
      </p>
    );
  }
  if (shift.status === 'none') {
    return (
      <div className="flex min-w-0 shrink-0 items-center gap-2">
        <AlertTriangle className="size-4 shrink-0 text-amber" aria-hidden="true" />
        <p className="text-sm font-medium text-amber">
          {canOpen ? t('reception.shift.none') : t('reception.shift.noneOwner')}
        </p>
        {canOpen ? (
          <Button size="sm" onClick={onOpenShift} disabled={isOpening}>
            {t('reception.shift.open')}
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <p className="shrink-0 text-sm font-medium whitespace-nowrap text-success">
      {t('reception.state.shiftOpen', { time: formatTime(shift.shift.created_at, locale) })}
    </p>
  );
}

/** One strip cell, a way back into the screen that actually manages this
 *  state — the operator looks here, acts there. The value arrives already
 *  formatted — nothing here computes. */
function Cell({
  to,
  label,
  value,
  caption,
  emphasised,
}: {
  to: string;
  label: string;
  value: string;
  /** Muted note beside the label — today only «перші 100 документів» when the
   *  sum behind `value` is over a truncated page. */
  caption?: string;
  emphasised?: boolean;
}) {
  return (
    <Link
      to={to}
      className="min-w-0 rounded-md hover:text-brand focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/* The caption shares the label line, so a cell stays two lines. */}
      <div className="flex min-w-0 items-baseline gap-1.5 leading-4">
        <Eyebrow className="min-w-0 truncate leading-4 tracking-wide">{label}</Eyebrow>
        {caption ? (
          <span className="min-w-0 truncate text-[10px] text-muted-foreground">{caption}</span>
        ) : null}
      </div>
      <div
        className={cn(
          'mt-0.5 truncate font-mono leading-none font-semibold tracking-tight',
          emphasised ? 'text-xl' : 'text-sm',
        )}
      >
        {value}
      </div>
    </Link>
  );
}

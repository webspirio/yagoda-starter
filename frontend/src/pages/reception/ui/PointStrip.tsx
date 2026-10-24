import type * as React from 'react';
import { Link } from 'react-router';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Eyebrow } from '@/shared/ui/eyebrow';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover';
import { cn } from '@/shared/lib/cn';
import { add, cmp, formatKg, formatUah, sum } from '@/shared/lib/money';
import { isTruncated } from '@/shared/api';
import { usePointCashForPointQuery } from '@/entities/point-cash';
import { useCashCountsQuery } from '@/entities/cash-count';
import { usePayoutsQuery } from '@/entities/payout';
import { useIntakesQuery } from '@/entities/intake';
import { useCrateBalancesQuery } from '@/entities/crate';
import type { Shift } from '@/entities/shift';
import { TodayReceipts } from './TodayReceipts';

export type StripShift =
  | { status: 'pending' }
  | { status: 'error' }
  | { status: 'none' }
  | { status: 'open'; shift: Shift };

/**
 * One horizontal strip above the intake form: the berry drawer,
 * the crates out with people and today's receipts — what the operator would
 * otherwise have to leave the form to look up. The figures come from the SAME
 * reads «Каса точки» and «Ящики» use for themselves: every one is a straight
 * `sum` over the live rows of the same entity reads, never re-derived a
 * different way (a second arithmetic path could silently disagree with the
 * first).
 *
 * The shift's status is NOT here: it sits in the page header, and a day
 * with no open shift replaces the form itself (`ShiftClosedState`).
 */
export function PointStrip({
  pointId,
  shift,
  isOwner,
  targetCrates,
  onOpenReceipt,
}: {
  pointId: string;
  shift: StripShift;
  isOwner: boolean;
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

  const openTodayText = t('reception.today.open', { uah: formatUah(openToday, locale) });
  const todaySummary = t('reception.today.summary', {
    count: liveRows.length,
    kg: formatKg(liveNetKg, locale),
  });

  const pointCashHref = isOwner ? `/point-cash?point=${pointId}` : '/point-cash';
  const cratesHref = isOwner ? `/crates?point=${pointId}` : '/crates';

  const cashNow = cash.data?.cash ?? null;

  const openingText = openingBerry ? formatUah(openingBerry.counted_amount, locale) : '—';
  const paidOutText = paidOutTruncated
    ? `${t('reception.state.paidOut', { uah: formatUah(paidOut, locale) })} · ${t('reception.state.truncatedCaption')}`
    : t('reception.state.paidOut', { uah: formatUah(paidOut, locale) });
  const cratesAside =
    targetCrates === null
      ? t('reception.state.noTarget')
      : outstanding > targetCrates
        ? t('reception.state.cratesOver', { count: outstanding - targetCrates })
        : t('reception.state.cratesLeft', { count: targetCrates - outstanding });

  return (
    // One compact row at `xl`: two meters (label over «figure + bar») and
    // today's receipts. The shift's own status lives in the page header.
    // Below `xl` the meters sit two to a row, one to a row on a phone.
    <section className="mb-4 rounded-xl border border-line2 bg-card">
      <div className="grid gap-x-6 gap-y-3 px-4 py-2.5 sm:grid-cols-2 xl:flex xl:items-center">
        <Meter
          to={pointCashHref}
          title={t('reception.state.cashTitle')}
          aside={`${paidOutText} · ${t('reception.state.openingCash', { uah: openingText })}`}
          value={cashNow === null ? '…' : formatUah(cashNow, locale)}
          className="xl:flex-[1.4]"
        >
          <CashBar cash={cashNow} paidOut={paidOut} />
        </Meter>

        <Meter
          to={cratesHref}
          title={t('reception.state.crates')}
          aside={cratesAside}
          value={t('reception.state.cratesValue', {
            out: outstanding,
            target: targetCrates === null ? '—' : targetCrates,
          })}
          className="xl:flex-1"
        >
          <CratesBar outstanding={outstanding} target={targetCrates} />
        </Meter>

        <Popover>
          <PopoverTrigger className="min-w-0 rounded-md text-left outline-none hover:text-brand focus-visible:ring-2 focus-visible:ring-ring sm:col-span-2 xl:shrink-0 xl:text-right">
            <span className="flex min-w-0 items-baseline gap-2 leading-4 xl:justify-end">
              <Eyebrow className="flex shrink-0 items-center gap-1 leading-4 tracking-wide">
                {t('reception.today.trigger')}
                <ChevronDown className="size-3" aria-hidden="true" />
              </Eyebrow>
              {cmp(openToday, '0') === 1 ? (
                <span
                  className="min-w-0 truncate font-mono text-xs font-semibold text-amber"
                  title={openTodayText}
                >
                  {openTodayText}
                </span>
              ) : null}
              {todayTruncated ? (
                <span
                  className="min-w-0 truncate text-[10px] text-muted-foreground"
                  title={t('reception.state.truncatedCaption')}
                >
                  {t('reception.state.truncatedCaption')}
                </span>
              ) : null}
            </span>
            <span
              className="mt-1 block truncate font-mono text-sm leading-5 font-semibold"
              title={todaySummary}
            >
              {todaySummary}
            </span>
          </PopoverTrigger>
          <PopoverContent className="w-[420px] max-w-[calc(100vw-2rem)]">
            <Eyebrow className="mb-2 truncate">{t('reception.today.title')}</Eyebrow>
            <TodayReceipts shiftId={shiftId} onOpen={onOpenReceipt} />
          </PopoverContent>
        </Popover>
      </div>
    </section>
  );
}

/** Below this share of the day's berry money left in the drawer, the bar
 *  turns amber: time to bring cash to the point. */
const CASH_LOW_SHARE = 0.2;
/** Above this share of the allotment out with people, the crates bar turns amber. */
const CRATES_HIGH_SHARE = 0.9;

/**
 * A bar WIDTH, never a figure anyone reads: the two decimals are turned into
 * a 0…1 share for `style.width` only, so float rounding here can never reach
 * a number on screen — every printed sum above went through `shared/lib/money`.
 */
function share(part: string, whole: string): number {
  const w = Number(whole);
  if (!(w > 0)) return 0;
  return Math.min(1, Math.max(0, Number(part) / w));
}

/** A label line (title left, a muted note right) over the figure and its bar
 *  on ONE line — two lines in all. Each meter links to the screen that
 *  manages it: the operator looks here, acts there. */
function Meter({
  to,
  title,
  aside,
  value,
  className,
  children,
}: {
  to: string;
  title: string;
  aside: string;
  value: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className={cn(
        'group block min-w-0 rounded-md focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      <div className="flex min-w-0 items-baseline justify-between gap-3 leading-4">
        <Eyebrow className="shrink-0 leading-4 tracking-wide group-hover:text-brand">
          {title}
        </Eyebrow>
        <span className="min-w-0 truncate font-mono text-xs text-muted-foreground" title={aside}>
          {aside}
        </span>
      </div>
      <div className="mt-1 flex min-w-0 items-center gap-3">
        <span
          title={value}
          className="shrink-0 font-mono text-lg leading-6 font-semibold tracking-tight"
        >
          {value}
        </span>
        {children}
      </div>
    </Link>
  );
}

function Track({ children, label }: { children?: React.ReactNode; label: string }) {
  return (
    <div
      role="img"
      aria-label={label}
      className="flex h-1.5 min-w-12 flex-1 overflow-hidden rounded-full bg-muted"
    >
      {children}
    </div>
  );
}

/** The day's berry money as two parts: what is still in the drawer, then what
 *  went out. Both are printed above it; the bar only shows the proportion. */
function CashBar({ cash, paidOut }: { cash: string | null; paidOut: string }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';
  if (cash === null) return <Track label="" />;
  const inDrawer = cmp(cash, '0') === 1 ? cash : '0.00';
  const whole = add(inDrawer, paidOut);
  const left = cmp(whole, '0') === 1 ? share(inDrawer, whole) : 0;
  const tone =
    cmp(inDrawer, '0') !== 1 ? 'bg-destructive' : left < CASH_LOW_SHARE ? 'bg-amber' : 'bg-success';
  return (
    <Track
      label={t('reception.state.cashBar', {
        cash: formatUah(cash, locale),
        paid: formatUah(paidOut, locale),
      })}
    >
      <div className={cn('h-full transition-[width]', tone)} style={{ width: `${left * 100}%` }} />
      <div className="h-full flex-1 bg-muted-foreground/30" hidden={cmp(paidOut, '0') !== 1} />
    </Track>
  );
}

/** Crates out with people against the allotment; no allotment, no scale. */
function CratesBar({ outstanding, target }: { outstanding: number; target: number | null }) {
  const { t } = useTranslation();
  if (target === null) return <Track label={t('reception.state.noTarget')} />;
  const ratio = target > 0 ? outstanding / target : outstanding > 0 ? 2 : 0;
  const tone = ratio > 1 ? 'bg-destructive' : ratio > CRATES_HIGH_SHARE ? 'bg-amber' : 'bg-brand';
  return (
    <Track label={t('reception.state.cratesValue', { out: outstanding, target })}>
      <div
        className={cn('h-full transition-[width]', tone)}
        style={{ width: `${Math.min(1, ratio) * 100}%` }}
      />
    </Track>
  );
}

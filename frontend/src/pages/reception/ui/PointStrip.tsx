import type * as React from 'react';
import { Fragment } from 'react';
import { Link } from 'react-router';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Eyebrow } from '@/shared/ui/eyebrow';
import { cn } from '@/shared/lib/cn';
import { add, cmp, formatKg, formatUah, sub, sum } from '@/shared/lib/money';
import { isTruncated } from '@/shared/api';
import { usePointCashForPointQuery } from '@/entities/point-cash';
import { useIntakesQuery } from '@/entities/intake';
import { useCrateStandingQuery, type CrateStanding } from '@/entities/crate';
import type { Shift } from '@/entities/shift';

export type StripShift =
  | { status: 'pending' }
  | { status: 'error' }
  | { status: 'none' }
  | { status: 'open'; shift: Shift };

/**
 * One horizontal strip above the intake form: the berry drawer,
 * the point's crates against its allotment and today's receipts — what the operator would
 * otherwise have to leave the form to look up. The figures come from the SAME
 * reads «Каса точки» and «Ящики» use for themselves, never re-derived a
 * different way (a second arithmetic path could silently disagree with the
 * first): the drawer and every term under it are `GET /point-cash/:id`'s own
 * `breakdown` (#73) — «на ранок · + надійшло · − видано · + повернуто», which
 * adds up to the figure (B4, audit 2026-10-24) — and today's cell is a `sum`
 * over the live rows of the shift's receipts.
 *
 * Today's receipts are listed ONCE, in the card under the form (B6): the cell
 * here is their summary, and a click takes the operator to that card.
 *
 * The shift's status is NOT here: it sits in the page header, and a day
 * with no open shift replaces the form itself (`ShiftClosedState`).
 */
export function PointStrip({
  pointId,
  shift,
  isOwner,
  onShowToday,
}: {
  pointId: string;
  shift: StripShift;
  isOwner: boolean;
  /** Takes the operator to today's receipts card; absent while there is no
   *  card to go to (no open shift), and then the cell is a plain summary. */
  onShowToday?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';
  const shiftId = shift.status === 'open' ? shift.shift.id : undefined;

  // Not gated on the shift being open (unlike the page's own read for
  // «Видано готівкою») — the drawer has a figure whether or not a shift is
  // open today, and this is the one place on the intake screen that says so.
  const cash = usePointCashForPointQuery(pointId);
  const intakes = useIntakesQuery({ shiftId });
  // The same read «Ящики» draws its allotment bar from — on the point, with
  // people, with berries and the allotment, all the server's.
  const standing = useCrateStandingQuery({ pointId, isOwner });

  // «Не виплачено за сьогоднішніми квитанціями» — Σ open_amount over today's LIVE
  // receipts: what is still owed for them now, from allocations. Never
  // negative, unlike amount − paid_amount when cash also closed older debt.
  const liveRows = (intakes.data?.data ?? []).filter((row) => row.voided_at === null);
  const openToday = sum(liveRows.map((row) => row.open_amount));
  const liveNetKg = sum(liveRows.map((row) => row.net_kg));
  // The sums above run over `page.data` — capped at 100 rows, server-side
  // (`Paginated<T>`'s `limit`) — never the whole shift. A busy point can
  // legitimately clear 100 receipts before close, and without this caption
  // the cell would silently read as the day's true total.
  const todayTruncated = isTruncated(intakes.data);

  const openTodayText = t('reception.today.open', { uah: formatUah(openToday, locale) });
  const todaySummary = t('reception.today.summary', {
    count: liveRows.length,
    kg: formatKg(liveNetKg, locale),
  });

  const pointCashHref = isOwner ? `/point-cash?point=${pointId}` : '/point-cash';
  const cratesHref = isOwner ? `/crates?point=${pointId}` : '/crates';

  const cashNow = cash.data?.cash ?? null;
  // An open day's drawer is its terms; any other day's is a count the
  // terms do not reach (closed, carried, none), so none are named.
  const breakdown = cash.data?.breakdown;
  const terms = breakdown?.kind === 'open' ? breakdown : null;
  const isNonZero = (value: string | null): value is string =>
    value !== null && cmp(value, '0') !== 0;
  const cashTerms =
    terms === null
      ? []
      : [
          t('reception.state.openingCash', { uah: formatUah(terms.opening ?? '0.00', locale) }),
          isNonZero(terms.transfers_in)
            ? t('reception.state.cashIn', { uah: formatUah(terms.transfers_in, locale) })
            : null,
          t('reception.state.paidOut', { uah: formatUah(terms.payouts ?? '0.00', locale) }),
          isNonZero(terms.returns)
            ? t('reception.state.returned', { uah: formatUah(terms.returns, locale) })
            : null,
        ].filter((part): part is string => part !== null);
  // Each term whole on a phone, where the line wraps: never «15 000,00 / ₴».
  // The « · » sits OUTSIDE the unbreakable span, so the line can wrap between terms.
  const cashAside = cashTerms.map((term, i) => (
    <Fragment key={term}>
      {i > 0 ? ' · ' : null}
      <span className="whitespace-nowrap">{term}</span>
    </Fragment>
  ));
  // What went out of the drawer net of the voids that brought it back.
  const paidOut = terms === null ? null : sub(terms.payouts ?? '0.00', terms.returns ?? '0.00');
  const crates = standing.data ?? null;
  const n = (value: number) => value.toLocaleString(locale).replace('-', '−');
  const cratesAside =
    crates === null
      ? ''
      : t('reception.state.cratesSplit', {
          onHand: n(crates.on_hand),
          inField: n(crates.in_field),
          withBerry: n(crates.with_berry),
        });

  return (
    // One compact row at `xl`: two meters (label over «figure + bar») and
    // today's receipts. The shift's own status lives in the page header.
    // Below `xl` the meters sit two to a row, one to a row on a phone.
    <section className="mb-4 rounded-xl border border-line2 bg-card">
      <div className="grid gap-x-6 gap-y-3 px-4 py-2.5 sm:grid-cols-2 xl:flex xl:items-center">
        <Meter
          to={pointCashHref}
          title={t('reception.state.cashTitle')}
          aside={cashAside}
          asideTitle={cashTerms.join(' · ')}
          // Loading reads «…», a failed read «—» — never a zero (rule 8).
          value={cashNow === null ? (cash.isError ? '—' : '…') : formatUah(cashNow, locale)}
          className="xl:flex-[1.4]"
        >
          <CashBar cash={cashNow} paidOut={paidOut} />
        </Meter>

        <Meter
          to={cratesHref}
          title={t('reception.state.crates')}
          aside={crates === null ? '' : <CratesLegend crates={crates} n={n} />}
          asideTitle={cratesAside}
          value={
            crates === null
              ? '…'
              : t('reception.state.cratesValue', {
                  total: n(crates.total),
                  // «—» is «не задано», never zero (§6.9 / §8.2).
                  target: crates.allotment === null ? '—' : n(crates.allotment),
                })
          }
          className="xl:flex-1"
        >
          <CratesBar crates={crates} />
        </Meter>

        <TodayCell
          onShowToday={onShowToday}
          openText={cmp(openToday, '0') === 1 ? openTodayText : null}
          truncated={todayTruncated}
          summary={todaySummary}
        />
      </div>
    </section>
  );
}

/**
 * «Сьогодні» — the day's receipts in one line. A button that takes the
 * operator to the list (the card under the form) when there is one to go to;
 * otherwise the same summary as plain text.
 */
function TodayCell({
  onShowToday,
  openText,
  truncated,
  summary,
}: {
  onShowToday?: () => void;
  openText: string | null;
  truncated: boolean;
  summary: string;
}) {
  const { t } = useTranslation();
  const body = (
    <>
      <span className="flex min-w-0 items-baseline gap-2 leading-4 xl:justify-end">
        <Eyebrow className="flex shrink-0 items-center gap-1 leading-4 tracking-wide">
          {t('reception.today.trigger')}
          {onShowToday ? <ChevronDown className="size-3" aria-hidden="true" /> : null}
        </Eyebrow>
        {openText !== null ? (
          <span
            className="min-w-0 truncate font-mono text-xs font-semibold text-amber"
            title={openText}
          >
            {openText}
          </span>
        ) : null}
        {truncated ? (
          <span
            className="min-w-0 truncate text-[11px] text-muted-foreground"
            title={t('reception.state.truncatedCaption')}
          >
            {t('reception.state.truncatedCaption')}
          </span>
        ) : null}
      </span>
      <span
        className="mt-1 block truncate font-mono text-sm leading-5 font-semibold"
        title={summary}
      >
        {summary}
      </span>
    </>
  );
  const className = 'min-w-0 text-left sm:col-span-2 xl:shrink-0 xl:text-right';
  return onShowToday ? (
    <button
      type="button"
      onClick={onShowToday}
      className={cn(
        className,
        'rounded-md outline-none hover:text-brand focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}

/** Below this share of the day's berry money left in the drawer, the bar
 *  turns amber: time to bring cash to the point. */
const CASH_LOW_SHARE = 0.2;

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
  asideTitle,
  value,
  className,
  children,
}: {
  to: string;
  title: string;
  aside: React.ReactNode;
  /** The aside as plain text, for its hover title when `aside` is a node. */
  asideTitle?: string;
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
      {/* On a phone the note wraps under the title rather than being cut —
          its terms are what make the figure add up (B4). */}
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 leading-4 sm:flex-nowrap">
        <Eyebrow className="shrink-0 leading-4 tracking-wide group-hover:text-brand">
          {title}
        </Eyebrow>
        <span
          className="min-w-0 font-mono text-xs text-muted-foreground sm:truncate"
          title={asideTitle ?? (typeof aside === 'string' ? aside : undefined)}
        >
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
  // No label means nothing to show yet (a read still loading): a bare track is
  // decoration, not an image with no name.
  const a11y =
    label === '' ? { 'aria-hidden': true as const } : { role: 'img', 'aria-label': label };
  return (
    <div {...a11y} className="flex h-1.5 min-w-12 flex-1 overflow-hidden rounded-full bg-muted">
      {children}
    </div>
  );
}

/** The day's berry money as two parts: what is still in the drawer, then what
 *  went out. Both are printed above it; the bar only shows the proportion. */
function CashBar({ cash, paidOut }: { cash: string | null; paidOut: string | null }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';
  if (cash === null || paidOut === null) return <Track label="" />;
  const inDrawer = cmp(cash, '0') === 1 ? cash : '0.00';
  const whole = add(inDrawer, paidOut);
  const left = cmp(whole, '0') === 1 ? share(inDrawer, whole) : 0;
  const tone =
    cmp(inDrawer, '0') !== 1 ? 'bg-destructive' : left < CASH_LOW_SHARE ? 'bg-amber' : 'bg-leaf';
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

/** The bar's three parts named in its own colours, so each figure reads
 *  straight off the segment it is. */
function CratesLegend({ crates, n }: { crates: CrateStanding; n: (value: number) => string }) {
  const { t } = useTranslation();
  const items = [
    {
      key: 'onHand',
      dot: 'bg-[var(--leaf)]',
      text: t('reception.state.cratesOnHand', { count: n(crates.on_hand) }),
      negative: crates.on_hand < 0,
    },
    {
      key: 'inField',
      dot: 'bg-[var(--amber)]',
      text: t('reception.state.cratesInField', { count: n(crates.in_field) }),
      negative: false,
    },
    {
      key: 'withBerry',
      dot: 'bg-primary',
      text: t('reception.state.cratesWithBerry', { count: n(crates.with_berry) }),
      negative: false,
    },
  ];
  return (
    <>
      {items.map((item, i) => (
        <span key={item.key} className={cn(item.negative && 'text-destructive')}>
          {i > 0 ? ' · ' : null}
          <span
            className={cn('mr-1 inline-block size-2 rounded-[2px] align-middle', item.dot)}
            aria-hidden="true"
          />
          {item.text}
        </span>
      ))}
    </>
  );
}

/**
 * Every crate of the point in ONE bar, the same three parts and colours as
 * «Ящики»'s allotment bar: on the point (leaf), out with people (amber), under
 * berries today (berry). The scale is the allotment, so the empty track is
 * what is missing from it; with no allotment, or more crates than it, the
 * scale is the point's own total. Widths only — every figure is the server's.
 */
function CratesBar({ crates }: { crates: CrateStanding | null }) {
  const { t } = useTranslation();
  if (crates === null) return <Track label="" />;
  const parts = [
    { key: 'onHand', value: Math.max(0, crates.on_hand), className: 'bg-[var(--leaf)]' },
    { key: 'inField', value: Math.max(0, crates.in_field), className: 'bg-[var(--amber)]' },
    { key: 'withBerry', value: Math.max(0, crates.with_berry), className: 'bg-primary' },
  ];
  const filled = parts.reduce((total, part) => total + part.value, 0);
  const scale = Math.max(filled, crates.allotment ?? 0);
  return (
    <Track
      label={t('reception.state.cratesSplit', {
        onHand: crates.on_hand,
        inField: crates.in_field,
        withBerry: crates.with_berry,
      })}
    >
      {scale > 0
        ? parts.map((part) => (
            <div
              key={part.key}
              data-segment={part.key}
              className={cn('h-full transition-[width]', part.className)}
              style={{ width: `${(part.value / scale) * 100}%` }}
            />
          ))
        : null}
    </Track>
  );
}

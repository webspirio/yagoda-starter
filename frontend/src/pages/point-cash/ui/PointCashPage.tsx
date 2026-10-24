import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { DashboardPage, type StatItem } from '@/shared/ui/templates/dashboard-page';
import { DateStepper } from '@/shared/ui/date-stepper';
import { SelectField } from '@/shared/ui/select-field';
import { HeaderSlot } from '@/shared/ui/header-slot';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { Spinner } from '@/shared/ui/spinner';
import { SectionCard } from '@/shared/ui/section-card';
import { TraceScope, TraceTerm } from '@/shared/ui/trace';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { isTruncated } from '@/shared/api';
import { useUrlParam } from '@/shared/lib/url-state';
import { isNegative, formatUah, cmp, sub, sum } from '@/shared/lib/money';
import {
  todayIso,
  addDaysIso,
  isRealIsoDate,
  formatLongDate,
  formatWeekday,
  formatShortDate,
} from '@/shared/lib/date';
import { useMeQuery } from '@/entities/user';
import { useWorkingPoint } from '@/features/point-scope';
import { usePointOptionsQuery } from '@/entities/collection-point';
import {
  usePointCashQuery,
  usePointCashForPointQuery,
  shortfallTone,
  formatNullableUah,
} from '@/entities/point-cash';
import { useIntakesQuery } from '@/entities/intake';
import { useCashCountsQuery, DiscrepancyText } from '@/entities/cash-count';
import { useTransfersQuery } from '@/entities/transfer';
import { useShiftOnDateQuery, useCurrentShiftQuery } from '@/entities/shift';
import { useCostOfDayQuery } from '@/entities/cost-of-day';
import { SetTargetCashDialog } from '@/features/set-point-target';
import {
  useOpenShiftMutation,
  useCloseShiftMutation,
  CountDrawerDialog,
  OpenShiftAlert,
} from '@/features/count-shift';
import { ShiftCountResult, type ShiftCountResultFor } from '@/widgets/count-result';
import { PayoutReceiptDialog, ReceiptDialog, useReceiptOpener } from '@/widgets/receipt';
import { CashLedger } from './CashLedger';
import { shiftDateOf } from '../lib/buildLedger';
import { IncomingTransfers } from './IncomingTransfers';
import { CashCountHistory } from './CashCountHistory';
import { ShiftCountPanel, type OpenShiftGate } from './ShiftCountPanel';
import { DayTiles } from './DayTiles';
import { DayFeed } from './DayFeed';
import { DayLedger } from './DayLedger';
import { ReopenShiftDialog } from './ReopenShiftDialog';
import { useDayDocuments } from '../model/useDayDocuments';

/** What the shift-count dialog is open for: which verb, and — for a close —
 *  the shift it closes. */
type CountTarget = { mode: 'open' } | { mode: 'close'; shiftId: string };

/**
 * «Каса точки» — one point, one date, the drawer it should hold right now.
 *
 * FOUR RULES THIS PAGE MUST NOT BREAK (Task 19):
 *
 * 1. The ledger EXPLAINS the figure; the figure itself is the server's.
 *    `stats` read `cash` from THE ONE SCOPED ROW this page fetches
 *    (`GET /point-cash?collection_point_id=`); `CashLedger` reads its rows
 *    AND its total from `GET /point-cash/:pointId`'s `breakdown` (#73), one
 *    statement, so the rows add up to the figure under them. Only the one
 *    informational row («Нараховано за день») still reads a bounded page of
 *    `intakes`.
 * 2. A point with zero cash-counts reads `0.00`, correctly (§7.3 — a
 *    point's first count IS its opening balance) — but says so in words
 *    (`neverCounted`) so it does not read as a regression.
 * 3. `target_cash`/`shortfall` are nullable and mean «not assigned», never
 *    zero (§6.9, §7.10) — both render `—`, never a defaulted `'0.00'`.
 * 4. §10.2 — the target button exists in the tree ONLY for the owner
 *    (`isOwner && pointId`), not merely disabled for anyone else — AND only
 *    once the row is actually loaded. `target_cash == null` renders "not
 *    assigned", which is a CLAIM, not a placeholder; making it off an
 *    unloaded row would also feed `SetTargetCashDialog` a false
 *    `currentTarget: null`, which skips the §6.1 reason requirement. One
 *    scoped read is what makes that a single `if`: the row and the cash
 *    figure now arrive together, so neither can be ahead of the other.
 *
 * THE PAGE READS NOTHING ABOUT THE PICKED POINT BEFORE ONE IS PICKED. An
 * owner lands here with `pointId === null` and sees one empty state; every
 * read below that would name a figure — transfers, intakes, payouts, cash
 * counts, point cash — is gated so that state costs no network-wide sweep.
 * ONE EXCEPTION (review, minor 8): `pointCashAll` below, the owner's OWN
 * unscoped `/point-cash` read that feeds the picker's «З наділом»/«Без
 * наділу» grouping, fires on `isOwner` alone, not on `pointId` — it has to,
 * since picking the point is exactly what it exists to help with. It never
 * names a figure FOR the picked point (every stat still comes from `pointRow`
 * alone), so it does not undermine the claim above.
 */
export function PointCashPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const { data: me } = useMeQuery();
  const isOperator = me?.role === 'point_operator';
  const isOwner = me?.role === 'network_owner';
  const { pointId, canPick, setPointId } = useWorkingPoint();
  const { data: points } = usePointOptionsQuery();
  const [dateParam, setDateParam] = useUrlParam('date');
  const today = todayIso();
  const date = isRealIsoDate(dateParam) && dateParam <= today ? dateParam : today;
  const isToday = date === today;

  // ONE READ, SCOPED TO THIS POINT — `collection_point_id` is honoured for
  // both roles (`resolvePointFilter` pins an operator to their own point
  // whatever is asked for), so there is no network-wide list to page through
  // and no row to lose off the end of it.
  const pointCash = usePointCashQuery({
    asOf: date,
    pointId: pointId ?? undefined,
    enabled: pointId !== null,
  });
  const pointRow = pointCash.data?.data[0] ?? null;

  // OWNER-ONLY, AND ONLY FOR THE GROUPING — the unscoped `/point-cash` list
  // (the same endpoint §7.10's network table reads), read once to split the
  // owner's <select> into «З наділом» / «Без наділу». Never a source of
  // figures: every stat on this page still comes from `pointRow` alone. Rules
  // of Hooks forbid skipping this call for an operator, so it always mounts —
  // `enabled: isOwner` is what keeps it from ever actually fetching for one.
  const pointCashAll = usePointCashQuery({ enabled: isOwner });
  // BUILT FROM `points` (folded in from a later review round), not from
  // `pointCashAll`'s own rows — `points` is `usePointOptionsQuery()`'s
  // active-only list, read at the top of this component already. Filtering
  // `pointCashAll.data.data` down to the active ones (the old shape) dropped
  // an active point ENTIRELY the moment its row fell outside that read's own
  // page (the default `limit`), not merely its target — a point that
  // legitimately exists and can be picked would silently vanish from both
  // optgroups. Iterating `points` instead and looking each one up in a `Map`
  // of the unscoped rows means every active point is always offered; one
  // whose row is unknown here reads as «Без наділу»/"No target" — the same
  // honest default a point that genuinely has none gets, not a third group
  // for "we don't know" (this screen has no other use for that distinction).
  // A DEACTIVATED point can still carry an unscoped `/point-cash` row (it may
  // still owe or hold money), but it belongs in neither optgroup either way:
  // it stays reachable only via `?point=`, where `pointName`'s own fallback
  // (below) still names it from `pointRow` alone.
  const pointCashByPointId = new Map(
    (pointCashAll.data?.data ?? []).map((row) => [row.collection_point_id, row]),
  );
  const groupedPoints =
    pointCashAll.data && points
      ? {
          withTarget: points.filter((p) => pointCashByPointId.get(p.id)?.target_cash != null),
          withoutTarget: points.filter((p) => pointCashByPointId.get(p.id)?.target_cash == null),
        }
      : null;

  // #73 — the ledger's rows and its total, read in ONE server statement so
  // they cannot disagree. Kept out of `isError`: a failed breakdown degrades
  // the ledger card only, never the stats above it.
  const pointCashOne = usePointCashForPointQuery(pointId, date);
  // The ledger's one INFORMATIONAL row (accrued), capped at `limit: 100` and
  // caveated under its row when it was. Receipts are read from the day the
  // shift began — a shift left open since an earlier day files them under
  // that day (#114). The hook disables itself when the filter names no scope
  // (hence the empty object rather than a bare date range),
  // `useCashCountsQuery` likewise. (No payouts read: «Видано за минулі дні»,
  // the only row that needed one, is gone — audit 2026-10-24, C1.)
  const shiftDate = shiftDateOf(pointCashOne.data?.breakdown, date);
  const intakes = useIntakesQuery(
    pointId ? { pointId, from: shiftDate, to: date, limit: 100 } : {},
  );
  const cashCounts = useCashCountsQuery({ pointId: pointId ?? undefined });
  // C4 — money already on the road to this point. The SAME key
  // `IncomingTransfers` reads (`enabled` stays out of the key), so it costs no
  // second request. A transfer's `sent` is a state of NOW, not of `date`, so
  // only today's shortfall hint names it.
  const inTransit = useTransfersQuery({
    pointId: pointId ?? undefined,
    status: 'sent',
    enabled: pointId !== null,
  });
  const inTransitCash = inTransit.data ? sum(inTransit.data.data.map((tr) => tr.cash)) : null;
  // R4 — «Зміна і перерахунок каси». `useShiftOnDateQuery` already gates
  // itself on `pointId !== null` (`shiftOnDateQueryOptions`), same as every
  // other read on this page. The panel's own counts read is scoped to the
  // shift alone (not point+date) — a closed shift's opening/closing/midday
  // rows stay THAT shift's, whatever `date` does later.
  const shift = useShiftOnDateQuery(pointId, date);
  const shiftCashCounts = useCashCountsQuery({ shiftId: shift.data?.id });
  // A failed read is not «no shift» — both settle to `data: undefined`,
  // which reads identically to a genuinely shift-less day unless the panel
  // is told otherwise. Kept OUT of the page-wide `isError` below on purpose:
  // the rest of the page (ledger, crates, transfers) is independent of
  // whether this one section's read succeeded, so only `ShiftCountPanel`
  // degrades — not the whole screen.
  const isShiftError = shift.isError || shiftCashCounts.isError;
  // #114 — `shift` answers only for the date on screen; a shift left open on
  // an earlier day is invisible to it, and «Відкрити зміну» over one is the
  // SHIFT_ALREADY_OPEN refusal of #113. `/shifts/current` is date-blind — the
  // same gate `pages/reception` puts on its own button.
  const current = useCurrentShiftQuery(pointId);
  const openShiftGate: OpenShiftGate = current.isError
    ? 'failed'
    : current.isPending
      ? 'checking'
      : current.data == null
        ? 'allowed'
        : 'blocked';
  const panelCounts = shiftCashCounts.data?.data ?? [];

  // #221 — what «Каса за день» showed, folded in: the shift's own documents,
  // read BY SHIFT (see `useDayDocuments` for why these are not the ledger's
  // reads above). Kept out of the page-wide `isError`, like the shift read:
  // a failed journal degrades the day's tiles, feed and reconciliation only.
  const day = useDayDocuments(date, shift.data?.id);
  // Top-ups review, item 5 — the owner's доплати on this shift's receipts move
  // no cash, so «Звірка каси» leaves them out while «Собівартість дня»'s
  // «Нараховано» counts them; the ledger names the gap on the days it exists.
  // `GET /shifts/:id/cost-of-day` is owner-only: an operator passes no id, so
  // the hook stays disabled and never asks (and the operator sees no note —
  // whether operators see доплати at all is the client's open question).
  const costOfDay = useCostOfDayQuery(isOwner ? shift.data?.id : undefined);
  const topUps = isOwner ? (costOfDay.data?.top_ups_total ?? null) : null;
  const hasShift = shift.data != null;
  // One gate for the day's figures: a shift, a clean read, both journals in.
  // Tiles and «Звірка каси» must never disagree on it.
  const dayFiguresVisible = hasShift && !shift.isError && !day.isError && day.ready;
  const receipt = useReceiptOpener();
  const payoutReceipt = useReceiptOpener();
  const [reopenOpen, setReopenOpen] = useState(false);
  // Bumped on every open so the dialog remounts with fresh RHF defaults and no
  // banner from the refusal before it.
  const [reopenInstance, setReopenInstance] = useState(0);

  const openShift = useOpenShiftMutation();
  const closeShift = useCloseShiftMutation();
  const [countTarget, setCountTarget] = useState<CountTarget | null>(null);
  // The COPY the dialog shows, split from `countTarget`: `open={countTarget
  // !== null}` alone drives visibility, so `countMode` must survive the close
  // (exit) animation after `countTarget` is already cleared — resetting it
  // too would flip a closing close-dialog to the open copy for ~100ms. (CSS-
  // driven and untestable under jsdom — no test covers it.)
  const [countMode, setCountMode] = useState<'open' | 'close'>('open');
  const [countInstance, setCountInstance] = useState(0);
  const openCountDialog = (target: CountTarget) => {
    setCountInstance((n) => n + 1);
    setCountMode(target.mode);
    setCountTarget(target);
  };
  // R4 — the result view after an open/close; see `ShiftCountResult`.
  const [resultFor, setResultFor] = useState<ShiftCountResultFor | null>(null);

  // «Стрічка дня» | «Історія перерахунків» (#221). The history reads the same
  // `useCashCountsQuery({ pointId })` key as `cashCounts` above, so opening its
  // tab costs no request; the tab only keeps the long table off the screen.
  const [activityTab, setActivityTab] = useState<'feed' | 'counts'>('feed');

  const [targetOpen, setTargetOpen] = useState(false);
  const [targetInstance, setTargetInstance] = useState(0);

  // A SETTLED READ WITH NO ROW MEANS THE POINT DOES NOT EXIST. The backend
  // selects `FROM collection_points WHERE ($1 IS NULL OR cp.id = $1)` with no
  // active-only filter, so a scoped read answers with this point's row or
  // with an empty page — and the empty page means a stale `?point=`/stored
  // id, not a truncated list. Left out of `isError` it would spin forever.
  const pointMissing = pointCash.data !== undefined && pointRow === null;
  const isError = pointCash.isError || pointMissing || intakes.isError || cashCounts.isError;

  // THE ROW NAMES THE POINT, NOT THE PICKER — `pointRow` is the one source
  // guaranteed to describe the figures actually on screen, so it goes
  // first. `usePointOptionsQuery` (ACTIVE points only) is the fallback for
  // the moment before that row has loaded: a deactivated point used to name
  // itself `''` — a hidden eyebrow and a target dialog titled with a
  // dangling dash — when the picker was tried first and came up empty.
  const pointName = pointRow?.name ?? (points ?? []).find((p) => p.id === pointId)?.name ?? '';
  const hasTarget = pointRow?.target_cash != null;
  // `total` beats what was fetched exactly when a capped page dropped rows.
  const intakesTruncated = isTruncated(intakes.data);
  // §7.3 — a point with no counts at all reads `0.00`, correctly, but would
  // look like a regression on deploy without saying so in words.
  //
  // AT OR BEFORE `date`, NOT «EVER»: this page reads a past date as readily
  // as today, and a count taken this morning explains nothing about a drawer
  // that had never been counted back on the date being read. The rows carry
  // their shift's `business_date`, which is the same calendar the page's
  // `date` is on — no timestamp/timezone conversion needed.
  //
  // AND ONLY OFF A COMPLETE PAGE: the counts read is capped at 100 and comes
  // back newest-first (`cash-counts.service.ts` orders by `business_date
  // DESC`), so on a long-running point the counts that would settle an old
  // date are exactly the ones that did not fit. «Ще не рахована» is a claim
  // about the point's whole history; a page that admits it is partial cannot
  // support it, and the generic cash hint is the honest fallback.
  const counts = cashCounts.data;
  const neverCounted =
    counts !== undefined &&
    counts.total === counts.data.length &&
    !counts.data.some((c) => c.business_date <= date);

  // C14 — the owner's «Невирішених розбіжностей: N · {sum}»: the counts still
  // waiting on the owner's explanation as of `date`. Off the same capped
  // newest-first page as `neverCounted`, so a cut page says «щонайменше».
  const openCounts = (counts?.data ?? []).filter((c) => c.is_open && c.business_date <= date);
  const openCountsTruncated = counts !== undefined && counts.total > counts.data.length;
  // Shortages and surpluses are summed APART (review 24.10): netted, a −90 and
  // a +90 read «Зійшлося» in green over two open incidents. Each part keeps
  // its own sign, so `DiscrepancyText` names it; a zero part is left out.
  const openShortage = sum(openCounts.map((c) => c.discrepancy).filter((d) => cmp(d, '0') === -1));
  const openSurplus = sum(openCounts.map((c) => c.discrepancy).filter((d) => cmp(d, '0') === 1));
  const openParts = [openShortage, openSurplus].filter((d) => cmp(d, '0') !== 0);

  // Nothing is shown off a page whose reads failed — including the target,
  // whose «—» would otherwise be a claim made on top of an error.
  const shownRow = isError ? null : pointRow;
  const shortfall = shownRow ? shortfallTone(shownRow.shortfall) : null;
  // `shortfallTone` alone only tells amber (owed) from leaf (<= 0) — it does
  // not say WHICH leaf reading this is, and «наділ на точці відновлено»
  // (exactly 0) is a different claim from «у касі більше, ніж наділ» (below
  // 0). The raw `cmp` against '0' is what tells those two apart; `null` means
  // no target was ever assigned, same as `shortfallTone`'s own null case.
  const shortfallCmp = shownRow?.shortfall == null ? null : cmp(shownRow.shortfall, '0');
  // C4 — «з них X уже в дорозі»: only today, only while something is owed
  // and something is actually on the road.
  const onTheRoad =
    isToday && shortfallCmp === 1 && inTransitCash !== null && cmp(inTransitCash, '0') === 1
      ? inTransitCash
      : null;
  const stats: StatItem[] | undefined = shownRow
    ? [
        {
          label: t('pointCash.stats.target'),
          value: (
            <span data-trace="cash:target">{formatNullableUah(shownRow.target_cash, locale)}</span>
          ),
          // Every tile carries a caption, so the four values sit on one line (C14).
          hint:
            shownRow.target_cash == null
              ? t('pointCash.stats.targetUnset')
              : t('pointCash.stats.targetHint'),
        },
        {
          label: t('pointCash.stats.cash'),
          // The source the ledger's total (`ledger:total`) also lights.
          value: <span data-trace="cash:total">{formatUah(shownRow.cash, locale)}</span>,
          // C9 — plain cash is neutral ink; below zero it is amber, the same
          // tone the ledger's total uses.
          tone: isNegative(shownRow.cash) ? 'amber' : 'default',
          hint: neverCounted ? t('pointCash.stats.neverCounted') : t('pointCash.stats.cashHint'),
        },
        // C5 — a label agrees with its sign: a NEGATIVE shortfall is «Понад
        // наділ 2 800,00 ₴», never «Не вистачає до наділу −2 800,00 ₴».
        shortfallCmp === -1 && shownRow.shortfall != null
          ? {
              label: t('pointCash.stats.over'),
              value: (
                <span data-trace="cash:shortfall">
                  {formatUah(sub('0', shownRow.shortfall), locale)}
                </span>
              ),
              tone: shortfall ?? undefined,
              hint: t('pointCash.stats.shortfallOver'),
            }
          : {
              label: t('pointCash.stats.shortfall'),
              value: (
                <span data-trace="cash:shortfall">
                  {formatNullableUah(shownRow.shortfall, locale)}
                </span>
              ),
              tone: shortfall ?? undefined,
              hint:
                shortfallCmp === null ? (
                  t('pointCash.stats.shortfallUnset')
                ) : shortfallCmp === 1 ? (
                  onTheRoad !== null ? (
                    // The figure lights the «У дорозі» cards below it
                    // (`IncomingTransfers`, `incoming:sent`).
                    <Trans
                      t={t}
                      i18nKey="pointCash.stats.shortfallOnTheRoad"
                      values={{ uah: formatUah(onTheRoad, locale) }}
                      components={{
                        road: (
                          <TraceTerm
                            refs="incoming:sent"
                            tone="amber"
                            hint={t('pointCash.stats.traceOnTheRoad')}
                          />
                        ),
                      }}
                    />
                  ) : (
                    t('pointCash.stats.shortfallOwed')
                  )
                ) : (
                  t('pointCash.stats.shortfallSettled')
                ),
            },
        // R1 — the crates book as its OWN tile (#221), beside the berry cash
        // and never summed with it: the client's «Правка» says berry cash and
        // crate deposits do not lie in one drawer, and `point-cash.service.ts`
        // refuses to add the two books. No combined «У шухляді має бути» tile.
        {
          label: t('pointCash.crates.title'),
          value: formatUah(shownRow.crate_deposits, locale),
          // The old card's footnote, kept: a crate handed out against a
          // signed receipt carries no deposit, so this count can be smaller
          // than the crates out in the field.
          // C12 — the crates book has no date: on a past date the figure is
          // still today's, and the caption says so.
          hint: t(isToday ? 'pointCash.crates.hint' : 'pointCash.crates.hintPast', {
            caption:
              shownRow.crate_deposit_units === 0
                ? t('pointCash.crates.captionZero')
                : t('pointCash.crates.caption', { count: shownRow.crate_deposit_units }),
          }),
        },
      ]
    : undefined;

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      {canPick ? (
        <HeaderSlot slot="scope">
          <SelectField
            aria-label={t('pointCash.pickPoint')}
            value={pointId ?? ''}
            onChange={(e) => setPointId(e.target.value)}
            className="w-48"
          >
            {/* No «Оберіть точку» entry: `useWorkingPoint` always resolves the
                owner to a point. A deactivated one reached by `?point=` is in
                neither list below, so it gets its own entry — otherwise the
                select would show the first active point over its figures.
                Its name comes from `pointRow`, so it is generic until that
                read lands — or for good, if it failed. */}
            {pointId && points && !points.some((p) => p.id === pointId) ? (
              <option value={pointId}>{pointName || t('common.inactivePoint')}</option>
            ) : null}
            {groupedPoints ? (
              <>
                {/* R6 — the owner's select lists points with a target first, so
                    a point still waiting on one does not compete for attention
                    with the points the owner actually has to fund today. */}
                <optgroup label={t('pointCash.pick.withTarget')}>
                  {groupedPoints.withTarget.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={t('pointCash.pick.withoutTarget')}>
                  {groupedPoints.withoutTarget.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              </>
            ) : (
              // `pointCashAll` has not settled yet (or this render is not the
              // owner's) — the flat, ungrouped `points` list is what the select
              // showed before grouping existed, kept here as the one render
              // that must never come up empty while the grouping read is on
              // its way.
              (points ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))
            )}
          </SelectField>
        </HeaderSlot>
      ) : null}
      <DateStepper
        label={formatShortDate(date, locale)}
        onPrev={() => setDateParam(addDaysIso(date, -1))}
        onNext={() => setDateParam(addDaysIso(date, 1))}
        canNext={!isToday}
        onToday={isToday ? undefined : () => setDateParam(null)}
      />
      {/* §10.2 — this button exists in the tree ONLY for the owner, not
          merely disabled for anyone else: a disabled button teaches people to
          look for a way around it, an absent one teaches nothing. It also
          waits for the row itself — opening `SetTargetCashDialog` with a
          `currentTarget` that only LOOKS like "no target yet" would waive
          §6.1's reason requirement on a point that already has one. */}
      {isOwner && pointId && shownRow ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setTargetInstance((n) => n + 1);
            setTargetOpen(true);
          }}
        >
          {hasTarget ? t('pointCash.target.change') : t('pointCash.target.set')}
        </Button>
      ) : null}
    </div>
  );

  const dayTiles = dayFiguresVisible ? (
    <DayTiles summary={day.summary} truncated={day.truncated} shown={day.feed.length} />
  ) : null;

  // #221 — «Звірка каси» first, then ONE card with two tabs: the day's feed
  // and the point's recount history. «Звірка» is a fixed handful of rows; the
  // feed grows with every document of the day, and a history placed under it
  // would be out of reach on a busy one — as a tab it is one click away
  // whatever the feed's length. (`DayLedger` overlaps `CashLedger` and is a
  // candidate for removal — follow-ups.)
  const daySection =
    pointId === null ? null : (
      <div className="mt-5 flex flex-col gap-5">
        {dayFiguresVisible ? (
          <DayLedger summary={day.summary} truncated={day.truncated} topUps={topUps} />
        ) : null}
        <SectionCard>
          <Tabs
            value={activityTab}
            onValueChange={(next) => setActivityTab(next === 'counts' ? 'counts' : 'feed')}
          >
            <TabsList className="mb-3">
              <TabsTrigger value="feed">{t('day.feed.title')}</TabsTrigger>
              <TabsTrigger value="counts">{t('pointCash.tabs.countHistory')}</TabsTrigger>
            </TabsList>
            <TabsContent value="feed">
              <DayFeed
                me={me}
                pointId={pointId}
                hasShift={hasShift}
                isToday={isToday}
                isLoading={shift.isPending || (hasShift && !day.ready)}
                // A failed SHIFT read is announced once, by the panel; the feed
                // cannot claim «no shift» over it, so it says so quietly.
                isError={shift.isError || day.isError}
                quietError={shift.isError}
                feed={day.feed}
                onOpenReceipt={receipt.openReceipt}
                onOpenPayoutReceipt={payoutReceipt.openReceipt}
              />
            </TabsContent>
            <TabsContent value="counts">
              <CashCountHistory pointId={pointId} isOwner={isOwner} meId={me?.id ?? null} />
            </TabsContent>
          </Tabs>
        </SectionCard>
      </div>
    );

  // The ONLY place today's shift can be closed since «Каса за день» went
  // (#221) — `OpenShiftAlert` closes only an EARLIER day's. So it renders in
  // the page-wide error branch too: it needs none of the ledger's reads and
  // degrades on its own (`isShiftError`), and a failed ledger read must not
  // leave a shift nobody can close.
  const shiftPanel = (
    <ShiftCountPanel
      shift={shift.data ?? null}
      // `shift.isPending` alone hangs the spinner forever while
      // `shiftCashCounts` sits DISABLED (no `shift.data?.id` yet) —
      // a disabled query's own `isPending` never clears, it just
      // never fetches. `isLoading` (`isPending && isFetching`) is
      // `false` for a disabled query, so it only adds real wait
      // time, never a phantom one.
      isShiftLoading={shift.isPending || shiftCashCounts.isLoading}
      isShiftError={isShiftError}
      counts={panelCounts}
      isOperator={isOperator}
      isToday={isToday}
      onOpenShift={() => openCountDialog({ mode: 'open' })}
      openShiftGate={openShiftGate}
      onCloseShift={(shiftId) => openCountDialog({ mode: 'close', shiftId })}
      // Not while the shift read itself failed: the panel shows reopen over a
      // failed COUNTS read, and a stale `shift.data` must not offer it.
      onReopenShift={
        isOwner && !shift.isError
          ? () => {
              setReopenInstance((n) => n + 1);
              setReopenOpen(true);
            }
          : undefined
      }
    />
  );

  const body =
    pointId === null ? (
      <EmptyState title={t('pointCash.pickPoint')} />
    ) : pointMissing ? (
      <p role="alert" className="py-6 text-center text-destructive">
        {t('pointCash.errors.pointMissing')}
      </p>
    ) : isError ? (
      // The cash figures failed; the day did not have to. Its own reads are
      // by shift, so the tiles, the shift panel, «Звірка» and the feed stay —
      // as on «Каса за день», which showed them whatever the ledger's reads did.
      <>
        <p role="alert" className="py-6 text-center text-destructive">
          {t('common.somethingWentWrong')}
        </p>
        {dayTiles}
        {shiftPanel}
        {daySection}
      </>
    ) : !shownRow ? (
      // Nothing but "not answered yet" is left: `pointId` is set (so the read
      // is enabled), a failed one took the branch above, and so did a settled
      // one that came back without the row.
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    ) : (
      <>
        {dayTiles}
        <IncomingTransfers pointId={pointId} canAct={isOperator} />
        {isOwner && openCounts.length > 0 ? (
          <div className="mb-5 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
            <span>
              {t(
                openCountsTruncated
                  ? 'pointCash.unexplained.countAtLeast'
                  : 'pointCash.unexplained.count',
                { count: openCounts.length },
              )}
            </span>
            {openParts.map((d) => (
              <span key={d} className="contents">
                <span aria-hidden="true">·</span>
                <DiscrepancyText className="font-mono tabular-nums" difference={d} />
              </span>
            ))}
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0"
              onClick={() => setActivityTab('counts')}
            >
              {t('pointCash.unexplained.open')}
            </Button>
          </div>
        ) : null}
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
          <CashLedger
            date={date}
            cash={pointCashOne.data?.cash}
            breakdown={pointCashOne.data?.breakdown}
            failed={pointCashOne.isError}
            intakes={intakes.data?.data ?? []}
            intakesTruncated={intakesTruncated}
          />
          <div className="flex flex-col gap-5">{shiftPanel}</div>
        </div>
        {daySection}
      </>
    );

  // ONE trace scope for the page: the ledgers' terms light the tiles above
  // them, the shortfall's «у дорозі» lights the transfer cards, and «Звірка
  // каси» lights the day feed's rows (`TraceScope` is `display: contents`).
  return (
    <>
      <TraceScope>
        <DashboardPage
          eyebrow={
            pointName
              ? t('pointCash.eyebrow', {
                  point: pointName,
                  date: formatLongDate(date, locale),
                  weekday: formatWeekday(date, locale),
                })
              : undefined
          }
          title={t('pointCash.title')}
          description={t('pointCash.description')}
          actions={actions}
          stats={stats}
          statColumns={4}
        >
          <OpenShiftAlert
            pointId={pointId}
            viewedDate={date}
            // The same page, another `?date=` — where the panel offers the close.
            onGoToDate={setDateParam}
            onClosed={(id) => setResultFor({ mode: 'close', shiftId: id })}
          />
          {body}
        </DashboardPage>
      </TraceScope>

      {isOwner && pointId && shownRow ? (
        <SetTargetCashDialog
          key={targetInstance}
          pointId={pointId}
          pointName={pointName}
          currentTarget={shownRow.target_cash}
          open={targetOpen}
          onClose={() => setTargetOpen(false)}
        />
      ) : null}

      <CountDrawerDialog
        key={`count-${countInstance}`}
        mode={countMode}
        shiftId={countTarget?.mode === 'close' ? countTarget.shiftId : null}
        open={countTarget !== null}
        onClose={() => setCountTarget(null)}
        onConfirm={async (counted_amount, broken_crates) => {
          if (countTarget === null) {
            // Only reachable while the dialog is open, which only happens
            // with a target set: a programming error here must not look like
            // a silent no-op success.
            throw new Error('count dialog confirmed without a target');
          }
          if (countTarget.mode === 'open') {
            // The response NAMES the new shift — no need to wait on
            // `shift.data?.id` catching up with its own refetch just to know
            // which id `resultRow` should watch for.
            const opened = await openShift.mutateAsync({ counted_amount });
            setResultFor({ mode: 'open', shiftId: opened.id });
          } else {
            if (broken_crates === null) {
              throw new Error('close confirmed without a breakage count');
            }
            await closeShift.mutateAsync({
              id: countTarget.shiftId,
              counted_amount,
              broken_crates,
            });
            setResultFor({ mode: 'close', shiftId: countTarget.shiftId });
          }
          setCountTarget(null);
        }}
      />

      <ShiftCountResult result={resultFor} onClose={() => setResultFor(null)} />

      {shift.data ? (
        <ReopenShiftDialog
          key={`reopen-${reopenInstance}`}
          shift={shift.data}
          open={reopenOpen}
          onClose={() => setReopenOpen(false)}
        />
      ) : null}
      <ReceiptDialog
        key={receipt.receiptId}
        intakeId={receipt.receiptId}
        open={receipt.open}
        startWithVoid={receipt.startWithVoid}
        onClose={receipt.clear}
      />
      <PayoutReceiptDialog
        key={`payout-${payoutReceipt.receiptId}`}
        payoutId={payoutReceipt.receiptId}
        open={payoutReceipt.open}
        onClose={payoutReceipt.clear}
      />
    </>
  );
}

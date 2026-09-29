import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DashboardPage, type StatItem } from '@/shared/ui/templates/dashboard-page';
import { DateStepper } from '@/shared/ui/date-stepper';
import { SelectField } from '@/shared/ui/select-field';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { Spinner } from '@/shared/ui/spinner';
import { isTruncated } from '@/shared/api';
import { useUrlParam } from '@/shared/lib/url-state';
import { isNegative, formatUah, cmp, isZero } from '@/shared/lib/money';
import { todayIso, addDaysIso, isRealIsoDate, formatLongDate, formatWeekday, formatShortDate } from '@/shared/lib/date';
import { useMeQuery } from '@/entities/user';
import { useWorkingPoint } from '@/features/point-scope';
import { usePointOptionsQuery } from '@/entities/collection-point';
import { usePointCashQuery, shortfallTone, formatNullableUah } from '@/entities/point-cash';
import { useIntakesQuery } from '@/entities/intake';
import { usePayoutsQuery } from '@/entities/payout';
import { useTransfersQuery } from '@/entities/transfer';
import { useCashCountsQuery } from '@/entities/cash-count';
import { useShiftOnDateQuery } from '@/entities/shift';
import { SetTargetCashDialog } from '@/features/set-point-target';
import {
  useOpenShiftMutation,
  useCloseShiftMutation,
  CountDrawerDialog,
  CountResultView,
} from '@/features/count-shift';
import { CashLedger } from './CashLedger';
import { CratesBookCard } from './CratesBookCard';
import { IncomingTransfers } from './IncomingTransfers';
import { CashCountHistory } from './CashCountHistory';
import { ShiftCountPanel } from './ShiftCountPanel';

/** What the shift-count dialog is open for: which verb, and — for a close —
 *  the shift it closes. Same shape `pages/day/ui/DayPage.tsx` keeps locally;
 *  not shared, because the two pages' surrounding wiring (toolbar vs panel)
 *  differs enough that a shared type would buy nothing but an import. */
type CountTarget = { mode: 'open' } | { mode: 'close'; shiftId: string };

/**
 * «Каса точки» — one point, one date, the drawer it should hold right now.
 *
 * FOUR RULES THIS PAGE MUST NOT BREAK (Task 19):
 *
 * 1. The ledger EXPLAINS the figure; the figure itself is the server's.
 *    `stats`/`CashLedger` both read their headline `cash` from THE ONE
 *    SCOPED ROW this page fetches (`GET /point-cash?collection_point_id=` —
 *    one SQL formula) — never from a client-side sum of `intakes`/`payouts`/
 *    `transfers`. `CashLedger`'s own rows are built from a bounded page of
 *    those documents (`limit: 100`, no lower date bound on payouts/transfers)
 *    and may not add up to that figure on a busy point — that gap is left
 *    visible on purpose rather than papered over with a second total.
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

  // §7.9's cash counts as what was CREDITED (`resolved_cash ?? reported_cash
  // ?? cash`, `buildLedger`'s job), not what was SENT — `from`/`to` on
  // `/transfers` filter `sent_at`, which is the wrong date for that check, so
  // this read carries no date bound at all rather than silently excluding a
  // transfer sent before the window but accepted inside it. `intakes`/
  // `payouts` bound cleanly on `business_date` instead. All three cap at the
  // default `limit: 100`; rule 1 above is why that cap never corrupts the
  // TOTAL on screen — but it does bound the individual ledger rows, and each
  // of the three says so under its own row (`*Truncated` below).
  //
  // EACH OF THESE IS GATED ON A POINT, by whichever means its own hook
  // offers: `intakesQueryOptions` and `payoutsQueryOptions` disable
  // themselves when the filter names no scope (hence the empty object rather
  // than a bare date range), `useCashCountsQuery` likewise, and
  // `useTransfersQuery` cannot — `pages/transfers` reads it network-wide on
  // purpose — so it takes an explicit `enabled`.
  const intakes = useIntakesQuery(pointId ? { pointId, from: date, to: date, limit: 100 } : {});
  const payouts = usePayoutsQuery({ pointId: pointId ?? undefined, to: date, limit: 100 });
  const ledgerTransfers = useTransfersQuery({
    pointId: pointId ?? undefined,
    limit: 100,
    enabled: pointId !== null,
  });
  const cashCounts = useCashCountsQuery({ pointId: pointId ?? undefined });
  // R6 — the ledger's «на початок дня» row needs exactly ONE count: THIS
  // date's opening berry count. `cashCounts` above is unbounded and
  // newest-first, so on a long-running point today's opening count is
  // exactly the kind of row a capped page could drop — a date-scoped read
  // of its own can never lose it to that cap. Gated the same way
  // `intakes` is just above (an empty object rather than a bare date
  // range) so it never fires network-wide before a point is picked —
  // `useCashCountsQuery`'s own `isScoped` would otherwise treat `from`/`to`
  // alone as scope enough.
  const openingCashCounts = useCashCountsQuery(pointId ? { pointId, from: date, to: date } : {});

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
  const panelCounts = shiftCashCounts.data?.data ?? [];
  // §7.6 — the panel's own result-view lookup needs the SAME berry-only
  // narrowing `ShiftCountPanel` applies to its own copy of this array; kept
  // separate rather than threading derived rows down as props, so a test
  // that renders `ShiftCountPanel` alone can hand it a raw, unfiltered page
  // (see that component's own doc comment).
  const panelBerryCounts = panelCounts.filter((c) => c.book === 'berry');
  const openingCountRow = panelBerryCounts.find((c) => c.kind === 'opening') ?? null;
  const closingCountRow = panelBerryCounts.find((c) => c.kind === 'closing') ?? null;

  const openShift = useOpenShiftMutation();
  const closeShift = useCloseShiftMutation();
  const [countTarget, setCountTarget] = useState<CountTarget | null>(null);
  // The COPY the dialog shows — same split from `countTarget` (and the same
  // reason) `DayPage` documents: `open={countTarget !== null}` alone drives
  // visibility, so `countMode` must survive the close (exit) animation after
  // `countTarget` is already cleared.
  const [countMode, setCountMode] = useState<'open' | 'close'>('open');
  const [countInstance, setCountInstance] = useState(0);
  const openCountDialog = (target: CountTarget) => {
    setCountInstance((n) => n + 1);
    setCountMode(target.mode);
    setCountTarget(target);
  };
  // R4 — the result view after an open/close, read back from
  // `panelBerryCounts` above rather than from the mutation's own response:
  // `useInvalidateDay` (both mutations' `onSuccess`) refetches `shifts` AND
  // `cashCounts`, and THAT refetch — not a value stashed off the response —
  // is what `CountResultView` waits for (its own doc comment). No effect
  // needed: `resultFor` is set once, synchronously, in the confirm handler
  // below, and the row it names is whatever the counts query says right now.
  //
  // `shiftId` (minor 6, review) — `resultFor` used to be bare
  // `'open' | 'close' | null`, which outlives the shift it was about:
  // changing the date after a close left `resultFor === 'close'` sitting in
  // state, and the moment `closingCountRow` for the NEW date's shift
  // happened to be non-null, the old result popped up over the wrong day.
  // Naming the shift alongside the mode is what `resultRow` below checks
  // against `shift.data?.id` — a stale `resultFor` from another day can
  // never match the shift on screen now.
  const [resultFor, setResultFor] = useState<{ mode: 'open' | 'close'; shiftId: string } | null>(
    null,
  );
  const resultRow =
    resultFor === null || resultFor.shiftId !== shift.data?.id
      ? null
      : resultFor.mode === 'open'
        ? openingCountRow
        : closingCountRow;

  // Minor 14 (review) — the CONTENT for the close (exit) animation.
  // `CountResultView` used to be wrapped in `resultFor !== null && resultRow
  // !== null ? (…) : null`, which unmounted the whole dialog the INSTANT
  // either went null — a hard pop, unlike every other dialog on this page,
  // which stays mounted and lets `open` alone drive visibility. Latched here
  // so the LAST real content survives dismissal (`resultFor` clears
  // immediately; this does not) — set during render, not an effect: React's
  // own documented technique for storing derived info from a previous render
  // (`useState`'s reference doc, "storing information from previous
  // renders"). An effect would run one tick AFTER the render that needs it,
  // which is exactly the render the very first count of the day has to show.
  const [resultView, setResultView] = useState<{
    mode: 'open' | 'close';
    title: string;
    counted: string;
    discrepancy: string | null;
  } | null>(null);
  if (resultFor !== null && resultRow !== null) {
    const title =
      resultFor.mode === 'open'
        ? t('pointCash.result.opened')
        : isZero(resultRow.discrepancy)
          ? t('pointCash.result.closedSettled')
          : t('pointCash.result.closedDiscrepancy', {
              amount: formatUah(resultRow.discrepancy, locale),
            });
    // Opening carries no discrepancy — §7.3, the first count IS the opening
    // balance, nothing to compare it against yet.
    const discrepancy = resultFor.mode === 'close' ? resultRow.discrepancy : null;
    if (
      resultView === null ||
      resultView.mode !== resultFor.mode ||
      resultView.title !== title ||
      resultView.counted !== resultRow.counted_amount ||
      resultView.discrepancy !== discrepancy
    ) {
      setResultView({ mode: resultFor.mode, title, counted: resultRow.counted_amount, discrepancy });
    }
  }

  const [showCountHistory, setShowCountHistory] = useState(false);

  const [targetOpen, setTargetOpen] = useState(false);
  const [targetInstance, setTargetInstance] = useState(0);

  // A SETTLED READ WITH NO ROW MEANS THE POINT DOES NOT EXIST. The backend
  // selects `FROM collection_points WHERE ($1 IS NULL OR cp.id = $1)` with no
  // active-only filter, so a scoped read answers with this point's row or
  // with an empty page — and the empty page means a stale `?point=`/stored
  // id, not a truncated list. Left out of `isError` it would spin forever.
  const pointMissing = pointCash.data !== undefined && pointRow === null;
  const isError =
    pointCash.isError ||
    pointMissing ||
    intakes.isError ||
    payouts.isError ||
    ledgerTransfers.isError ||
    cashCounts.isError ||
    openingCashCounts.isError;

  // THE ROW NAMES THE POINT, NOT THE PICKER — `pointRow` is the one source
  // guaranteed to describe the figures actually on screen, so it goes
  // first. `usePointOptionsQuery` (ACTIVE points only) is the fallback for
  // the moment before that row has loaded: a deactivated point used to name
  // itself `''` — a hidden eyebrow and a target dialog titled with a
  // dangling dash — when the picker was tried first and came up empty.
  const pointName = pointRow?.name ?? (points ?? []).find((p) => p.id === pointId)?.name ?? '';
  const hasTarget = pointRow?.target_cash != null;
  // Finding 4 (review round 1) — each of the three reads is capped at 100,
  // so each can feed a ledger row that covers recent history only: the
  // payouts read has no lower date bound at all, the transfers read has no
  // date bound of any kind, and even the one-day intakes read runs out on a
  // point with more than a hundred receipts in a day. `total` beats what was
  // actually fetched exactly when that happened; `CashLedger` turns it into a
  // caveat under the affected row rather than a number that quietly is not
  // what its label claims — and it was told about payouts alone for a whole
  // review round.
  const intakesTruncated = isTruncated(intakes.data);
  const payoutsTruncated = isTruncated(payouts.data);
  const transfersTruncated = isTruncated(ledgerTransfers.data);
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

  // R6 — the ledger's opening row, from `openingCashCounts` alone (never
  // from `counts` above — that read is unbounded and can drop THIS date's
  // row on a long-running point, exactly the failure mode `neverCounted`'s
  // own comment names). §7.6: one drawer, two books — `book === 'berry'`
  // picks the book this page's ledger explains, leaving the crates count
  // (if any) for `CratesBookCard` to worry about, not this row.
  const openingCount =
    openingCashCounts.data?.data.find((c) => c.kind === 'opening' && c.book === 'berry')
      ?.counted_amount ?? null;

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
  const stats: StatItem[] | undefined = shownRow
    ? [
        {
          label: t('pointCash.stats.target'),
          value: formatNullableUah(shownRow.target_cash, locale),
          hint: shownRow.target_cash == null ? t('pointCash.stats.targetUnset') : undefined,
        },
        {
          label: t('pointCash.stats.cash'),
          value: formatUah(shownRow.cash, locale),
          tone: isNegative(shownRow.cash) ? 'amber' : 'berry',
          hint: neverCounted ? t('pointCash.stats.neverCounted') : t('pointCash.stats.cashHint'),
        },
        {
          label: t('pointCash.stats.shortfall'),
          value: formatNullableUah(shownRow.shortfall, locale),
          tone: shortfall ?? undefined,
          hint:
            shortfallCmp === null
              ? t('pointCash.stats.shortfallUnset')
              : shortfallCmp === 1
                ? t('pointCash.stats.shortfallOwed')
                : shortfallCmp === -1
                  ? t('pointCash.stats.shortfallOver')
                  : t('pointCash.stats.shortfallSettled'),
        },
      ]
    : undefined;

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      {canPick ? (
        <SelectField
          aria-label={t('pointCash.pickPoint')}
          value={pointId ?? ''}
          onChange={(e) => setPointId(e.target.value || null)}
          className="w-48"
        >
          <option value="">{t('pointCash.pickPoint')}</option>
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
      ) : null}
      <DateStepper
        label={formatShortDate(date, locale)}
        onPrev={() => setDateParam(addDaysIso(date, -1))}
        onNext={() => setDateParam(addDaysIso(date, 1))}
        canNext={!isToday}
        onToday={isToday ? undefined : () => setDateParam(null)}
        todayLabel={t('pointCash.today')}
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

  const body =
    pointId === null ? (
      <EmptyState title={t('pointCash.pickPoint')} />
    ) : isError ? (
      <p role="alert" className="py-6 text-center text-destructive">
        {pointMissing ? t('pointCash.errors.pointMissing') : t('common.somethingWentWrong')}
      </p>
    ) : !shownRow ? (
      // Nothing but "not answered yet" is left: `pointId` is set (so the read
      // is enabled), a failed one took the branch above, and so did a settled
      // one that came back without the row.
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    ) : (
      <>
        <IncomingTransfers pointId={pointId} canAct={isOperator} />
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
          <CashLedger
            date={date}
            cash={shownRow.cash}
            intakes={intakes.data?.data ?? []}
            payouts={payouts.data?.data ?? []}
            transfers={ledgerTransfers.data?.data ?? []}
            intakesTruncated={intakesTruncated}
            payoutsTruncated={payoutsTruncated}
            transfersTruncated={transfersTruncated}
            openingCount={openingCount}
            target={shownRow.target_cash}
          />
          <div className="flex flex-col gap-5">
            {/* R1 — no combined «У шухляді має бути» figure here: the
                client's «Правка» says berry cash and crate deposits do not
                lie in one drawer, and `point-cash.service.ts` already
                refuses to add the two books. `CratesBookCard` shows the
                crates figure alone, with a muted two-books line that prints
                both figures side by side and never their sum. */}
            <CratesBookCard
              crateDeposits={shownRow.crate_deposits}
              crateDepositUnits={shownRow.crate_deposit_units}
              berryCash={shownRow.cash}
            />
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
              onCloseShift={(shiftId) => openCountDialog({ mode: 'close', shiftId })}
            />
          </div>
        </div>
        {/* Full width, below the ledger/right-column grid — the journal is a
            wide table, and the 320px column it used to sit in truncated it.
            Behind a toggle: the whole-point history is a long table nobody
            reads on every visit, and `CashCountHistory` owns its own
            unbounded `useCashCountsQuery({ pointId })` read, which now stays
            off the network entirely until asked for. */}
        <div className="mt-5">
          <Button
            variant="outline"
            size="sm"
            aria-expanded={showCountHistory}
            onClick={() => setShowCountHistory((v) => !v)}
          >
            {t('pointCash.countHistory.toggle')}
          </Button>
          {showCountHistory ? (
            <div className="mt-3">
              <CashCountHistory pointId={pointId} isOwner={isOwner} />
            </div>
          ) : null}
        </div>
      </>
    );

  return (
    <>
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
        statColumns={3}
      >
        {body}
      </DashboardPage>

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
            // with a target set — same guard `DayPage` keeps for the same
            // reason: a programming error here must not look like a silent
            // no-op success.
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
            await closeShift.mutateAsync({ id: countTarget.shiftId, counted_amount, broken_crates });
            setResultFor({ mode: 'close', shiftId: countTarget.shiftId });
          }
          setCountTarget(null);
        }}
      />

      {/* ALWAYS mounted (minor 14, review) — `open` alone drives visibility,
          same as `CountDrawerDialog`/`SetTargetCashDialog` above, so a
          dismiss animates closed instead of hard-popping out of the DOM.
          There is nothing to show before the very first count of the day
          ever lands (`resultView` stays `null`, `open` stays `false`) —
          `resultView`'s own doc comment above is what keeps this rendering
          the LAST real content while it fades, not a blank flash. This is
          the SAME component `RecountDrawerDialog` (features/count-shift)
          renders for its own result — a `pages/*` module reaching down into
          `features/*` is the allowed direction, so this is the one place the
          two callers share it. */}
      <CountResultView
        open={resultFor !== null && resultRow !== null}
        title={resultView?.title ?? ''}
        counted={resultView?.counted ?? '0.00'}
        discrepancy={resultView?.discrepancy ?? null}
        onClose={() => setResultFor(null)}
      />
    </>
  );
}

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DashboardPage, type StatItem } from '@/shared/ui/templates/dashboard-page';
import { StatTile } from '@/shared/ui/stat-tile';
import { PendingSlice } from '@/shared/ui/pending-slice';
import { DateStepper } from '@/shared/ui/date-stepper';
import { SelectField } from '@/shared/ui/select-field';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { Spinner } from '@/shared/ui/spinner';
import { useUrlParam } from '@/shared/lib/url-state';
import { cmp, isNegative, formatUah } from '@/shared/lib/money';
import { todayIso, addDaysIso, isRealIsoDate, formatLongDate, formatWeekday, formatShortDate } from '@/shared/lib/date';
import { useMeQuery, usePointScope } from '@/entities/user';
import { usePointOptionsQuery } from '@/entities/collection-point';
import { usePointCashForPointQuery, usePointCashQuery } from '@/entities/point-cash';
import { useIntakesQuery } from '@/entities/intake';
import { usePayoutsQuery } from '@/entities/payout';
import { useTransfersQuery } from '@/entities/transfer';
import { useCashCountsQuery } from '@/entities/cash-count';
import { SetTargetCashDialog } from '@/features/set-point-target';
import { CashLedger } from './CashLedger';
import { IncomingTransfers } from './IncomingTransfers';
import { CashCountHistory } from './CashCountHistory';

/**
 * «Каса точки» — one point, one date, the drawer it should hold right now.
 *
 * FOUR RULES THIS PAGE MUST NOT BREAK (Task 19):
 *
 * 1. The ledger EXPLAINS the figure; the figure itself is the server's.
 *    `stats`/`CashLedger` both read their headline `cash` from
 *    `usePointCashForPointQuery` (`GET /point-cash/:pointId` — one SQL
 *    formula) — never from a client-side sum of `intakes`/`payouts`/
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
 *    (`isOwner && pointId`), not merely disabled for anyone else.
 */
export function PointCashPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const { data: me } = useMeQuery();
  const { pointId, canPick, setPointId } = usePointScope();
  const { data: points } = usePointOptionsQuery();
  const [dateParam, setDateParam] = useUrlParam('date');
  const today = todayIso();
  const date = isRealIsoDate(dateParam) && dateParam <= today ? dateParam : today;
  const isToday = date === today;

  const pointCashOne = usePointCashForPointQuery(pointId, date);
  const pointCashList = usePointCashQuery({ asOf: date });
  const pointRow = pointCashList.data?.data.find((r) => r.collection_point_id === pointId) ?? null;

  // §7.9's cash counts as what was CREDITED (`resolved_cash ?? reported_cash
  // ?? cash`, `buildLedger`'s job), not what was SENT — `from`/`to` on
  // `/transfers` filter `sent_at`, which is the wrong date for that check, so
  // this read carries no date bound at all rather than silently excluding a
  // transfer sent before the window but accepted inside it. `intakes`/
  // `payouts` bound cleanly on `business_date` instead. All three cap at the
  // default `limit: 100`; rule 1 above is exactly why that cap needs no
  // separate "truncated" banner of its own — the total on screen is never
  // computed from these anyway.
  const intakes = useIntakesQuery({ pointId: pointId ?? undefined, from: date, to: date, limit: 100 });
  const payouts = usePayoutsQuery({ pointId: pointId ?? undefined, to: date, limit: 100 });
  const ledgerTransfers = useTransfersQuery({ pointId: pointId ?? undefined, limit: 100 });
  const cashCounts = useCashCountsQuery({ pointId: pointId ?? undefined });

  const [targetOpen, setTargetOpen] = useState(false);
  const [targetInstance, setTargetInstance] = useState(0);

  const isOperator = me?.role === 'point_operator';
  const isOwner = me?.role === 'network_owner';
  const isLoading = pointId !== null && pointCashOne.isPending;
  const isError =
    pointCashOne.isError ||
    pointCashList.isError ||
    intakes.isError ||
    payouts.isError ||
    ledgerTransfers.isError ||
    cashCounts.isError;

  const pointName = (points ?? []).find((p) => p.id === pointId)?.name ?? '';
  const hasTarget = pointRow?.target_cash != null;
  // Finding 4 (review round 1) — the payouts read is capped at 100 with no
  // lower date bound, so `CashLedger`'s `paidPast` may cover only recent
  // history on a point with a long season. `total` beats what was actually
  // fetched exactly when that happened; `CashLedger` turns this into a
  // caveat under that one row rather than a number that quietly is not
  // what its label claims.
  const payoutsTruncated = payouts.data ? payouts.data.total > payouts.data.data.length : false;
  // §7.3 — a point with no counts at all reads `0.00`, correctly, but would
  // look like a regression on deploy without saying so in words.
  const neverCounted = cashCounts.data?.data.length === 0;

  const cashData = pointId && !isError ? pointCashOne.data : undefined;
  const stats: StatItem[] | undefined = cashData
    ? [
        {
          label: t('pointCash.stats.target'),
          value: pointRow?.target_cash == null ? '—' : formatUah(pointRow.target_cash, locale),
          hint: pointRow?.target_cash == null ? t('pointCash.stats.targetUnset') : undefined,
        },
        {
          label: t('pointCash.stats.cash'),
          value: formatUah(cashData.cash, locale),
          tone: isNegative(cashData.cash) ? 'amber' : 'berry',
          hint: neverCounted ? t('pointCash.stats.neverCounted') : t('pointCash.stats.cashHint'),
        },
        {
          label: t('pointCash.stats.shortfall'),
          value: pointRow?.shortfall == null ? '—' : formatUah(pointRow.shortfall, locale),
          tone:
            pointRow?.shortfall != null && cmp(pointRow.shortfall, '0') === 1 ? 'amber' : 'leaf',
          hint:
            pointRow?.shortfall == null
              ? t('pointCash.stats.shortfallUnset')
              : cmp(pointRow.shortfall, '0') === 1
                ? t('pointCash.stats.shortfallOwed')
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
          {(points ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
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
          look for a way around it, an absent one teaches nothing. */}
      {isOwner && pointId ? (
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
        {t('common.somethingWentWrong')}
      </p>
    ) : isLoading || !cashData ? (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    ) : (
      <>
        <IncomingTransfers pointId={pointId} canAct={isOperator} />
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
          <CashLedger
            date={date}
            cash={cashData.cash}
            intakes={intakes.data?.data ?? []}
            payouts={payouts.data?.data ?? []}
            transfers={ledgerTransfers.data?.data ?? []}
            payoutsTruncated={payoutsTruncated}
          />
          <div className="flex flex-col gap-5">
            <PendingSlice
              label={t('pointCash.crates.label')}
              note={t('pointCash.crates.note')}
              variant="block"
            />
            {/* «У шухляді має бути» — the mock adds berry cash to crate
                deposits here; crates have no source in this backend (§3), so
                this tile shows `cash` ALONE with a caption saying so. Adding
                a known figure to an unknown one would print a wrong number
                with a confident face. */}
            <StatTile
              label={t('pointCash.drawer.label')}
              value={formatUah(cashData.cash, locale)}
              tone={isNegative(cashData.cash) ? 'amber' : 'berry'}
              hint={t('pointCash.drawer.caption')}
            />
            <CashCountHistory pointId={pointId} isOwner={isOwner} />
          </div>
        </div>
      </>
    );

  return (
    <>
      <DashboardPage
        eyebrow={
          pointName
            ? t('pointCash.eyebrow', { point: pointName, weekday: formatWeekday(date, locale) })
            : undefined
        }
        title={t('pointCash.title', { date: formatLongDate(date, locale) })}
        description={t('pointCash.description')}
        actions={actions}
        stats={stats}
        statColumns={3}
      >
        {body}
      </DashboardPage>

      {isOwner && pointId ? (
        <SetTargetCashDialog
          key={targetInstance}
          pointId={pointId}
          pointName={pointName}
          currentTarget={pointRow?.target_cash ?? null}
          open={targetOpen}
          onClose={() => setTargetOpen(false)}
        />
      ) : null}
    </>
  );
}

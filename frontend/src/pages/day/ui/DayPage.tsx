import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DashboardPage, type StatItem } from '@/shared/ui/templates/dashboard-page';
import { SectionCard } from '@/shared/ui/section-card';
import { DateStepper } from '@/shared/ui/date-stepper';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { SelectField } from '@/shared/ui/select-field';
import { EmptyState } from '@/shared/ui/empty-state';
import { Spinner } from '@/shared/ui/spinner';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import { toast } from '@/shared/ui/toast';
import { useUrlParam } from '@/shared/lib/url-state';
import { sum, sub, formatUah } from '@/shared/lib/money';
import {
  todayIso,
  addDaysIso,
  isIsoDate,
  formatLongDate,
  formatWeekday,
  formatShortDate,
} from '@/shared/lib/date';
import { cn } from '@/shared/lib/cn';
import { useMeQuery, usePointScope } from '@/entities/user';
import { usePointOptionsQuery } from '@/entities/collection-point';
import { useShiftOnDateQuery, type Shift } from '@/entities/shift';
import { useIntakesQuery, type Intake } from '@/entities/intake';
import { usePayoutsQuery, type Payout } from '@/entities/payout';
import { useOpenShiftMutation, useCloseShiftMutation } from '../api/shiftActions';
import { apiErrorToBanner } from '../lib/apiErrorToBanner';
import { ReopenShiftDialog } from './ReopenShiftDialog';

interface FeedRow {
  kind: 'intake' | 'payout';
  id: string;
  code: string;
  amount: string;
  at: string;
  voided: boolean;
  reason: string | null;
}

/**
 * A `?date=` that is a REAL calendar day, not merely `YYYY-MM-DD` shaped.
 *
 * `isIsoDate` checks the shape only, and the two ways a shaped-but-impossible
 * date fails are both silent from here:
 *   - `2026-02-31` parses and ROLLS OVER, so the page would title itself
 *     «3 March» while asking the API for the 31st of February;
 *   - `2026-00-10` / `0000-00-00` parse to an Invalid Date, and the first
 *     `Intl` call on it throws a RangeError straight into the route error
 *     boundary — one hand-edited query param blanks the screen.
 *
 * Only a date that survives a round trip through `addDaysIso` is real. The
 * try/catch is not defensive padding: `addDaysIso` calls `toISOString()`, which
 * is exactly what throws on the Invalid Date case above.
 */
function isRealIsoDate(value: unknown): value is string {
  if (!isIsoDate(value)) return false;
  try {
    return addDaysIso(value, 0) === value;
  } catch {
    return false;
  }
}

/**
 * «Каса за день» — one point, one date, its shift and its documents. The date
 * lives in `?date=` (default today) and the owner's point in `?point=`
 * (`usePointScope`), so a reload or a shared link lands on the same day.
 *
 * Totals are DISPLAY sums over document headers, added in kopiykas by
 * `shared/lib/money`; nothing here is money the server has not already
 * computed and frozen onto a document.
 */
export function DayPage() {
  const { t, i18n } = useTranslation();
  const { data: me } = useMeQuery();
  const { pointId, canPick, setPointId } = usePointScope();
  const { data: points } = usePointOptionsQuery();
  const [dateParam, setDateParam] = useUrlParam('date');
  const today = todayIso();
  // A hand-edited (or stale-link) date is clamped rather than sent on: there is
  // no shift in the future, and a garbage param must not reach the API.
  const date = isRealIsoDate(dateParam) && dateParam <= today ? dateParam : today;

  const shift = useShiftOnDateQuery(pointId, date);
  const shiftId = shift.data?.id;
  const intakes = useIntakesQuery({ shiftId });
  const payouts = usePayoutsQuery({ shiftId });

  const open = useOpenShiftMutation();
  const close = useCloseShiftMutation();
  const [confirmClose, setConfirmClose] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  // Bumped on every open so the dialog remounts with fresh RHF defaults and no
  // banner from the refusal before it — the convention SetPriceDialog documents.
  const [reopenInstance, setReopenInstance] = useState(0);
  const [banner, setBanner] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>, toastKey: string) => {
    setBanner(null);
    try {
      await action();
      toast.success(t(toastKey));
    } catch (error) {
      setBanner(apiErrorToBanner(error));
    }
  };

  const isOperator = me?.role === 'point_operator';
  const isOwner = me?.role === 'network_owner';
  const isToday = date === today;
  const status: Shift['status'] | 'none' = shift.data?.status ?? 'none';
  // «No shift» and «not asked yet» are the same `undefined` in the data, and
  // the difference is not cosmetic: an Open button on the second one lets an
  // operator open a shift that is already open. The toolbar waits, as the feed does.
  const isLoadingShift = pointId !== null && shift.isPending;

  const liveIntakes = (intakes.data?.data ?? []).filter((i) => i.voided_at === null);
  const livePayouts = (payouts.data?.data ?? []).filter((p) => p.voided_at === null);
  const accrued = sum(liveIntakes.map((i) => i.amount));
  const paid = sum(livePayouts.map((p) => p.amount));
  const stats: StatItem[] = [
    { label: t('day.tiles.receipts'), value: String(liveIntakes.length) },
    {
      label: t('day.tiles.accrued'),
      value: formatUah(accrued, i18n.language),
      hint: t('day.tiles.accruedHint'),
    },
    {
      label: t('day.tiles.paid'),
      value: formatUah(paid, i18n.language),
      hint: t('day.tiles.paidHint'),
      tone: 'berry',
    },
    {
      label: t('day.tiles.toDebt'),
      value: formatUah(sub(accrued, paid), i18n.language),
      hint: t('day.tiles.toDebtHint'),
      tone: 'amber',
    },
  ];

  const feed: FeedRow[] = [
    ...(intakes.data?.data ?? []).map((i: Intake): FeedRow => ({
      kind: 'intake',
      id: i.id,
      code: i.code,
      amount: i.amount,
      at: i.created_at,
      voided: i.voided_at !== null,
      reason: i.void_reason,
    })),
    ...(payouts.data?.data ?? []).map((p: Payout): FeedRow => ({
      kind: 'payout',
      id: p.id,
      code: p.code,
      amount: p.amount,
      at: p.created_at,
      voided: p.voided_at !== null,
      reason: p.void_reason,
    })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  // Both journals are read with the entities' default `limit: 100`. Past that
  // the tiles would quietly under-report a busy day, which is the one thing a
  // cash screen may not do — so say so rather than raise the limit and hope.
  const truncated =
    (intakes.data ? intakes.data.total > intakes.data.data.length : false) ||
    (payouts.data ? payouts.data.total > payouts.data.data.length : false);

  const pointName = (points ?? []).find((p) => p.id === pointId)?.name ?? '';

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      {canPick ? (
        <SelectField
          aria-label={t('day.pickPoint')}
          value={pointId ?? ''}
          onChange={(e) => setPointId(e.target.value || null)}
          className="w-48"
        >
          <option value="">{t('day.pickPoint')}</option>
          {(points ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </SelectField>
      ) : null}
      <DateStepper
        label={formatShortDate(date, i18n.language)}
        onPrev={() => setDateParam(addDaysIso(date, -1))}
        onNext={() => setDateParam(addDaysIso(date, 1))}
        canNext={!isToday}
        // Clearing the param — not writing today's date — keeps the shared link
        // for "today" free of a date that would be wrong tomorrow.
        onToday={isToday ? undefined : () => setDateParam(null)}
        todayLabel={t('day.today')}
      />
      <Badge
        variant={
          isLoadingShift
            ? 'secondary'
            : status === 'open'
              ? 'default'
              : status === 'awaiting_explanation'
                ? 'destructive'
                : 'secondary'
        }
      >
        {isLoadingShift
          ? t('day.status.loading')
          : t(`day.status.${status === 'none' && isToday ? 'noneToday' : status}`)}
      </Badge>
      {!isLoadingShift && isOperator && isToday && status === 'none' && pointId ? (
        <Button
          onClick={() => void run(() => open.mutateAsync(), 'day.toast.opened')}
          disabled={open.isPending}
        >
          {t('day.open')}
        </Button>
      ) : null}
      {!isLoadingShift && isOperator && status === 'open' ? (
        <Button variant="outline" onClick={() => setConfirmClose(true)}>
          {t('day.close')}
        </Button>
      ) : null}
      {!isLoadingShift && isOwner && status === 'closed' && shift.data ? (
        <Button
          variant="outline"
          onClick={() => {
            setReopenInstance((n) => n + 1);
            setReopenOpen(true);
          }}
        >
          {t('day.reopen')}
        </Button>
      ) : null}
    </div>
  );

  const feedContent =
    pointId === null ? (
      <EmptyState title={t('day.pickPoint')} />
    ) : shift.isPending ? (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    ) : status === 'none' ? (
      <EmptyState
        title={t(isToday ? 'day.status.noneToday' : 'day.status.none')}
        hint={t('day.feed.noShift')}
      />
    ) : feed.length === 0 ? (
      <EmptyState title={t('day.feed.empty')} />
    ) : (
      <ul className="divide-y divide-border">
        {feed.map((row) => (
          <li
            key={`${row.kind}-${row.id}`}
            className={cn(
              'flex items-center gap-3 py-2.5 text-sm',
              row.voided && 'text-muted-foreground line-through',
            )}
            title={row.reason ?? undefined}
          >
            {/* Local wall clock, not the UTC slice of created_at — the operator
                reads this against the clock on their own wall. */}
            <span className="font-mono text-xs text-muted-foreground">
              {new Date(row.at).toLocaleTimeString(i18n.language, {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            <Badge variant={row.kind === 'intake' ? 'secondary' : 'outline'}>
              {t(`day.feed.${row.kind}`)}
            </Badge>
            <span className="font-mono">{row.code}</span>
            {row.voided ? <span className="text-xs">{t('day.feed.voided')}</span> : null}
            <span className="ml-auto font-mono tabular-nums">
              {formatUah(row.amount, i18n.language)}
            </span>
          </li>
        ))}
      </ul>
    );

  return (
    <>
      {/* `children` REPLACES `sections` in DashboardPage, and the banner has to
          sit above the feed rather than inside its card — so the body is
          composed here from the same SectionCard the template would have used. */}
      <DashboardPage
        eyebrow={t('day.eyebrow', {
          point: pointName,
          weekday: formatWeekday(date, i18n.language),
        })}
        title={t('day.title', { date: formatLongDate(date, i18n.language) })}
        description={t('day.description')}
        actions={actions}
        stats={pointId && status !== 'none' ? stats : undefined}
        statColumns={4}
      >
        {truncated ? (
          <p className="-mt-2 mb-4 text-xs text-muted-foreground">
            {t('day.tiles.truncated', { count: feed.length })}
          </p>
        ) : null}
        {banner ? (
          <p role="alert" className="mb-4 text-sm text-destructive">
            {t(banner)}
          </p>
        ) : null}
        <SectionCard eyebrow={t('day.feed.title')}>{feedContent}</SectionCard>
      </DashboardPage>

      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title={t('day.confirmClose.title')}
        description={t('day.confirmClose.body')}
        confirmLabel={t('day.close')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => {
          const id = shift.data?.id;
          if (id) void run(() => close.mutateAsync(id), 'day.toast.closed');
        }}
      />
      {shift.data ? (
        <ReopenShiftDialog
          key={reopenInstance}
          shift={shift.data}
          open={reopenOpen}
          onClose={() => setReopenOpen(false)}
        />
      ) : null}
    </>
  );
}

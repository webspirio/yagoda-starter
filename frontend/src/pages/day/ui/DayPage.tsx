import { useMemo, useState } from 'react';
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
import { sum, sub, cmp, formatUah } from '@/shared/lib/money';
import {
  todayIso,
  addDaysIso,
  isRealIsoDate,
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
import { useSuppliersQuery, supplierName } from '@/entities/supplier';
import { ReceiptDialog } from '@/widgets/receipt';
import { useOpenShiftMutation, useCloseShiftMutation } from '../api/shiftActions';
import { apiErrorToBanner } from '../lib/apiErrorToBanner';
import { ReopenShiftDialog } from './ReopenShiftDialog';

interface FeedRow {
  kind: 'intake' | 'payout';
  id: string;
  code: string;
  amount: string;
  at: string;
  supplierId: string;
  voided: boolean;
  reason: string | null;
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
  // §5.1 — every feed row (intake AND payout) carries the supplier's name; the
  // point already scopes the suppliers this feed can possibly reference.
  const suppliers = useSuppliersQuery('', pointId);
  const supplierNameById = useMemo(
    () => new Map((suppliers.data?.data ?? []).map((s) => [s.id, supplierName(s)])),
    [suppliers.data],
  );

  const open = useOpenShiftMutation();
  const close = useCloseShiftMutation();
  const [confirmClose, setConfirmClose] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [receiptId, setReceiptId] = useState<string | null>(null);
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
  // A failed read must never look like a quiet zero: an empty feed under
  // 0,00 ₴ tiles or an «Open shift» button over a shift the server never
  // confirmed either way are both worse than saying so.
  const isError = shift.isError || intakes.isError || payouts.isError;

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
      // §5.1: amber only while something is actually owed — a settled (or
      // negative, which should not happen but must not shout either) balance
      // reads as any other tile.
      tone: cmp(sub(accrued, paid), '0') === 1 ? 'amber' : 'default',
    },
  ];

  const feed: FeedRow[] = [
    ...(intakes.data?.data ?? []).map((i: Intake): FeedRow => ({
      kind: 'intake',
      id: i.id,
      code: i.code,
      amount: i.amount,
      at: i.created_at,
      supplierId: i.supplier_id,
      voided: i.voided_at !== null,
      reason: i.void_reason,
    })),
    ...(payouts.data?.data ?? []).map((p: Payout): FeedRow => ({
      kind: 'payout',
      id: p.id,
      code: p.code,
      amount: p.amount,
      at: p.created_at,
      supplierId: p.supplier_id,
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
      {!shift.isError &&
      !isLoadingShift &&
      isOperator &&
      isToday &&
      status === 'none' &&
      pointId ? (
        <Button
          onClick={() => void run(() => open.mutateAsync(), 'day.toast.opened')}
          disabled={open.isPending}
        >
          {t('day.open')}
        </Button>
      ) : null}
      {!shift.isError && !isLoadingShift && isOperator && status === 'open' ? (
        <Button variant="outline" onClick={() => setConfirmClose(true)}>
          {t('day.close')}
        </Button>
      ) : null}
      {!shift.isError && !isLoadingShift && isOwner && status === 'closed' && shift.data ? (
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
    ) : isError ? (
      <p role="alert" className="py-6 text-center text-destructive">
        {t('common.somethingWentWrong')}
      </p>
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
        {feed.map((row) => {
          const rowContent = (
            <>
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
              <span className="min-w-0 flex-1 truncate">
                {supplierNameById.get(row.supplierId) ?? '—'}
              </span>
              {row.voided ? <span className="text-xs">{t('day.feed.voided')}</span> : null}
              <span className="ml-auto font-mono tabular-nums">
                {formatUah(row.amount, i18n.language)}
              </span>
            </>
          );
          const rowClassName = cn(
            'flex items-center gap-3 text-sm',
            row.voided && 'text-muted-foreground line-through',
          );

          return (
            <li key={`${row.kind}-${row.id}`} className="py-2.5" title={row.reason ?? undefined}>
              {/* Intake rows open the receipt (spec §5.1); a payout row has no
                  document view, so it stays a plain, non-interactive row. */}
              {row.kind === 'intake' ? (
                <button
                  type="button"
                  onClick={() => setReceiptId(row.id)}
                  className={cn(rowClassName, 'w-full text-left')}
                >
                  {rowContent}
                </button>
              ) : (
                <div className={rowClassName}>{rowContent}</div>
              )}
              {row.voided && row.reason ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('day.feed.voidedReason', { reason: row.reason })}
                </p>
              ) : null}
            </li>
          );
        })}
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
        stats={pointId && status !== 'none' && !isError ? stats : undefined}
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

      <ReceiptDialog
        key={receiptId}
        intakeId={receiptId}
        open={receiptId !== null}
        onClose={() => setReceiptId(null)}
      />
    </>
  );
}

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
import { toast } from '@/shared/ui/toast';
import { isTruncated } from '@/shared/api';
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
import { useMeQuery } from '@/entities/user';
import { useWorkingPoint } from '@/features/point-scope';
import { usePointOptionsQuery } from '@/entities/collection-point';
import { useShiftOnDateQuery, useCurrentShiftQuery, type Shift } from '@/entities/shift';
import { useIntakesQuery, type Intake } from '@/entities/intake';
import { usePayoutsQuery, type Payout } from '@/entities/payout';
import { useSuppliersQuery, supplierName } from '@/entities/supplier';
import { ReceiptDialog } from '@/widgets/receipt';
import {
  useOpenShiftMutation,
  useCloseShiftMutation,
  CountDrawerDialog,
  OpenShiftAlert,
} from '@/features/count-shift';
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

/** What the count dialog is open for: which verb, and — for a close — the
 *  shift it closes. */
type CountTarget = { mode: 'open' } | { mode: 'close'; shiftId: string };

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
  const { pointId, canPick, setPointId } = useWorkingPoint();
  const { data: points } = usePointOptionsQuery();
  const [dateParam, setDateParam] = useUrlParam('date');
  const today = todayIso();
  // A hand-edited (or stale-link) date is clamped rather than sent on: there is
  // no shift in the future, and a garbage param must not reach the API.
  const date = isRealIsoDate(dateParam) && dateParam <= today ? dateParam : today;

  const shift = useShiftOnDateQuery(pointId, date);
  const shiftId = shift.data?.id;
  // The point's open shift WHATEVER its date (#114). `shift` above only ever
  // answers about the date on screen, so a shift left open on an earlier day
  // is invisible to it — and «Відкрити зміну» offered on top of one is the
  // refusal (SHIFT_ALREADY_OPEN) recorded in #113.
  const current = useCurrentShiftQuery(pointId);
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
  const [reopenOpen, setReopenOpen] = useState(false);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  // Bumped on every open so the dialog remounts with fresh RHF defaults and no
  // banner from the refusal before it — the convention SetPriceDialog documents.
  const [reopenInstance, setReopenInstance] = useState(0);
  const [countInstance, setCountInstance] = useState(0);
  // What the count dialog is open FOR — captured at click time, not read back
  // off `shift` at submit time. The close click is the one moment the shift
  // being looked at is unambiguously the shift that closes; reading its id
  // later (after a mutation or a refetch could have moved `shift.data`) is
  // how a silent no-op crept in before.
  const [countTarget, setCountTarget] = useState<CountTarget | null>(null);
  // The COPY the dialog shows — set on every open click, but never reset on
  // close. `open={countTarget !== null}` alone drives visibility, so during
  // the close (exit) animation `countTarget` is already null while the
  // dialog is still on screen; resetting `countMode` too would flip a
  // closing close-dialog to the open copy for the ~100ms of that animation.
  // (That animation is CSS-driven and untestable under jsdom — no test covers it.)
  const [countMode, setCountMode] = useState<'open' | 'close'>('open');
  const openCountDialog = (target: CountTarget) => {
    setCountInstance((n) => n + 1);
    setCountMode(target.mode); // copy, kept across the exit animation
    setCountTarget(target); // what will actually be submitted
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
  // ANY open shift at the point, whatever day it belongs to — deliberately a
  // WIDER question than the one `OpenShiftAlert` asks itself. The alert warns
  // only about a shift left behind on an EARLIER day; the server refuses a
  // second shift regardless, so the button must go away for all of them,
  // including one dated today that `shift` above has not caught up with yet.
  // While the read is in flight the answer is unknown, which is not the same
  // as «none» — the toolbar waits, exactly as it does for `isLoadingShift`.
  const mayOpenShift = current.data == null && !current.isPending;

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
  const truncated = isTruncated(intakes.data) || isTruncated(payouts.data);

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
      {/* §6.8's «бій», read back after the close. `=== null`, never `??` or a
          falsy test: `0` is «нічого не побилось» — a number the operator typed
          — and «—» is «не записано», which is every shift closed before this
          column existed. Gated on `closed` because the CHECK allows a number
          nowhere else, and a reopen clears it back to `null`. */}
      {!shift.isError && !isLoadingShift && status === 'closed' && shift.data ? (
        <Badge variant="outline">
          {t('day.count.brokenSummary')}:{' '}
          {shift.data.broken_crates === null ? '—' : shift.data.broken_crates}
        </Badge>
      ) : null}
      {!shift.isError &&
      !isLoadingShift &&
      isOperator &&
      isToday &&
      status === 'none' &&
      mayOpenShift &&
      pointId ? (
        <Button onClick={() => openCountDialog({ mode: 'open' })} disabled={open.isPending}>
          {t('day.open')}
        </Button>
      ) : null}
      {/* `shiftId` in the condition (not just `status === 'open'`) is what lets
          the branch below narrow it to `string` for the click handler — no
          separate runtime guard needed for a state that can't happen anyway. */}
      {!shift.isError && !isLoadingShift && isOperator && status === 'open' && shiftId ? (
        <Button variant="outline" onClick={() => openCountDialog({ mode: 'close', shiftId })}>
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
            <li key={`${row.kind}-${row.id}`} className="py-2.5">
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
      {/* `children` REPLACES `sections` in DashboardPage, and the truncation
          notice has to sit above the feed rather than inside its card — so
          the body is composed here from the same SectionCard the template
          would have used. Every write action now owns its own dialog-scoped
          error (Field's alert, or the dialog's own banner), so this page
          keeps no error state of its own. */}
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
        <OpenShiftAlert
          pointId={pointId}
          viewedDate={date}
          // Нікуди не йдемо — це та сама сторінка, змінюється лише дата в URL.
          onGoToDate={setDateParam}
        />
        {truncated ? (
          <p className="-mt-2 mb-4 text-xs text-muted-foreground">
            {t('day.tiles.truncated', { count: feed.length })}
          </p>
        ) : null}
        <SectionCard eyebrow={t('day.feed.title')}>{feedContent}</SectionCard>
      </DashboardPage>

      <CountDrawerDialog
        key={`count-${countInstance}`}
        mode={countMode}
        // Той самий id, що й ціль підрахунку — «з ягодою» читається саме для
        // зміни, яку зараз закривають, а не для тієї, що на екрані.
        shiftId={countTarget?.mode === 'close' ? countTarget.shiftId : null}
        open={countTarget !== null}
        onClose={() => setCountTarget(null)}
        onConfirm={async (counted_amount, broken_crates) => {
          if (countTarget === null) {
            // The dialog can only confirm while it is open, and it is only
            // open when `countTarget` is set — reaching here with no target
            // is a programming error, not a state a user action can cause.
            // Throwing lets the dialog's own catch show its fallback banner
            // instead of a silent no-op that looks like success.
            throw new Error('count dialog confirmed without a target');
          }
          if (countTarget.mode === 'open') {
            await open.mutateAsync({ counted_amount });
            toast.success(t('day.toast.opened'));
          } else {
            if (broken_crates === null) {
              // Діалог у режимі закриття завжди дає число (поле обов'язкове,
              // `0` включно). `null` тут означає, що режим і колбек розійшлись —
              // це помилка коду, а не дія користувача.
              throw new Error('close confirmed without a breakage count');
            }
            await close.mutateAsync({ id: countTarget.shiftId, counted_amount, broken_crates });
            toast.success(t('day.toast.closed'));
          }
          setCountTarget(null);
        }}
      />
      {shift.data ? (
        <ReopenShiftDialog
          key={`reopen-${reopenInstance}`}
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

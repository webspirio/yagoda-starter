import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Printer } from 'lucide-react';
import { PageHeader } from '@/shared/ui/page-header';
import { SelectField } from '@/shared/ui/select-field';
import { DateStepper } from '@/shared/ui/date-stepper';
import { Button } from '@/shared/ui/button';
import { Spinner } from '@/shared/ui/spinner';
import { useUrlParam } from '@/shared/lib/url-state';
import {
  todayIso,
  addDaysIso,
  isRealIsoDate,
  formatShortDate,
  formatLongDate,
} from '@/shared/lib/date';
import { useWorkingPoint } from '@/features/point-scope';
import { usePointOptionsQuery } from '@/entities/collection-point';
import { useShiftOnDateQuery } from '@/entities/shift';
import { useCostOfDayQuery, useNetworkCostOfDayQuery } from '@/entities/cost-of-day';
import { useDayExpensesQuery } from '@/entities/day-expense';
import type { CostOfDay } from '@/entities/cost-of-day';
import { StatusChips } from './StatusChips';
import { ExpensesStrip } from './ExpensesStrip';
import { CostTable } from './CostTable';
import { ChecksDisclosure } from './ChecksDisclosure';
import { NetworkCostOfDay } from './NetworkCostOfDay';

/** `?point=all` — «Усі точки». Not a uuid, so `usePointScope` drops it and
 *  no other screen ever reads it; `setPointId` is never called with it, so
 *  it is never remembered either. */
const ALL_POINTS = 'all';

/**
 * The day's body below the title row. A component of its own so the checks
 * disclosure's `open` state can be keyed on the shift: it starts open when a
 * check failed, and stepping to another cached date must re-derive that
 * rather than carry the last day's choice over.
 */
function CostOfDayBody({
  day,
  expenses,
  locale,
}: {
  day: CostOfDay;
  expenses: React.ComponentProps<typeof ExpensesStrip>['expenses'];
  locale: string;
}) {
  const { t } = useTranslation();
  const [checksOpen, setChecksOpen] = useState(
    day.checks !== null && !(day.checks.shares_ok && day.checks.total_ok),
  );

  return (
    <div className="flex flex-col gap-4">
      <StatusChips
        day={day}
        locale={locale}
        onChecksClick={() => {
          setChecksOpen(true);
          document.getElementById('cost-checks')?.scrollIntoView({ block: 'nearest' });
        }}
      />
      {/* The strip is the ONLY write path to `day_expenses`, and the server
          keeps counting its lines in expenses_amount/basket/per_kg even when
          every intake on the day is voided — so it stays reachable whenever a
          shift exists, not just when there are products. The table alone falls
          back to the empty-day message. */}
      {/* KEYED ON THE SHIFT, and that key is load-bearing. The strip holds the
          half-typed expense — label, amount, and which line is open for
          editing — in its own state, and stepping to another date only
          RE-RENDERS this tree: the queries for a day already visited come back
          from cache with `isPending` false, so the pending branch never
          unmounts anything. Without the key the words typed against one day
          stay in the form while `shift_id` has moved to another, and «Додати»
          writes them to the wrong business day. A draft belongs to its shift
          and should die with it — the same rule `pages/reweigh` applies by
          clearing its drafts when (date, point) changes. */}
      <ExpensesStrip
        key={day.shift_id}
        day={day}
        expenses={expenses}
        shiftId={day.shift_id}
        locale={locale}
      />
      {day.products.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t('costOfDay.noIntake')}</p>
      ) : (
        <CostTable day={day} locale={locale} />
      )}
      <ChecksDisclosure day={day} locale={locale} open={checksOpen} onOpenChange={setChecksOpen} />
    </div>
  );
}

/**
 * §8.4 «Собівартість дня» — where the whole §8 slice converges. The
 * reweigh reconciliation, the top-up allocation and the day's expenses are
 * all inputs to exactly this screen.
 *
 * THE DATE IS LOCAL, and `?date=` is this screen's own: the owner works
 * through yesterday's day while the points are still buying today, so a
 * global date would move the working day under the very people being checked.
 * Copied from «Каса за день» (now `pages/point-cash`, #221) and `pages/reweigh`,
 * clamp included.
 *
 * THE POINT PICKER IS NOT FILTERED BY `kind`, and that is the one place this
 * screen deliberately differs from `pages/reweigh`. The base is a reception
 * point with wholesale prices that also happens to be where weighing happens
 * — it is why §8.6's network average sits below Шипинки — and filtering it
 * out here made the same day read two different ways on two screens.
 *
 * THREE READ STATES, never two. A failed `/collection-points` leaves every
 * downstream query disabled, and reporting that as «зміну не відкривали»
 * states a business fact about a shift nobody managed to read.
 *
 * «УСІ ТОЧКИ» is the picker's first option (client, 23.10 — it replaces the
 * separate «Середня ціна по мережі» page and the «Аркуш керівника», which was
 * only ever a printout): the same date, every point's day summed by the
 * server, no expense entry. The single-point reads are switched off while it
 * is on, and the network read while it is off.
 */
export function CostOfDayPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';

  const { pointId, canPick, setPointId } = useWorkingPoint();
  const pointsQuery = usePointOptionsQuery();
  const points = pointsQuery.data ?? [];

  const [pointParam, setPointParam] = useUrlParam('point');
  const allPoints = canPick && pointParam === ALL_POINTS;

  const [dateParam, setDateParam] = useUrlParam('date');
  const today = todayIso();
  const date = isRealIsoDate(dateParam) && dateParam <= today ? dateParam : today;

  const shift = useShiftOnDateQuery(allPoints ? null : pointId, date);
  const shiftId = allPoints ? undefined : shift.data?.id;
  const cost = useCostOfDayQuery(shiftId);
  const expenses = useDayExpensesQuery(shiftId);
  const network = useNetworkCostOfDayQuery(allPoints ? date : null);

  const readsPending = allPoints
    ? pointsQuery.isPending || network.isPending
    : pointsQuery.isPending ||
      (pointId !== null && shift.isPending) ||
      (shiftId !== undefined && (cost.isPending || expenses.isPending));
  const readsFailed = allPoints
    ? pointsQuery.isError || network.isError
    : pointsQuery.isError || shift.isError || cost.isError || expenses.isError;

  const pointName = allPoints
    ? t('costOfDay.network.allPoints')
    : (points.find((p) => p.id === pointId)?.name ?? '—');
  const day = cost.data;
  const networkDay = network.data;

  const actions = (
    <div className="print-hide flex flex-wrap items-center gap-2">
      {canPick ? (
        <SelectField
          aria-label={t('costOfDay.point')}
          value={allPoints ? ALL_POINTS : (pointId ?? '')}
          onChange={(e) =>
            e.target.value === ALL_POINTS
              ? setPointParam(ALL_POINTS)
              : setPointId(e.target.value || null)
          }
          className="w-44"
        >
          <option value={ALL_POINTS}>{t('costOfDay.network.allPoints')}</option>
          {points.map((p) => (
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
        onToday={date === today ? undefined : () => setDateParam(today)}
        canNext={date < today}
      />
      <Button variant="outline" size="sm" onClick={() => window.print()}>
        <Printer className="size-4" />
        {t('costOfDay.print')}
      </Button>
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-5 px-4 py-6">
      <PageHeader
        eyebrow={t('costOfDay.eyebrow')}
        title={t('costOfDay.title')}
        description={t('costOfDay.description')}
        actions={actions}
      />

      {readsFailed ? (
        <p role="alert" className="py-6 text-center text-destructive">
          {t('common.somethingWentWrong')}
        </p>
      ) : readsPending ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : allPoints ? (
        !networkDay || networkDay.points.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t('costOfDay.network.noShifts', { date: formatShortDate(date, locale) })}
          </p>
        ) : (
          <div className="printable print-landscape rounded-xl bg-card p-5 ring-1 ring-foreground/10">
            <SheetHeading date={date} pointName={pointName} locale={locale} />
            <NetworkCostOfDay day={networkDay} locale={locale} />
          </div>
        )
      ) : !day ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {t('costOfDay.noShift', { date: formatShortDate(date, locale), point: pointName })}
        </p>
      ) : (
        <div className="printable print-landscape rounded-xl bg-card p-5 ring-1 ring-foreground/10">
          <SheetHeading date={date} pointName={pointName} locale={locale} />

          <CostOfDayBody
            key={day.shift_id}
            day={day}
            expenses={expenses.data ?? []}
            locale={locale}
          />
        </div>
      )}
    </div>
  );
}

/** The sheet's title on paper and its name-and-date line on screen — the
 *  same for one point and for «Усі точки». */
function SheetHeading({
  date,
  pointName,
  locale,
}: {
  date: string;
  pointName: string;
  locale: string;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="print-only mb-4">
        <div className="font-display text-lg font-semibold">
          {t('costOfDay.sheetTitle', { date: formatLongDate(date, locale), point: pointName })}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border pb-3">
        <span className="font-display text-lg leading-none font-medium">{pointName}</span>
        <span className="font-mono text-xs text-muted-foreground">
          {formatShortDate(date, locale)}
        </span>
      </div>
    </>
  );
}

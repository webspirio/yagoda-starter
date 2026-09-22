import { useTranslation } from 'react-i18next';
import { Printer } from 'lucide-react';
import { PageHeader } from '@/shared/ui/page-header';
import { SelectField } from '@/shared/ui/select-field';
import { DateStepper } from '@/shared/ui/date-stepper';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';
import { Spinner } from '@/shared/ui/spinner';
import { useUrlParam } from '@/shared/lib/url-state';
import {
  todayIso,
  addDaysIso,
  isRealIsoDate,
  formatShortDate,
  formatLongDate,
  formatDateTime,
} from '@/shared/lib/date';
import { useWorkingPoint } from '@/features/point-scope';
import { usePointOptionsQuery } from '@/entities/collection-point';
import { useShiftOnDateQuery } from '@/entities/shift';
import { useCostOfDayQuery } from '@/entities/cost-of-day';
import { useDayExpensesQuery } from '@/entities/day-expense';
import { BerryTable } from './BerryTable';
import { ExpensesPanel } from './ExpensesPanel';
import { FinalPrices } from './FinalPrices';

/**
 * §8.4 «Собівартість дня» — where the whole §8 slice converges. The
 * reweigh reconciliation, the top-up allocation and the day's expenses are
 * all inputs to exactly this screen.
 *
 * THE DATE IS LOCAL, and `?date=` is this screen's own: the owner works
 * through yesterday's day while the points are still buying today, so a
 * global date would move the working day under the very people being checked.
 * Copied from `pages/day` and `pages/reweigh`, clamp included.
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
 */
export function CostOfDayPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';

  const { pointId, canPick, setPointId } = useWorkingPoint();
  const pointsQuery = usePointOptionsQuery();
  const points = pointsQuery.data ?? [];

  const [dateParam, setDateParam] = useUrlParam('date');
  const today = todayIso();
  const date = isRealIsoDate(dateParam) && dateParam <= today ? dateParam : today;

  const shift = useShiftOnDateQuery(pointId, date);
  const shiftId = shift.data?.id;
  const cost = useCostOfDayQuery(shiftId);
  const expenses = useDayExpensesQuery(shiftId);

  const readsPending =
    pointsQuery.isPending ||
    (pointId !== null && shift.isPending) ||
    (shiftId !== undefined && (cost.isPending || expenses.isPending));
  const readsFailed = pointsQuery.isError || shift.isError || cost.isError || expenses.isError;

  const pointName = points.find((p) => p.id === pointId)?.name ?? '—';
  const day = cost.data;

  const actions = (
    <div className="print-hide flex flex-wrap items-center gap-2">
      {canPick ? (
        <SelectField
          aria-label={t('costOfDay.point')}
          value={pointId ?? ''}
          onChange={(e) => setPointId(e.target.value || null)}
          className="w-44"
        >
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
      ) : !day ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {t('costOfDay.noShift', { date: formatShortDate(date, locale), point: pointName })}
        </p>
      ) : (
        <div className="printable print-landscape rounded-xl bg-card p-5 ring-1 ring-foreground/10">
          <div className="print-only mb-4">
            <div className="font-display text-lg font-semibold">
              {t('costOfDay.sheetTitle', {
                date: formatLongDate(date, locale),
                point: pointName,
              })}
            </div>
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border pb-3">
            <span className="font-display text-lg leading-none font-medium">{pointName}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {formatShortDate(date, locale)}
            </span>
            {day.provisional ? (
              <Badge variant="outline" className="border-[var(--amber)]/40 text-[var(--amber)]">
                {t('costOfDay.provisional')}
              </Badge>
            ) : null}
            {day.top_ups_latest_at ? (
              <Badge variant="secondary" className="font-normal">
                {t('costOfDay.topUps', { at: formatDateTime(day.top_ups_latest_at, locale) })}
              </Badge>
            ) : null}
          </div>

          {day.products.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t('costOfDay.noIntake')}
            </p>
          ) : (
            <>
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(290px,0.6fr)]">
                <BerryTable
                  products={day.products}
                  reweighedKg={day.reweighed_kg}
                  accrued={day.accrued}
                  locale={locale}
                />
                <ExpensesPanel
                  day={day}
                  expenses={expenses.data ?? []}
                  shiftId={day.shift_id}
                  locale={locale}
                />
              </div>
              {day.per_kg === null ? null : <FinalPrices day={day} locale={locale} />}
            </>
          )}
        </div>
      )}
    </div>
  );
}

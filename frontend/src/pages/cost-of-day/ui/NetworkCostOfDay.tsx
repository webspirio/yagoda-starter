import { Fragment } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { Badge } from '@/shared/ui/badge';
import { formatUah, unbreakable } from '@/shared/lib/money';
import { TraceScope } from '@/shared/ui/trace';
import type { NetworkCostOfDay as NetworkDay } from '@/entities/cost-of-day';
import { NetworkCostTable } from './NetworkCostTable';
import { DAY, pointExpensesId } from './trace-ids';
import { Term } from './terms';

/**
 * The «Усі точки» body: the day's state, the expenses each point entered, and
 * the network table. There is NO expense input here — an expense belongs to
 * one point (client, 23.10: «витрати — це стосується конкретної точки»), so
 * it is entered on that point's page and only read back here.
 */
export function NetworkCostOfDay({ day, locale }: { day: NetworkDay; locale: string }) {
  const { t } = useTranslation();
  const open = day.points.filter((p) => p.provisional).map((p) => p.point_name);
  const nothingWeighed = day.points.filter((p) => !p.weighed).map((p) => p.point_name);
  const spent = day.points.filter((p) => p.expenses_amount !== '0.00');
  const unspread = spent.filter((p) => !p.weighed);
  // «Шипинки 3 800,00 ₴ · Гайове 1 050,00 ₴» — each amount a traced figure, so
  // the day formula's «витрати» can point at the entries it spreads
  // (`shared/ui/trace`). The names are the owner's text: React children only.
  const list = (rows: typeof spent) => (
    <>
      {rows.map((p, i) => (
        <Fragment key={p.shift_id}>
          {i > 0 ? ' · ' : null}
          {p.point_name}{' '}
          <Term
            refs={pointExpensesId(p.shift_id)}
            tone="plum"
            hint={t('costOfDay.trace.pointExpenses', { point: p.point_name })}
          >
            {unbreakable(formatUah(p.expenses_amount, locale))}
          </Term>
        </Fragment>
      ))}
    </>
  );

  // ONE trace scope over the chips, the expenses line and the table with its
  // formulas: the day formula's «витрати» point up at the expenses line.
  return (
    <div className="flex flex-col gap-4">
      <TraceScope>
        <div className="flex flex-wrap items-center gap-2 print:gap-x-4">
          {open.length > 0 ? (
            <Badge variant="outline">
              <Clock aria-hidden />
              {t('costOfDay.network.status.open', { names: open.join(', ') })}
            </Badge>
          ) : (
            <Badge variant="outline">
              <CheckCircle2 aria-hidden />
              {t('costOfDay.network.status.allClosed')}
            </Badge>
          )}
          {nothingWeighed.length > 0 ? (
            <Badge variant="outline">
              <AlertTriangle aria-hidden />
              {t('costOfDay.network.status.nothingWeighed', { names: nothingWeighed.join(', ') })}
            </Badge>
          ) : null}
          {day.checks === null ? (
            <Badge variant="outline">{t('costOfDay.status.checksPending')}</Badge>
          ) : day.checks.points_ok && day.checks.total_ok ? (
            <Badge variant="outline" className="border-[var(--leaf)] text-[var(--leaf)]">
              <CheckCircle2 aria-hidden />
              {t('costOfDay.status.checked')}
            </Badge>
          ) : (
            <Badge variant="destructive">
              <XCircle aria-hidden />
              {t('costOfDay.status.mismatch')}
            </Badge>
          )}
        </div>

        {/* Read-only: every figure is a point's own expenses_amount or the
          server's Σ — the page adds nothing up. */}
        <div
          data-network-expenses
          className="rounded-lg bg-[var(--plum)]/8 px-3 py-2 text-sm text-[var(--plum)]"
        >
          <p>
            {spent.length === 0 ? (
              t('costOfDay.network.expenses.none')
            ) : spent.length === 1 ? (
              // One entry is its own total — «разом» would repeat it.
              <Trans
                t={t}
                i18nKey="costOfDay.network.expenses.listOne"
                components={{ list: list(spent) }}
              />
            ) : (
              <Trans
                t={t}
                i18nKey="costOfDay.network.expenses.list"
                values={{ total: unbreakable(formatUah(day.expenses_amount, locale)) }}
                components={{
                  list: list(spent),
                  total: (
                    <Term
                      refs={[DAY.expenses, ...spent.map((p) => pointExpensesId(p.shift_id))]}
                      tone="plum"
                      hint={t('costOfDay.trace.expensesTotal')}
                    />
                  ),
                }}
              />
            )}
          </p>
          {unspread.length > 0 ? (
            <p className="text-xs">
              <Trans
                t={t}
                i18nKey="costOfDay.network.expenses.unspread"
                components={{ list: list(unspread) }}
              />
            </p>
          ) : null}
          <p className="print-hide text-xs text-muted-foreground">
            {t('costOfDay.network.expenses.where')}
          </p>
        </div>

        {day.products.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t('costOfDay.network.noIntake')}
          </p>
        ) : (
          <NetworkCostTable day={day} locale={locale} />
        )}
      </TraceScope>
    </div>
  );
}

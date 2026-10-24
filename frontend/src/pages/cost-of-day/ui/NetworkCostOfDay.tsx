import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { Badge } from '@/shared/ui/badge';
import { formatUah } from '@/shared/lib/money';
import type { NetworkCostOfDay as NetworkDay } from '@/entities/cost-of-day';
import { NetworkCostTable } from './NetworkCostTable';

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
  const list = (rows: typeof spent) =>
    rows.map((p) => `${p.point_name} ${formatUah(p.expenses_amount, locale)}`).join(' · ');

  return (
    <div className="flex flex-col gap-4">
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
          {spent.length === 0
            ? t('costOfDay.network.expenses.none')
            : spent.length === 1
              ? // One entry is its own total — «разом» would repeat it.
                t('costOfDay.network.expenses.listOne', { list: list(spent) })
              : t('costOfDay.network.expenses.list', {
                  list: list(spent),
                  total: formatUah(day.expenses_amount, locale),
                })}
        </p>
        {unspread.length > 0 ? (
          <p className="text-xs">
            {t('costOfDay.network.expenses.unspread', { list: list(unspread) })}
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
    </div>
  );
}

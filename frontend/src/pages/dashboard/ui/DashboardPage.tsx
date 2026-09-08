import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { DashboardPage as DashboardTemplate, type StatItem } from '@/shared/ui/templates/dashboard-page';
import { SectionCard } from '@/shared/ui/section-card';
import { Card } from '@/shared/ui/card';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { Spinner } from '@/shared/ui/spinner';
import { sum, cmp, formatUah } from '@/shared/lib/money';
import { todayIso, formatWeekday } from '@/shared/lib/date';
import { useMeQuery } from '@/entities/user';
import { usePointOptionsQuery } from '@/entities/collection-point';
import { useSupplierBalancesQuery, supplierName } from '@/entities/supplier';
import type { Shift } from '@/entities/shift';
import { useNetworkToday, type PointToday } from '../api/useNetworkToday';

/** Shift `Badge` variant for a point's row — open reads loud, closed and
 *  "needs an explanation" are quiet, and "no shift today" is the emptiest
 *  outline, same convention `pages/day` uses for its own toolbar badge. */
function shiftBadgeVariant(status: Shift['status'] | 'none'): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'open') return 'default';
  if (status === 'awaiting_explanation') return 'destructive';
  if (status === 'closed') return 'secondary';
  return 'outline';
}

/**
 * «Зведення» — today across the network for the owner (shifts, receipts,
 * cash and the biggest balances, by point) and just the point's own row plus
 * three shortcuts for the operator. Both roles land on `/`; the content —
 * not the route — is what changes with role (§ overview-screens task 3).
 */
export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const { data: me, isPending: meIsPending } = useMeQuery();
  const {
    data: points,
    isPending: pointsIsPending,
    isError: pointsIsError,
  } = usePointOptionsQuery();

  const isOwner = me?.role === 'network_owner';
  const activePoints = points ?? [];
  const today = todayIso();

  const pointIds = isOwner
    ? activePoints.map((p) => p.id)
    : me?.collection_point_id
      ? [me.collection_point_id]
      : [];

  const network = useNetworkToday(pointIds);
  // The balances read is network-wide and owner-only — an operator never
  // fires it at all (`enabled: false`), not merely discards its result.
  const balances = useSupplierBalancesQuery({ includeZero: false, enabled: isOwner });

  const isPending =
    meIsPending || (isOwner && pointsIsPending) || network.isPending || (isOwner && balances.isPending);
  const isError = network.isError || (isOwner && (pointsIsError || balances.isError));

  const pointName = (id: string) => activePoints.find((p) => p.id === id)?.name ?? '';

  const openCount = network.rows.filter((r) => r.shift?.status === 'open').length;
  const totalReceipts = network.rows.reduce((n, r) => n + r.receipts, 0);
  const totalAccrued = sum(network.rows.map((r) => r.accrued));
  const totalPaid = sum(network.rows.map((r) => r.paid));

  const balanceRows = balances.data?.data ?? [];
  const positiveDebt = sum(balanceRows.filter((b) => cmp(b.debt, '0') === 1).map((b) => b.debt));
  const balancesTruncated = (balances.data?.total ?? 0) > 100;
  const topBalances = balanceRows.slice(0, 5);

  const stats: StatItem[] = [
    { label: t('dashboard.tiles.pointsOpen'), value: `${openCount} / ${activePoints.length}` },
    { label: t('dashboard.tiles.receipts'), value: String(totalReceipts) },
    { label: t('dashboard.tiles.accrued'), value: formatUah(totalAccrued, i18n.language) },
    { label: t('dashboard.tiles.paid'), value: formatUah(totalPaid, i18n.language), tone: 'berry' },
    {
      label: t('dashboard.tiles.balances'),
      value: formatUah(positiveDebt, i18n.language),
      hint: balancesTruncated ? t('dashboard.tiles.balancesHint') : undefined,
      tone: 'amber',
    },
  ];

  const pointRow = (row: PointToday, withLinks: boolean) => {
    const status: Shift['status'] | 'none' = row.shift?.status ?? 'none';
    return (
      <Card key={row.pointId} className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-medium">{pointName(row.pointId)}</div>
            <Badge variant={shiftBadgeVariant(status)} className="mt-1">
              {t(`dashboard.points.status.${status}`)}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            <span>
              {t('dashboard.tiles.receipts')}: <span className="font-mono text-foreground">{row.receipts}</span>
            </span>
            <span>
              {t('dashboard.tiles.accrued')}:{' '}
              <span className="font-mono text-foreground">{formatUah(row.accrued, i18n.language)}</span>
            </span>
            <span>
              {t('dashboard.tiles.paid')}:{' '}
              <span className="font-mono text-foreground">{formatUah(row.paid, i18n.language)}</span>
            </span>
          </div>
          {withLinks ? (
            <div className="flex items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <Link to={`/day?point=${row.pointId}`}>{t('dashboard.points.dayCash')}</Link>
              </Button>
              <Button asChild size="sm">
                <Link to={`/reception?point=${row.pointId}`}>{t('dashboard.points.reception')}</Link>
              </Button>
            </div>
          ) : null}
        </div>
      </Card>
    );
  };

  const body = isError ? (
    <p role="alert" className="py-6 text-center text-destructive">
      {t('common.somethingWentWrong')}
    </p>
  ) : isPending ? (
    <div className="flex justify-center py-12">
      <Spinner />
    </div>
  ) : isOwner ? (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(300px,1fr)]">
      <SectionCard eyebrow={t('dashboard.points.title')}>
        {network.rows.length === 0 ? (
          <EmptyState title={t('dashboard.points.empty')} />
        ) : (
          <div className="space-y-3">{network.rows.map((row) => pointRow(row, true))}</div>
        )}
      </SectionCard>
      <SectionCard eyebrow={t('dashboard.topBalances.title')}>
        {topBalances.length === 0 ? (
          <EmptyState title={t('dashboard.topBalances.empty')} />
        ) : (
          <ul className="divide-y divide-border">
            {topBalances.map((b) => (
              <li key={b.supplier_id}>
                <Link
                  to={`/debts?point=${b.collection_point_id}`}
                  className="flex items-center justify-between gap-3 py-2.5 text-sm transition-colors hover:bg-muted/60"
                >
                  <span className="min-w-0 truncate">
                    {supplierName(b)} · {pointName(b.collection_point_id)}
                  </span>
                  <span className="ml-auto shrink-0 font-mono tabular-nums">
                    {formatUah(b.debt, i18n.language)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  ) : (
    <div className="space-y-4">
      {network.rows[0] ? pointRow(network.rows[0], false) : null}
      <SectionCard>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link to="/reception">{t('dashboard.shortcuts.reception')}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/day">{t('dashboard.shortcuts.dayCash')}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/debts">{t('dashboard.shortcuts.balances')}</Link>
          </Button>
        </div>
      </SectionCard>
    </div>
  );

  return (
    <DashboardTemplate
      eyebrow={t('dashboard.eyebrow', {
        weekday: formatWeekday(today, i18n.language),
        year: today.slice(0, 4),
      })}
      title={t('dashboard.title')}
      description={t(isOwner ? 'dashboard.description' : 'dashboard.operatorDescription')}
      stats={isOwner && !isPending && !isError ? stats : undefined}
      statColumns={5}
    >
      {body}
    </DashboardTemplate>
  );
}

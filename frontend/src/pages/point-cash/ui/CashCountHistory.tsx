import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TriangleAlert } from 'lucide-react';
import { SectionCard } from '@/shared/ui/section-card';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { cn } from '@/shared/lib/cn';
import { formatUah } from '@/shared/lib/money';
import { formatShortDate } from '@/shared/lib/date';
import { useCashCountsQuery, type CashCount } from '@/entities/cash-count';
import { ExplainDiscrepancyDialog } from '@/features/set-cash-explanation';

/**
 * §7.6's journal for one point — every drawer count, opening/midday/closing
 * alike, read-only by design: there is no edit here, only `ExplainDiscrepancyDialog`
 * (§7.7, owner only) which never moves the counted or expected figure, only
 * attaches a reason to a discrepancy that already happened.
 */
export function CashCountHistory({
  pointId,
  isOwner,
}: {
  pointId: string;
  isOwner: boolean;
}) {
  const { t, i18n } = useTranslation();
  const counts = useCashCountsQuery({ pointId });
  const [explainTarget, setExplainTarget] = useState<CashCount | null>(null);
  const rows = counts.data?.data ?? [];

  const columns: Column<CashCount>[] = [
    {
      id: 'when',
      header: t('pointCash.countHistory.columns.when'),
      cell: (row) =>
        `${formatShortDate(row.business_date, i18n.resolvedLanguage)} · ${t(`pointCash.countHistory.kind.${row.kind}`)}`,
    },
    {
      id: 'counted',
      header: t('pointCash.countHistory.columns.counted'),
      align: 'right',
      className: 'font-mono tabular-nums',
      cell: (row) => formatUah(row.counted_amount, i18n.resolvedLanguage),
    },
    {
      id: 'expected',
      header: t('pointCash.countHistory.columns.expected'),
      align: 'right',
      className: 'font-mono tabular-nums',
      cell: (row) => formatUah(row.expected_amount, i18n.resolvedLanguage),
    },
    {
      id: 'discrepancy',
      header: t('pointCash.countHistory.columns.discrepancy'),
      align: 'right',
      className: 'font-mono tabular-nums',
      cell: (row) => (
        <span className={cn(row.is_open && 'font-medium text-destructive')}>
          {row.is_open ? <TriangleAlert className="mr-1 inline size-3.5" aria-hidden="true" /> : null}
          {formatUah(row.discrepancy, i18n.resolvedLanguage)}
        </span>
      ),
    },
    {
      id: 'explanation',
      header: t('pointCash.countHistory.columns.explanation'),
      cell: (row) =>
        row.explanation ? (
          <span className="text-sm italic text-muted-foreground">{row.explanation}</span>
        ) : row.is_open && isOwner ? (
          <Button size="xs" variant="outline" onClick={() => setExplainTarget(row)}>
            {t('pointCash.countHistory.explain')}
          </Button>
        ) : row.is_open ? (
          <span className="text-xs text-muted-foreground">{t('pointCash.countHistory.open')}</span>
        ) : (
          <span className="text-xs text-muted-foreground">{t('pointCash.countHistory.matched')}</span>
        ),
    },
  ];

  return (
    <SectionCard eyebrow={t('pointCash.countHistory.title')}>
      {rows.length === 0 ? (
        <EmptyState title={t('pointCash.countHistory.empty')} />
      ) : (
        <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} frame={false} />
      )}

      {explainTarget ? (
        <ExplainDiscrepancyDialog
          shiftId={explainTarget.shift_id}
          discrepancy={explainTarget.discrepancy}
          open
          onClose={() => setExplainTarget(null)}
        />
      ) : null}
    </SectionCard>
  );
}

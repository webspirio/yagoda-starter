import { useTranslation } from 'react-i18next';
import { StatGrid } from '@/shared/ui/stat-grid';
import { StatTile } from '@/shared/ui/stat-tile';
import { sub, isZero, formatUah, formatKg } from '@/shared/lib/money';
import type { DaySummary } from '../lib/daySummary';

/**
 * The day's four tiles — what «Каса за день» had in its header, a row of its
 * own here (#221) because «Каса точки»'s header already answers a different
 * question: what the drawer holds, not what moved through it on the date.
 *
 * Rendered only once the page has a shift and both journals (`figuresVisible`
 * on the page) — a zero here over an unread journal would read as «nothing
 * happened».
 */
export function DayTiles({
  summary,
  truncated,
  shown,
}: {
  summary: DaySummary;
  truncated: boolean;
  /** How many documents the feed carries — named in the truncation note. */
  shown: number;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;

  return (
    <div className="mb-5">
      {truncated ? (
        <p className="mb-2 text-xs text-muted-foreground">
          {t('day.tiles.truncated', { count: shown })}
        </p>
      ) : null}
      <StatGrid columns={4}>
        <StatTile
          label={t('day.tiles.received')}
          value={formatKg(summary.netKg, locale)}
          hint={t('day.tiles.receipts', { count: summary.receipts })}
        />
        <StatTile
          label={t('day.tiles.accrued')}
          value={formatUah(summary.accrued, locale)}
          hint={t('day.tiles.accruedHint')}
        />
        <StatTile
          label={t('day.tiles.cashOut')}
          value={formatUah(summary.cashOut, locale)}
          hint={t('day.tiles.cashOutHint')}
          tone="berry"
        />
        {/* The corrected «Інваріант дня» shows the GROWTH of the debt, which
            goes below zero when old balances were paid down OR when a receipt
            was voided with its payout still live — the two are
            indistinguishable without allocations, so the label names the
            fact, not a cause. */}
        {summary.paidDown ? (
          <StatTile
            label={t('day.tiles.debtPaidDown')}
            value={formatUah(sub('0', summary.debtGrowth), locale)}
            hint={t('day.tiles.debtPaidDownHint')}
          />
        ) : (
          <StatTile
            label={t('day.tiles.debtCreated')}
            value={formatUah(summary.debtGrowth, locale)}
            hint={t('day.tiles.debtCreatedHint')}
            // §5.1: amber only while something is actually owed.
            tone={isZero(summary.debtGrowth) ? 'default' : 'amber'}
          />
        )}
      </StatGrid>
    </div>
  );
}

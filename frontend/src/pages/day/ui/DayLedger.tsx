import { useTranslation } from 'react-i18next';
import { SectionCard } from '@/shared/ui/section-card';
import { LedgerRow } from '@/shared/ui/ledger-row';
import { sub, isNegative, isZero, formatUah } from '@/shared/lib/money';
import type { DaySummary } from '../lib/daySummary';

/** An outflow printed with the mock's `uahAuto` sign: «−» out, «+» back in,
 *  and a zero bare — «−0,00» would read as money that left. */
function signed(value: string, locale: string): string {
  if (isZero(value)) return formatUah(value, locale);
  return isNegative(value)
    ? `+${formatUah(sub('0', value), locale)}`
    : `−${formatUah(value, locale)}`;
}

/**
 * «Звірка каси» — the day's accrued sum taken apart, per the corrected
 * «Інваріант дня»: accrued − cash with a receipt − cash without one − growth of
 * the debt = 0 by construction. That is why there is no «Розбіжність» row: the
 * mock checks per-line `paid + debt` against the line amount, and here debt is
 * derived, never stored, so there is nothing that could disagree.
 */
export function DayLedger({ summary }: { summary: DaySummary }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const paidDown = isNegative(summary.debtGrowth);

  return (
    <SectionCard eyebrow={t('day.ledger.title')}>
      <div className="flex flex-col">
        <LedgerRow
          label={t('day.ledger.accrued')}
          value={formatUah(summary.accrued, locale)}
          strong
        />
        <LedgerRow
          label={t('day.ledger.paidAtReception')}
          hint={t('day.ledger.paidAtReceptionHint')}
          value={signed(summary.paidAtReception, locale)}
          indent
        />
        {isZero(summary.paidWithoutBerry) ? null : (
          <LedgerRow
            label={t('day.ledger.paidWithoutBerry')}
            value={signed(summary.paidWithoutBerry, locale)}
            indent
          />
        )}
        <LedgerRow
          label={t(paidDown ? 'day.ledger.debtPaidDown' : 'day.ledger.debtCreated')}
          value={signed(summary.debtGrowth, locale)}
          indent
          tone={paidDown || isZero(summary.debtGrowth) ? 'default' : 'amber'}
        />
      </div>

      <div className="mt-5 flex items-center justify-between rounded-lg bg-foreground px-4 py-3 text-background">
        <span className="text-sm font-medium">{t('day.ledger.cashOut')}</span>
        <span className="font-mono text-xl font-semibold tabular-nums">
          {formatUah(summary.cashOut, locale)}
        </span>
      </div>

      {isZero(summary.voidedNotReturned) ? null : (
        <p className="mt-2 text-xs text-[var(--amber)]">
          {t('day.ledger.voidedNotReturned', {
            amount: formatUah(summary.voidedNotReturned, locale),
          })}
        </p>
      )}
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{t('day.ledger.note')}</p>
    </SectionCard>
  );
}

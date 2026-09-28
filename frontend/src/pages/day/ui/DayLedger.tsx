import { useTranslation } from 'react-i18next';
import { SectionCard } from '@/shared/ui/section-card';
import { LedgerRow } from '@/shared/ui/ledger-row';
import { sub, isNegative, isZero, formatUah } from '@/shared/lib/money';
import type { DaySummary } from '../lib/daySummary';

/**
 * A term of the decomposition «accrued − … = 0», printed with the mock's
 * `uahAuto` sign: «−» subtracts from the accrued sum, «+» adds to it, and a
 * zero stays bare. For the two payout rows that is also the cash direction;
 * for the debt row it is NOT — «−250» there is money that stayed in the
 * drawer, «+200» money that left it beyond the accrued sum. Read the column as
 * arithmetic, not as a cash flow.
 */
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
export function DayLedger({ summary, truncated }: { summary: DaySummary; truncated: boolean }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const { paidDown } = summary;

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

      {/* The plaque is the drawer's reading and counts voided payouts; the
          rows above are the debt's and do not. This line is the difference. */}
      {isZero(summary.voidedOut) ? null : (
        <p className="mt-2 text-xs text-[var(--amber)]">
          {isZero(summary.voidedNotReturned)
            ? t('day.ledger.voidedReturned', { voided: formatUah(summary.voidedOut, locale) })
            : t('day.ledger.voidedNotReturned', {
                voided: formatUah(summary.voidedOut, locale),
                notReturned: formatUah(summary.voidedNotReturned, locale),
              })}
        </p>
      )}
      {truncated ? (
        <p className="mt-2 text-xs text-muted-foreground">{t('day.ledger.truncated')}</p>
      ) : null}
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{t('day.ledger.note')}</p>
    </SectionCard>
  );
}

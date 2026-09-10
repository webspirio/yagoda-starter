import { useTranslation } from 'react-i18next';
import { SectionCard } from '@/shared/ui/section-card';
import { LedgerRow as LedgerRowView } from '@/shared/ui/ledger-row';
import { sub, isNegative, formatUah } from '@/shared/lib/money';
import { buildLedger, type LedgerIntake, type LedgerPayout, type LedgerTransfer } from '../lib/buildLedger';

/** Rows that read as money OUT get their sign flipped for display —
 *  `buildLedger` itself only ever returns non-negative magnitudes. */
const OUTFLOW = new Set(['paidToday', 'paidPast']);

/**
 * «Звідки взялося це число» — the schedule behind the point's cash figure.
 *
 * THE TOTAL AT THE BOTTOM IS `cash`, THE PROP — NEVER A SUM OF THE ROWS
 * ABOVE IT. `GET /point-cash/:pointId` is one SQL formula on the backend;
 * this component's own rows are a client-side DISPLAY reconstruction from
 * `intakes`/`payouts`/`transfers` that may be built from an incomplete page
 * of documents (§ Task 19 rule 1). If the two disagree, printing the sum of
 * the rows instead of `cash` would hide that gap — a quiet discrepancy is
 * worse than a visible one, so this component never computes its own total.
 */
export function CashLedger({
  date,
  cash,
  intakes,
  payouts,
  transfers,
}: {
  date: string;
  cash: string;
  intakes: LedgerIntake[];
  payouts: LedgerPayout[];
  transfers: LedgerTransfer[];
}) {
  const { t, i18n } = useTranslation();
  const rows = buildLedger({ date, intakes, payouts, transfers });
  const locale = i18n.resolvedLanguage;

  return (
    <SectionCard eyebrow={t('pointCash.ledger.title')}>
      <div className="flex flex-col">
        {rows.map((row) => (
          <LedgerRowView
            key={row.key}
            label={t(`pointCash.ledger.${row.key}`)}
            value={formatUah(OUTFLOW.has(row.key) ? sub('0', row.value) : row.value, locale)}
            tone={row.key === 'cashIn' ? 'leaf' : 'default'}
          />
        ))}
        <div className="my-2 border-t border-border" />
        <LedgerRowView
          label={t('pointCash.ledger.total')}
          value={formatUah(cash, locale)}
          strong
          tone={isNegative(cash) ? 'bad' : 'default'}
        />
      </div>
    </SectionCard>
  );
}

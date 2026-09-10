import { Fragment } from 'react';
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
 *
 * `accruedToday` IS RENDERED SEPARATELY FROM THE FOUR ROWS THAT ACTUALLY
 * MOVE CASH, behind its own divider and a muted "does not move cash" hint
 * (review round 1, finding 3): berries received today change what the point
 * owes a supplier, never what is in its drawer, and under a heading that
 * promises to explain the cash figure, an identically-styled row invites a
 * reader to add it in and get the wrong number.
 */
export function CashLedger({
  date,
  cash,
  intakes,
  payouts,
  transfers,
  payoutsTruncated = false,
}: {
  date: string;
  cash: string;
  intakes: LedgerIntake[];
  payouts: LedgerPayout[];
  transfers: LedgerTransfer[];
  /**
   * True when `payouts` is only the most recent page (`total` exceeds what
   * was actually fetched) — `paidPast` then covers recent history only, not
   * the whole of it, and says so rather than reading like a complete figure
   * (review round 1, finding 4).
   */
  payoutsTruncated?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const rows = buildLedger({ date, intakes, payouts, transfers });
  const locale = i18n.resolvedLanguage;

  const accrued = rows.find((r) => r.key === 'accruedToday');
  const movements = rows.filter((r) => r.key !== 'accruedToday');

  return (
    <SectionCard eyebrow={t('pointCash.ledger.title')}>
      <div className="flex flex-col">
        {accrued ? (
          <>
            <LedgerRowView
              label={t('pointCash.ledger.accruedToday')}
              hint={t('pointCash.ledger.accruedTodayHint')}
              value={formatUah(accrued.value, locale)}
              className="opacity-70"
            />
            <div className="my-2 border-b border-dashed border-border" />
          </>
        ) : null}

        {movements.map((row) => (
          <Fragment key={row.key}>
            <LedgerRowView
              label={t(`pointCash.ledger.${row.key}`)}
              value={formatUah(OUTFLOW.has(row.key) ? sub('0', row.value) : row.value, locale)}
              tone={row.key === 'cashIn' || row.key === 'returnedToday' ? 'leaf' : 'default'}
            />
            {row.key === 'paidPast' && payoutsTruncated ? (
              <p className="pb-1 text-xs text-muted-foreground">
                {t('pointCash.ledger.paidPastTruncated')}
              </p>
            ) : null}
          </Fragment>
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

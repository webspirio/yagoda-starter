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
 * Rows that do NOT explain today's cash figure, rendered apart from the
 * ones that do (review round 1 finding 3, extended in review round 2
 * finding 2). `accruedToday` never explained it — berries received move no
 * cash. `paidPast` joins it here now: it maps onto no term of
 * `movementsSql` — a payout from an earlier day is already folded into an
 * earlier drawer count, not into today's math — so treating it as part of
 * the explanation would assert a period this ledger never defines. See
 * `buildLedger`'s own comment for the full reasoning.
 */
const INFORMATIONAL = new Set(['accruedToday', 'paidPast']);

/**
 * Rows whose figure is drawn from the SAME possibly-truncated `payouts`
 * array (fix round 1, minor finding): `returnedToday` sums
 * `payouts.filter(p => p.return_settled_at !== null && …)` (`buildLedger.ts`)
 * over the identical array `paidPast` reads, so a settled return whose
 * original payout fell outside the fetched page vanishes with no caveat
 * unless this row carries the same warning `paidPast` does.
 */
const READS_FROM_PAYOUTS = new Set(['paidPast', 'returnedToday']);

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
 * `accruedToday`/`paidPast` ARE RENDERED SEPARATELY FROM THE THREE ROWS
 * THAT ACTUALLY MOVE CASH (`paidToday`/`returnedToday`/`cashIn`), behind a
 * shared divider, a muted tone and their own hint text: under a heading that
 * promises to explain the cash figure, a row that does not belong to that
 * explanation must not look like the ones that do — a reader sanity-checking
 * by addition would otherwise fold it in and get the wrong number.
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
   * was actually fetched) — `paidPast` AND `returnedToday` both read that
   * same array (see `READS_FROM_PAYOUTS`) and so both cover recent history
   * only, not the whole of it, and both say so rather than reading like a
   * complete figure (review round 1, finding 4; extended to `returnedToday`
   * in fix round 1's minor finding).
   */
  payoutsTruncated?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const rows = buildLedger({ date, intakes, payouts, transfers });
  const locale = i18n.resolvedLanguage;

  const informational = rows.filter((r) => INFORMATIONAL.has(r.key));
  const movements = rows.filter((r) => !INFORMATIONAL.has(r.key));

  const truncationCaveat = (key: string) =>
    READS_FROM_PAYOUTS.has(key) && payoutsTruncated ? (
      <p className="pb-1 text-xs text-muted-foreground">{t('pointCash.ledger.paidPastTruncated')}</p>
    ) : null;

  return (
    <SectionCard eyebrow={t('pointCash.ledger.title')}>
      <div className="flex flex-col">
        {informational.map((row) => (
          <Fragment key={row.key}>
            <LedgerRowView
              label={t(`pointCash.ledger.${row.key}`)}
              hint={t(`pointCash.ledger.${row.key}Hint`)}
              value={formatUah(OUTFLOW.has(row.key) ? sub('0', row.value) : row.value, locale)}
              className="opacity-70"
            />
            {truncationCaveat(row.key)}
          </Fragment>
        ))}
        <div className="my-2 border-b border-dashed border-border" />

        {movements.map((row) => (
          <Fragment key={row.key}>
            <LedgerRowView
              label={t(`pointCash.ledger.${row.key}`)}
              value={formatUah(OUTFLOW.has(row.key) ? sub('0', row.value) : row.value, locale)}
              tone={row.key === 'cashIn' || row.key === 'returnedToday' ? 'leaf' : 'default'}
            />
            {truncationCaveat(row.key)}
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

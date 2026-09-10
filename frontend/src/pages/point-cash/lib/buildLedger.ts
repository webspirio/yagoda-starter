import { sum } from '@/shared/lib/money';

/** One line of `GET /intakes` the ledger cares about. */
export interface LedgerIntake {
  business_date: string;
  amount: string;
  voided_at: string | null;
}

/** One line of `GET /payouts` the ledger cares about. */
export interface LedgerPayout {
  business_date: string;
  amount: string;
  voided_at: string | null;
}

/**
 * One line of `GET /transfers` the ledger cares about. `status` is part of
 * the shape (the backend always sends it, and every fixture in this module's
 * tests carries it) but is never READ below: a transfer still `sent` has
 * `accepted_date: null`, which the date check alone already excludes.
 */
export interface LedgerTransfer {
  accepted_date: string | null;
  status: string;
  voided_at: string | null;
  cash: string;
  reported_cash: string | null;
  resolved_cash: string | null;
}

export type LedgerRowKey = 'accruedToday' | 'paidToday' | 'paidPast' | 'cashIn';

export interface LedgerRow {
  key: LedgerRowKey;
  /**
   * Always a non-negative magnitude. Whether a row reads as money IN or
   * money OUT — the minus sign, the tone — is a display decision for the
   * component that renders it, not for this function.
   */
  value: string;
}

export interface BuildLedgerInput {
  /** The business date this ledger explains — `YYYY-MM-DD`. */
  date: string;
  intakes: LedgerIntake[];
  payouts: LedgerPayout[];
  transfers: LedgerTransfer[];
}

/**
 * Explains, but does not compute, the point's cash figure. `PointCashPage`
 * shows `GET /point-cash/:pointId`'s `cash` as the total ALWAYS — never the
 * sum of the rows this function returns — so callers must not add these
 * rows up and print the result as the point's cash: a quiet discrepancy
 * between the two is worse than a visible one (Task 19 rule 1).
 *
 * A void is not a movement (§9.3): a voided intake, payout or transfer is
 * excluded from every bucket, the same rule `pages/day` already applies to
 * documents. `accruedToday` is informational only — berries received do not
 * move cash, only payouts do — and is not summed into anything.
 */
export function buildLedger(input: BuildLedgerInput): LedgerRow[] {
  const { date, intakes, payouts, transfers } = input;

  const accruedToday = sum(
    intakes.filter((i) => i.voided_at === null && i.business_date === date).map((i) => i.amount),
  );

  const livePayouts = payouts.filter((p) => p.voided_at === null);
  const paidToday = sum(livePayouts.filter((p) => p.business_date === date).map((p) => p.amount));
  const paidPast = sum(livePayouts.filter((p) => p.business_date !== date).map((p) => p.amount));

  // §7.9 (ред. 09.09.2026): an unresolved dispute credits the POINT's own
  // number, not what the base sent — `resolved_cash` overrides it only once
  // the owner has actually settled the dispute.
  const cashIn = sum(
    transfers
      .filter((t) => t.voided_at === null && t.accepted_date === date)
      .map((t) => t.resolved_cash ?? t.reported_cash ?? t.cash),
  );

  return [
    { key: 'accruedToday', value: accruedToday },
    { key: 'paidToday', value: paidToday },
    { key: 'paidPast', value: paidPast },
    { key: 'cashIn', value: cashIn },
  ];
}

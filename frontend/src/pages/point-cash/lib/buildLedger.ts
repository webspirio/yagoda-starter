import { sum } from '@/shared/lib/money';

/** One line of `GET /intakes` the ledger cares about. */
export interface LedgerIntake {
  business_date: string;
  amount: string;
  voided_at: string | null;
}

/**
 * One line of `GET /payouts` the ledger cares about. Every payout in scope
 * counts, voided or not — the cash left the drawer and comes back only when a
 * human returns it (§9.3), which the server's `returns` term books.
 */
export interface LedgerPayout {
  business_date: string;
  amount: string;
}

export type LedgerRowKey = 'accruedToday' | 'paidPast';

export interface LedgerRow {
  key: LedgerRowKey;
  /** A non-negative magnitude; the renderer decides the sign. */
  value: string;
  /** The page this row was summed from was capped, so it covers recent history only. */
  truncated: boolean;
}

export interface BuildLedgerInput {
  /** The business date this ledger explains — `YYYY-MM-DD`. */
  date: string;
  /**
   * The business date of the shift the total is made of — earlier than `date`
   * for a shift left open since an earlier day (#114). Its own payouts are in
   * the total, so they are not «past». Defaults to `date`.
   */
  shiftDate?: string;
  intakes: LedgerIntake[];
  payouts: LedgerPayout[];
  /** `total > data.length` on the fetched page (`PointCashPage` caps each read at 100). */
  intakesTruncated?: boolean;
  payoutsTruncated?: boolean;
}

/**
 * The two INFORMATIONAL rows — berries accrued today and payouts of earlier
 * days. Neither moves today's cash, so neither is ever part of the total; the
 * rows that do come from `GET /point-cash/:pointId`'s `breakdown` (#73).
 */
export function buildLedger({
  date,
  shiftDate = date,
  intakes,
  payouts,
  intakesTruncated = false,
  payoutsTruncated = false,
}: BuildLedgerInput): LedgerRow[] {
  const accruedToday = sum(
    intakes.filter((i) => i.voided_at === null && i.business_date === date).map((i) => i.amount),
  );
  const paidPast = sum(payouts.filter((p) => p.business_date < shiftDate).map((p) => p.amount));

  return [
    { key: 'accruedToday', value: accruedToday, truncated: intakesTruncated },
    { key: 'paidPast', value: paidPast, truncated: payoutsTruncated },
  ];
}

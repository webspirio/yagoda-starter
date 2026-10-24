import { sum } from '@/shared/lib/money';
import type { PointCashBreakdown } from '@/entities/point-cash';

/** One line of `GET /intakes` the ledger cares about. */
export interface LedgerIntake {
  business_date: string;
  amount: string;
  voided_at: string | null;
}

type LedgerRowKey = 'accruedToday';

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
   * for a shift left open since an earlier day (#114): its receipts are what
   * it accrued. Defaults to `date`.
   */
  shiftDate?: string;
  intakes: LedgerIntake[];
  /** `total > data.length` on the fetched page (`PointCashPage` caps the read at 100). */
  intakesTruncated?: boolean;
}

/**
 * The business date of the shift `breakdown`'s terms are made of — earlier
 * than `date` for a shift left open since an earlier day (#114), and `date`
 * itself while the breakdown has not arrived or has no shift.
 */
export function shiftDateOf(breakdown: PointCashBreakdown | undefined, date: string): string {
  return (breakdown?.kind === 'open' || breakdown?.kind === 'closed') && breakdown.anchor_date
    ? breakdown.anchor_date
    : date;
}

/**
 * The ONE informational row — berries accrued on the shift. It moves no cash,
 * so it is never part of the total; the rows that do come from
 * `GET /point-cash/:pointId`'s `breakdown` (#73).
 *
 * «Видано за минулі дні» used to sit beside it: every payout of every earlier
 * day the capped page reached — a season-long running total that read like a
 * figure of this day. Gone (audit 2026-10-24, C1): what the day paid down of
 * old balances is «Звірка каси»'s to say.
 */
export function buildLedger({
  date,
  shiftDate = date,
  intakes,
  intakesTruncated = false,
}: BuildLedgerInput): LedgerRow[] {
  const accruedToday = sum(
    intakes
      .filter(
        (i) => i.voided_at === null && i.business_date >= shiftDate && i.business_date <= date,
      )
      .map((i) => i.amount),
  );
  return [{ key: 'accruedToday', value: accruedToday, truncated: intakesTruncated }];
}

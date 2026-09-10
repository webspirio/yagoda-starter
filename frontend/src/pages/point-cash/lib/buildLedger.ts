import { sum } from '@/shared/lib/money';

/** One line of `GET /intakes` the ledger cares about. */
export interface LedgerIntake {
  business_date: string;
  amount: string;
  voided_at: string | null;
}

/**
 * One line of `GET /payouts` the ledger cares about.
 *
 * `voided_at` is read for exactly one thing — see `returnedToday`'s comment
 * below — and it is NOT what decides whether a payout counts toward
 * `paidToday`/`paidPast`. That asymmetry is the backend's, not a choice made
 * here: `point-cash.service.ts`'s `movementsSql` subtracts every payout in
 * scope with no `voided_at` filter at all, on purpose (§9.3 — "harmonising
 * them opens a theft path: a voided TRANSFER stops being added, a voided
 * PAYOUT stays subtracted, because that money physically left the drawer and
 * comes back only when a human returns it"). `return_settled_at` can only be
 * set once `voided_at` is (`CHK_payouts_return_requires_void` on the
 * backend), so every payout counted by `returnedToday` was already counted
 * in full by `paidToday`/`paidPast` too.
 */
export interface LedgerPayout {
  business_date: string;
  amount: string;
  voided_at: string | null;
  /** When the physically-returned cash from a voided payout was handed back. */
  return_settled_at: string | null;
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

export type LedgerRowKey = 'accruedToday' | 'paidToday' | 'paidPast' | 'returnedToday' | 'cashIn';

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
 * The browser's LOCAL calendar date of a timestamp, `YYYY-MM-DD` — the same
 * convention `todayIso()` uses for "today". This function has no access to
 * the server's `APP_TIMEZONE` (the backend casts `return_settled_at AT TIME
 * ZONE <app tz>` for exactly this reason, per `movementsSql`'s own comment),
 * so it assumes the reader is in the same zone as the business — the same
 * assumption every other raw timestamp already rendered on this screen makes
 * (`IncomingTransfers`'s `sent_at`). Wrong only in the same narrow window the
 * backend's own comment names: a settlement made just past local midnight,
 * read from a browser in a different zone than the business.
 */
function localDateOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Explains, but does not compute, the point's cash figure. `PointCashPage`
 * shows `GET /point-cash/:pointId`'s `cash` as the total ALWAYS — never the
 * sum of the rows this function returns — so callers must not add these rows
 * up and print the result as the point's cash: a quiet discrepancy between
 * the two is worse than a visible one (Task 19 rule 1).
 *
 * A void is not a movement for `intakes` and `transfers` (§9.3): a voided
 * intake or transfer contributes nothing to any bucket, mirroring the rule
 * `pages/day` already applies to documents. A voided PAYOUT is the deliberate
 * exception — see `LedgerPayout`'s own comment — and stays fully counted in
 * `paidToday`/`paidPast` until `returnedToday` adds its cash back on the day
 * it was physically handed back.
 *
 * `accruedToday` is informational only — berries received do not move cash,
 * only payouts do — and is not summed into anything; the caller is expected
 * to render it visibly apart from the four rows that actually move cash.
 */
export function buildLedger(input: BuildLedgerInput): LedgerRow[] {
  const { date, intakes, payouts, transfers } = input;

  const accruedToday = sum(
    intakes.filter((i) => i.voided_at === null && i.business_date === date).map((i) => i.amount),
  );

  // Every payout in scope counts, voided or not — see `LedgerPayout`'s
  // comment for why filtering `voided_at` here would be wrong.
  const paidToday = sum(payouts.filter((p) => p.business_date === date).map((p) => p.amount));
  const paidPast = sum(payouts.filter((p) => p.business_date !== date).map((p) => p.amount));

  // The third term of `movementsSql`: cash physically handed back after a
  // void, booked on the day it was RETURNED, not the day the original payout
  // was made — "a payout paid on Tuesday and returned on Friday is Friday's
  // cash" (`point-cash.service.ts`).
  const returnedToday = sum(
    payouts
      .filter((p) => p.return_settled_at !== null && localDateOf(p.return_settled_at) === date)
      .map((p) => p.amount),
  );

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
    { key: 'returnedToday', value: returnedToday },
    { key: 'cashIn', value: cashIn },
  ];
}

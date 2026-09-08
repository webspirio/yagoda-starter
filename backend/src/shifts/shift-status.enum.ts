/**
 * Mirrors the `shift_status` Postgres type exactly.
 *
 * `AwaitingExplanation` IS UNREACHABLE IN THIS SLICE and that is not an
 * oversight. It exists solely to express a cash discrepancy; a discrepancy is
 * `counted − expected`, and `expected` comes from a five-table formula over
 * `transfers`, `payouts`, `crate_issuances`, `crate_returns` and `intakes`.
 * Three of those five do not exist. It stays here and in the database type so
 * the `cash_counts` slice needs no migration — see spec §2.1 and §9.
 */
export enum ShiftStatus {
  Open = 'open',
  AwaitingExplanation = 'awaiting_explanation',
  Closed = 'closed',
}

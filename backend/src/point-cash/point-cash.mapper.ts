import { TransferStatus } from '../transfers/transfer-status.enum';

/** The raw projection — every numeric already `::text`. */
export interface PointCashRow {
  collection_point_id: string;
  name: string;
  target_cash: string | null;
  cash: string;
  shortfall: string | null;
  unexplained_difference: string;
  crate_deposits: string;
  crate_deposit_units: number;
  latest_transfer_status: TransferStatus | null;
  latest_transfer_sent_at: Date | null;
}

/**
 * One line of the cash screen — §7.10's table, minus the «ящиків» column,
 * which has no source tables until the crates slice.
 *
 * `shortfall` IS `null`, NEVER `0.00`, FOR A POINT WITH NO TARGET, and the
 * point still appears. §7.10 says a point without a target «в таблицю не
 * потрапляє узагалі», but that was written about the DEBT table, where a
 * missing target leaves nothing to subtract from. This is the CASH screen: the
 * point's cash is a fact whether or not anyone set a target, and only the
 * shortfall is unknowable. `0.00` would falsely assert the network owes that
 * point nothing — the same argument by which §6.9 requires «—» rather than a
 * zero for crates. Hiding the row would blind the owner to real money. The
 * debt rule survives where it belongs: no zero in the shortfall column.
 * Amended into §7.10 on 09.09.2026; spec §6.6.
 */
export interface PointCashRowResponse {
  collection_point_id: string;
  name: string;
  target_cash: string | null;
  cash: string;
  shortfall: string | null;
  /**
   * `Σ (counted − expected)` over every count at this point — how far the
   * drawer has drifted from what the documents say, since the first count.
   *
   * IT IS NOT A SECOND STORED LINE, and it never needed to be: the count chain
   * and the document line can differ by the recorded discrepancies and by
   * nothing else, so this sum IS the divergence (spec §3.1).
   *
   * EXPLAINED INCIDENTS ARE STILL IN IT. An explanation changes what is open,
   * never what is true — §7.7's «розбіжність у документі лишається».
   *
   * EXCLUDES `midday`, and this comment said the OPPOSITE until 10.09.2026 —
   * «includes every kind, `midday` too», arguing that a discrepancy a midday
   * count recorded is still a discrepancy that happened. It reads well and it
   * is wrong, because a demoted count is not an additional event: §6.3 turns a
   * shift's `closing` count into a `midday` one on reopen, and the re-close
   * writes a second. Summing both reports a −90 shortage as −180. b5952bb put
   * `AND c.kind <> 'midday'` in the SQL; `CashCountsService.list` and
   * `is_open` in `cash-count.mapper.ts` carry the same filter for the same
   * reason. All four have to move together or the owner's screens disagree.
   *
   * BOUNDED BY `as_of`, like `cash` beside it. It was not until 10.09.2026,
   * and a historical read therefore reported drift that had not happened yet
   * on the date being read — a September-1 drawer next to every discrepancy
   * ever recorded. Every column of this row is as of the same date, or the row
   * describes no moment at all.
   */
  unexplained_difference: string;
  /**
   * §7.6: «фізично шухляда одна, книг дві». `Σ deposit_taken − Σ deposit_refund`
   * over the point's WHOLE LIFETIME (spec §4.3) — NEVER folded into `cash`,
   * and NEVER bounded by `as_of` the way every other column on this row is:
   * §7.5 gives it no lower bound («від першої видачі») and there is no
   * physical count to anchor it on, because this book is never counted. A
   * sum across the two books would need no `GROUP BY book` to write by
   * accident — `cash-book.enum.ts` exists precisely so that mistake cannot
   * happen silently.
   */
  crate_deposits: string;
  /**
   * §7.5's card again, in units rather than money — «завдатків за N ящиків».
   * `Σ units` of every live deposit-mode issuance minus `Σ units` returned
   * against one of them, POINT-LIFETIME, same exemptions as `crate_deposits`
   * right above: never folded into it, never bounded by `as_of`. An INTEGER,
   * never a decimal STRING — it is a row count, not money, so it carries no
   * scale-2 rounding and crosses the driver boundary as a JS `number` (the
   * SQL behind it casts `::int`, see `crateUnitsSql`).
   */
  crate_deposit_units: number;
  /**
   * The point's most recent trip AS OF `as_of`, or `null` when there had been
   * none — and `status` is the status the transfer HELD on that date, not the
   * one it holds now.
   *
   * THE WHOLE COLUMN IS RECONSTRUCTED RATHER THAN READ, for the same reason
   * `unexplained_difference` is bounded: a row pairing a past cash figure with
   * today's newest transfer mixes two points in time and reads as fact. The
   * reconstruction is exact and needs no history table, because the three
   * dates a transfer can move on are all stored on it: `sent_at` (it had not
   * left the base before it), `accepted_date` (still `sent` before it,
   * whatever the stored status says) and `voided_at` (no document at all after
   * it). A resolution is deliberately NOT one of them — resolving leaves the
   * status `disputed`, so it changes nothing this column shows.
   */
  latest_transfer: { status: TransferStatus; sent_at: Date } | null;
}

/** Field by field, not `...row`: a raw projection must not reach the client
 *  with whatever a later `SELECT` happens to add. */
export function toPointCashRowResponse(row: PointCashRow): PointCashRowResponse {
  return {
    collection_point_id: row.collection_point_id,
    name: row.name,
    target_cash: row.target_cash,
    cash: row.cash,
    shortfall: row.shortfall,
    unexplained_difference: row.unexplained_difference,
    crate_deposits: row.crate_deposits,
    crate_deposit_units: row.crate_deposit_units,
    latest_transfer:
      row.latest_transfer_status && row.latest_transfer_sent_at
        ? { status: row.latest_transfer_status, sent_at: row.latest_transfer_sent_at }
        : null,
  };
}

import { TransferStatus } from '../transfers/transfer-status.enum';

/** The raw projection — every numeric already `::text`. */
export interface PointCashRow {
  collection_point_id: string;
  name: string;
  target_cash: string | null;
  cash: string;
  shortfall: string | null;
  unexplained_difference: string;
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
   * INCLUDES EVERY KIND, `midday` too: a midday count never ANCHORS the cash
   * figure (§8), but a discrepancy it recorded is still a discrepancy that
   * happened.
   */
  unexplained_difference: string;
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
    latest_transfer:
      row.latest_transfer_status && row.latest_transfer_sent_at
        ? { status: row.latest_transfer_status, sent_at: row.latest_transfer_sent_at }
        : null,
  };
}

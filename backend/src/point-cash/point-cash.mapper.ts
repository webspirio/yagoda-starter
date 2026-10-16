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
  crate_cash: string | null;
  crate_unexplained_difference: string;
  crate_deposit_units: number;
  latest_transfer_status: TransferStatus | null;
  latest_transfer_sent_at: Date | null;
}

/**
 * One line of the cash screen — §7.10's table. The «ящиків» column is the
 * `crate_*` fields: the deposits book (`crate_cash`, its drift) and the
 * issued-not-returned units, all read from the crates tables and `cash_counts`.
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
   * §7.6: «фізично шухляда одна, книг дві». The supplier LIABILITY:
   * `Σ deposit_taken − Σ deposit_refund` over the point's WHOLE LIFETIME
   * (spec §4.3) — NEVER folded into `cash`, and NEVER bounded by `as_of` the
   * way every other column on this row is (§7.5 gives it no lower bound,
   * «від першої видачі»). It is no longer «never counted» (#178): the COUNTED
   * drawer is `crate_cash` beside it. A sum across the books would need no
   * `GROUP BY book` to write by accident — `cash-book.enum.ts` exists
   * precisely so that mistake cannot happen silently.
   */
  crate_deposits: string;
  /**
   * The crates DRAWER as counted (#178): anchored on the point's own `crates`
   * count the way `cash` is on the berry one, bounded by `as_of`. `null` =
   * the drawer was never counted (or not yet, as of that date) — not zero.
   */
  crate_cash: string | null;
  /**
   * `Σ (counted − expected)` over the point's non-midday `crates` counts up to
   * `as_of` — mirrors `unexplained_difference`, over the crates book. `0.00`
   * when there are none.
   */
  crate_unexplained_difference: string;
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
    crate_cash: row.crate_cash,
    crate_unexplained_difference: row.crate_unexplained_difference,
    crate_deposit_units: row.crate_deposit_units,
    latest_transfer:
      row.latest_transfer_status && row.latest_transfer_sent_at
        ? { status: row.latest_transfer_status, sent_at: row.latest_transfer_sent_at }
        : null,
  };
}

/** `breakdownFor`'s one row — every figure already computed in SQL. */
export interface PointCashBreakdownRow {
  cash: string;
  anchor_kind: 'opening' | 'closing' | null;
  anchor_date: string | null;
  same_day: boolean | null;
  opening: string | null;
  transfers_in: string | null;
  payouts: string | null;
  returns: string | null;
  counted: string | null;
  expected: string | null;
  difference: string | null;
  late_change: string | null;
}

/** What `GET /point-cash/:pointId` says `cash` is made of (#73, spec 2026-10-13). */
export interface PointCashBreakdown {
  kind: 'open' | 'closed' | 'carried' | 'none';
  anchor_date: string | null;
  opening: string | null;
  transfers_in: string | null;
  payouts: string | null;
  returns: string | null;
  closing: {
    counted: string;
    expected: string | null;
    difference: string | null;
    late_change: string | null;
  } | null;
}

/**
 * THE KIND IS DECIDED HERE, THE NUMBERS ARE NOT. Every figure comes from
 * `breakdownFor`'s one statement; this only nulls out what a kind must not
 * show — a carried day's terms belong to another day.
 */
export function toPointCashBreakdown(row: PointCashBreakdownRow): PointCashBreakdown {
  const blank = {
    anchor_date: null,
    opening: null,
    transfers_in: null,
    payouts: null,
    returns: null,
  };
  if (row.anchor_kind === null) return { kind: 'none', ...blank, closing: null };

  const terms = {
    anchor_date: row.anchor_date,
    opening: row.opening,
    transfers_in: row.transfers_in,
    payouts: row.payouts,
    returns: row.returns,
  };
  if (row.anchor_kind === 'opening') return { kind: 'open', ...terms, closing: null };

  // A closing anchor IS a count, and `counted_amount` is NOT NULL.
  const counted = row.counted ?? '0.00';
  if (!row.same_day) {
    return {
      kind: 'carried',
      ...blank,
      anchor_date: row.anchor_date,
      closing: { counted, expected: null, difference: null, late_change: null },
    };
  }
  return {
    kind: 'closed',
    ...terms,
    closing: {
      counted,
      expected: row.expected,
      difference: row.difference,
      late_change: row.late_change,
    },
  };
}

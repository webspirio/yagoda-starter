/** One of the card's three history reads, cut at `limit: 100` or not. */
interface HistoryList {
  rows: readonly { created_at: string }[];
  truncated: boolean;
}

/**
 * Where the supplier card's merged history stops being complete (audit D3).
 *
 * Receipts, payouts and top-ups are three reads, each capped at 100 newest.
 * A list that was cut is complete only back to its oldest loaded row; merged
 * as they are, a payout older than that would sit in a history that has
 * silently lost the receipts around it. So the merged history is cut at the
 * NEWEST of those «oldest loaded» instants: everything from there on is
 * complete in all three lists. `null` when nothing was cut. `created_at` is
 * the server's ISO instant, the same key the timeline already sorts on.
 */
export function historyHorizon(lists: readonly HistoryList[]): string | null {
  let horizon: string | null = null;
  for (const { rows, truncated } of lists) {
    if (!truncated || rows.length === 0) continue;
    const oldest = rows.reduce(
      (min, r) => (r.created_at < min ? r.created_at : min),
      rows[0].created_at,
    );
    if (horizon === null || oldest > horizon) horizon = oldest;
  }
  return horizon;
}

/** The rows at or after `horizon` — all of them when there is none. */
export function sinceHorizon<T extends { created_at: string }>(
  rows: T[],
  horizon: string | null,
): T[] {
  return horizon === null ? rows : rows.filter((r) => r.created_at >= horizon);
}

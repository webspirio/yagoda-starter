/**
 * WHEN a count was taken. `opening` and `closing` are mandatory and written
 * inside the shift verbs (§6.1); `midday` is deliberately OUTSIDE the partial
 * unique index so a recount may happen any number of times (§7.6).
 *
 * `midday` HAS NO ENDPOINT in this slice. It is reachable only as a by-product
 * of reopening a shift, which demotes that shift's `closing` count to `midday`
 * so a second close has a free slot and the evidence survives (§6.3).
 *
 * A `midday` COUNT NEVER ANCHORS THE CASH FIGURE. It sits in the middle of a
 * shift, and isolating "the movements after it" would need a timestamp bound
 * that shift-bounded accounting does not have — so every anchor query filters
 * `kind <> 'midday'` (§8). This is load-bearing, not tidiness.
 */
export enum CashCountKind {
  Opening = 'opening',
  Midday = 'midday',
  Closing = 'closing',
}

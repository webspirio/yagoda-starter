/**
 * TWO BOOKS, ONE PHYSICAL DRAWER. §7.6: «фізично шухляда одна, книг дві», and
 * `book` on every row is what makes that visible in each query — a sum without
 * `GROUP BY book` cannot be written by accident.
 *
 * ONLY `berry` IS WRITTEN TODAY, from a constant, never from user input.
 * `crate_issuances` and `crate_returns` do not exist, so no deposit has ever
 * been taken and the whole drawer IS the berry book. Ticket #20 says the same:
 * «це стосується лише каси за ягоди».
 *
 * THE PROBLEM THIS DEFERS, named so the crates slice does not discover it late
 * (spec §7): one physical count has to become two book figures, and neither
 * available answer works. Asking the operator to split it asks them to
 * distinguish identical banknotes; deriving berry as
 * `counted total − expected crate deposits` makes the crates book
 * unfalsifiable, because it could then never disagree with itself.
 */
export enum CashBook {
  Berry = 'berry',
  Crates = 'crates',
}

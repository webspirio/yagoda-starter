/**
 * TWO BOOKS, ONE PHYSICAL DRAWER. §7.6: «фізично шухляда одна, книг дві», and
 * `book` on every row is what makes that visible in each query — a sum without
 * `GROUP BY book` cannot be written by accident.
 *
 * `crates` IS NOW A REAL BOOK, but it is DERIVED, not counted: `point-cash`
 * reports `Σ deposit_taken − Σ deposit_refund` and no `cash_counts` row is
 * ever written with `book = 'crates'`. The problem named below is therefore
 * DEFERRED, not solved — and it stays deferred deliberately (spec §4.3):
 * правка 10 keeps crate money «тільки в межах точки», so it reconciles against
 * nothing and needs no counted figure to be useful. The day it gets counted,
 * the void semantics of spec §7 come back for review in the same slice.
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

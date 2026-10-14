/**
 * TWO BOOKS, ONE PHYSICAL DRAWER. §7.6: «фізично шухляда одна, книг дві», and
 * `book` on every row is what makes that visible in each query — a sum without
 * `GROUP BY book` cannot be written by accident.
 *
 * `crates` IS COUNTED since #178 (spec `2026-10-14-yagoda-crates-cash-count-design.md`):
 * shift open and close each write a `berry` AND a `crates` row. The split
 * problem this header used to defer — one physical count becoming two book
 * figures — never arises: the client's answer is that deposits lie apart from
 * the berry money, so the operator enters two sums and nothing is derived from
 * the other. The crates expectation is anchored on the previous non-midday
 * crates count plus that shift's deposit movements (D1); the midday recount
 * stays berry-only (D6).
 */
export enum CashBook {
  Berry = 'berry',
  Crates = 'crates',
}

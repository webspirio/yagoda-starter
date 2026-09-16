/**
 * §6.2 — «до 50 завдаток, від 51 розписка». THE THRESHOLD IS NOT HERE AND NEVER
 * WILL BE: ticket #60 is explicit that it does not restrict the choice («ми не
 * обмежуємо вибір»), so the number is a default the client pre-selects and the
 * server records whatever it is told. A server-side threshold would be the
 * blocking validation the client refused.
 *
 * `receipt` means a paper розписка was written by hand and carries this
 * document's `code`; `deposit` means money changed hands instead. Both put
 * crates on the supplier's balance identically — §6.4: «різниця лише в грошах».
 */
export enum CrateIssuanceMode {
  Deposit = 'deposit',
  Receipt = 'receipt',
}

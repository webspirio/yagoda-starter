/**
 * THREE VALUES, AND A FOURTH MUST NEVER BE ADDED. `void` was removed on
 * 03.09.2026 because §9.3 requires a MANDATORY REASON for a void, which a
 * status cannot carry — voiding is the `void_*` trio instead.
 *
 * The consequence is the trap of this whole slice: a voided transfer keeps
 * `status = 'accepted'`, so every query about cash must filter
 * `voided_at IS NULL` for itself.
 *
 * `disputed` is TERMINAL. The owner closing a dispute fills `resolved_*` and
 * leaves the status alone — §7.7's «розбіжність у документі лишається, її не
 * підганяють». A settled dispute is still a dispute that happened.
 */
export enum TransferStatus {
  Sent = 'sent',
  Accepted = 'accepted',
  Disputed = 'disputed',
}

/**
 * Mirrors the `shift_status` Postgres type exactly.
 *
 * `AwaitingExplanation` IS UNREACHABLE BY DECISION, NOT BY ABSENCE. It exists
 * to express a cash discrepancy, and `cash_counts` now ships: every shift open
 * and close records one, and `PointCashService` computes the expectation the
 * discrepancy is measured against. The status is unreachable because the
 * client RULED on 09.09.2026 that a discrepancy never blocks a close —
 * «якщо каса не сходиться, це не блокує процес» — which overruled §7.7's gate
 * (cash counts spec §6.4 and §11.1). `ShiftsService.close` therefore has no
 * branch comparing counted against expected, and the owner's follow-up is
 * `PATCH /shifts/:id/explanation`, not a state.
 *
 * DO NOT IMPLEMENT IT AS A GAP. Making a discrepancy move a shift into this
 * status would reinstate the exact blocking the client removed. The value
 * stays in the enum and in the database type because `28-db-schema.dbml` is
 * the schema of record and because reversing the ruling must not cost a
 * migration.
 */
export enum ShiftStatus {
  Open = 'open',
  AwaitingExplanation = 'awaiting_explanation',
  Closed = 'closed',
}

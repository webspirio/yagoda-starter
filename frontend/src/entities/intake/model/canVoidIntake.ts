/**
 * §9.4: only while its shift is open (2026-09-30: the owner too — they reopen
 * the shift first); the owner any receipt, an operator only one they received
 * themselves. The receipt dialog
 * and every table's row action ask this one question. `viewer` is structural
 * (the `useMeQuery` user fits) so this slice never imports `entities/user`.
 */
export function canVoidIntake(
  viewer: { id: string; role: 'network_owner' | 'point_operator' },
  intake: { voided_at: string | null; received_by_user_id: string; shift_closed: boolean },
): boolean {
  if (intake.voided_at !== null || intake.shift_closed) return false;
  return viewer.role === 'network_owner' || viewer.id === intake.received_by_user_id;
}

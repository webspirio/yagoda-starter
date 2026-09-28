/**
 * §9.4: the owner may void any live receipt; an operator only one they
 * received themselves, and only while its shift is open. The receipt dialog
 * and every table's row action ask this one question. `viewer` is structural
 * (the `useMeQuery` user fits) so this slice never imports `entities/user`.
 */
export function canVoidIntake(
  viewer: { id: string; role: string },
  intake: { voided_at: string | null; received_by_user_id: string; shift_closed: boolean },
): boolean {
  if (intake.voided_at !== null) return false;
  return (
    viewer.role === 'network_owner' ||
    (viewer.id === intake.received_by_user_id && !intake.shift_closed)
  );
}

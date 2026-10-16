/**
 * §9.4: the owner may void any payout that is not already voided; an operator
 * only one they paid out themselves, and only while its shift is open. The
 * receipt dialog asks this one question. `viewer` is structural (the
 * `useMeQuery` user fits) so this slice never imports `entities/user`.
 */
export function canVoidPayout(
  viewer: { id: string; role: 'network_owner' | 'point_operator' },
  payout: { voided_at: string | null; paid_by_user_id: string; shift_closed: boolean },
): boolean {
  return (
    payout.voided_at === null &&
    (viewer.role === 'network_owner' ||
      (viewer.id === payout.paid_by_user_id && !payout.shift_closed))
  );
}

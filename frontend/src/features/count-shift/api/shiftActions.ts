import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import type { Shift } from '@/entities/shift';

/**
 * Opening and closing both change what «today» means for the documents of
 * that point, so both invalidate shifts AND both journals. Shared by
 * `pages/day` and `pages/reception` — both let an operator open a shift, and
 * their invalidation sets were byte-for-byte identical before this promotion.
 * `useReopenShiftMutation` keeps its own copy in `pages/day/api/shiftActions.ts`:
 * reopening is owner-only, takes a reason rather than a count, and has one
 * consumer, so promoting it here would not remove any duplication.
 *
 * Closing a shift also moves the point's cash figure — the drawer count taken
 * at close becomes the point's cash — so `cashCounts` and `pointCash` are
 * invalidated alongside shifts/intakes/payouts, or «Каса точки» would show a
 * stale number right after close.
 */
function useInvalidateDay() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: queryKeys.shifts }),
      qc.invalidateQueries({ queryKey: queryKeys.intakes }),
      qc.invalidateQueries({ queryKey: queryKeys.payouts }),
      qc.invalidateQueries({ queryKey: queryKeys.cashCounts }),
      qc.invalidateQueries({ queryKey: queryKeys.pointCash }),
    ]);
}

/**
 * Оператор, і лише він (§10.3). Точка береться з токена — тіло несе САМЕ
 * підрахунок шухляди, і він обов'язковий: перший підрахунок точки ЦЕ і є її
 * початковий залишок (§7.3), тому «пропустити цього разу» немає чого.
 */
export function useOpenShiftMutation() {
  const invalidate = useInvalidateDay();
  return useMutation({
    mutationFn: async ({ counted_amount }: { counted_amount: string }): Promise<Shift> =>
      (await httpClient.post<Shift>('/shifts', { counted_amount })).data,
    onSuccess: invalidate,
  });
}

/** Оператор, і лише він — закриття це підпис того, хто тримав гроші (§10.3). */
export function useCloseShiftMutation() {
  const invalidate = useInvalidateDay();
  return useMutation({
    mutationFn: async ({
      id,
      counted_amount,
    }: {
      id: string;
      counted_amount: string;
    }): Promise<Shift> =>
      (await httpClient.post<Shift>(`/shifts/${id}/close`, { counted_amount })).data,
    onSuccess: invalidate,
  });
}

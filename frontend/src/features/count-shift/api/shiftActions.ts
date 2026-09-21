import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import type { Shift } from '@/entities/shift';

/**
 * Opening, closing and reopening a shift all change what «today» means for
 * the documents of that point, so all three invalidate shifts AND both
 * journals. Exported for `pages/day/api/shiftActions.ts`'s
 * `useReopenShiftMutation`, which used to carry a byte-for-byte copy of this
 * function — reopening is owner-only and takes a reason rather than a count,
 * but its invalidation set is identical to open/close's, so there was
 * nothing left to keep separate.
 *
 * Closing a shift moves the point's cash figure — the drawer count taken at
 * close becomes the point's cash — and reopening moves it right back (it
 * demotes that shift's `closing` cash count to `midday`, `shifts.service.ts`,
 * and the point-cash SQL anchors on counts where `kind <> 'midday'`), so
 * `cashCounts` and `pointCash` are invalidated alongside shifts/intakes/payouts,
 * or «Каса точки» would show a stale number right after any of the three.
 */
export function useInvalidateDay() {
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

/**
 * Оператор, і лише він — закриття це підпис того, хто тримав гроші (§10.3).
 *
 * `broken_crates` ОБОВ'ЯЗКОВЕ, як і на боці сервера (`CloseShiftDto` не має
 * `@IsOptional()`): §6.8 «бій вписує приймальник». `0` — нормальне значення і
 * їде як `0`; воно НЕ може бути відкинуте як хибне, інакше єдиний день, коли
 * нічого не побилось, повертає 400.
 */
export function useCloseShiftMutation() {
  const invalidate = useInvalidateDay();
  return useMutation({
    mutationFn: async ({
      id,
      counted_amount,
      broken_crates,
    }: {
      id: string;
      counted_amount: string;
      broken_crates: number;
    }): Promise<Shift> =>
      (await httpClient.post<Shift>(`/shifts/${id}/close`, { counted_amount, broken_crates })).data,
    onSuccess: invalidate,
  });
}

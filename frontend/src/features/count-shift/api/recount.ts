import { useMutation } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import type { CashCount } from '@/entities/cash-count';
import { useInvalidateDay } from './shiftActions';

/**
 * Мідей перерахунок (`kind: 'midday'`) — §7.6 дозволяє рахувати шухляду
 * скільки завгодно разів, доки зміна відкрита. Книга завжди `'berry'`: книгу
 * ящиків не рахують (crates spec §4.3), бекендовий DTO приймає лише `'berry'`.
 * Точка й зміна беруться з токена на сервері — тіло несе лише підрахунок.
 *
 * Reuses `useInvalidateDay` rather than a narrower pair: it already covers
 * `cashCounts` (the count that just landed) and `pointCash` (the drawer
 * figure the panel reads back right after), and this action changes nothing
 * else the other three keys guard.
 */
export function useRecountMutation() {
  const invalidate = useInvalidateDay();
  return useMutation({
    mutationFn: async ({ counted_amount }: { counted_amount: string }): Promise<CashCount> =>
      (await httpClient.post<CashCount>('/cash-counts', { book: 'berry', counted_amount })).data,
    onSuccess: invalidate,
  });
}

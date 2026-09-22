import { queryOptions, useQuery } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { STALE } from '@/shared/api/queryClient';
import type { Reweigh } from '../model/reweigh';

/**
 * §8.2's звірка for ONE shift — the point's kilograms next to the base's.
 *
 * Built with `queryOptions()` because the day table fans this exact read out
 * over every point with `useQueries`; a hook alone could not be reused there
 * without duplicating the key and the fetcher.
 *
 * `includeVoided` is part of the KEY, not just the request: the two variants
 * answer different questions («what counts» vs «what happened»), and letting
 * one serve the other from cache would make a voided line flicker in and out
 * of a table depending on which screen asked first.
 */
export function reweighQueryOptions(
  shiftId: string | undefined,
  { includeVoided = false }: { includeVoided?: boolean } = {},
) {
  return queryOptions({
    queryKey: [...queryKeys.reweighs, shiftId, { includeVoided }] as const,
    enabled: shiftId !== undefined,
    queryFn: async (): Promise<Reweigh> => {
      const { data } = await httpClient.get<Reweigh>(`/shifts/${shiftId}/reweigh`, {
        params: includeVoided ? { include_voided: true } : {},
      });
      return data;
    },
    staleTime: STALE.list,
  });
}

export function useReweighQuery(
  shiftId: string | undefined,
  opts: { includeVoided?: boolean } = {},
) {
  return useQuery(reweighQueryOptions(shiftId, opts));
}

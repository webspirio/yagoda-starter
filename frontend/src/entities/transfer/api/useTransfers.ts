import { queryOptions, useQuery } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { STALE } from '@/shared/api/queryClient';
import type { TransferFilter, Transfer, Paginated } from '../model/transfer';

/**
 * Duplicated from `entities/payout/api/usePayouts.ts` rather than imported —
 * FSD forbids a same-layer cross-import (`entities/transfer` -> `entities/payout`).
 * A three-line duplicate is the recorded FSD-correct price; keep it in sync
 * by hand if the param mapping ever changes.
 *
 * `include_voided` за замовчуванням FALSE, і це протилежно до документів
 * (`usePayouts` шле true). Причина в §9.3: сторнований ПЕРЕКАЗ перестає
 * додаватися до каси, тоді як сторнована ВИПЛАТА лишається віднятою. Список,
 * який за замовчуванням показував би сторновані перекази, читався б як гроші,
 * що є на точці, — а їх там немає.
 */
export function transferParams(f: TransferFilter) {
  return {
    ...(f.pointId ? { collection_point_id: f.pointId } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.from ? { from: f.from } : {}),
    ...(f.to ? { to: f.to } : {}),
    ...(f.page ? { page: f.page } : {}),
    include_voided: f.includeVoided ?? false,
    limit: f.limit ?? 100,
  };
}

/**
 * Transfer headers for a point, a status, or a `from`/`to` date range — the
 * owner can also read the whole network unfiltered, so there is no
 * `enabled`-gate here (unlike `payoutsQueryOptions`).
 */
export function transfersQueryOptions(filter: TransferFilter) {
  return queryOptions({
    queryKey: [...queryKeys.transfers, filter] as const,
    queryFn: async (): Promise<Paginated<Transfer>> => {
      const { data } = await httpClient.get<Paginated<Transfer>>('/transfers', {
        params: transferParams(filter),
      });
      return data;
    },
    staleTime: STALE.list,
  });
}

/** Transfers for a point, a status, or a date range — the owner may also ask for the whole network. */
export function useTransfersQuery(filter: TransferFilter) {
  return useQuery(transfersQueryOptions(filter));
}

/** One transfer by id — used by the accept/dispute/resolve/void dialogs. */
export function useTransferQuery(id: string | null) {
  return useQuery({
    queryKey: [...queryKeys.transfers, 'one', id] as const,
    enabled: id !== null,
    queryFn: async (): Promise<Transfer> => {
      const { data } = await httpClient.get<Transfer>(`/transfers/${id}`);
      return data;
    },
    staleTime: STALE.detail,
  });
}

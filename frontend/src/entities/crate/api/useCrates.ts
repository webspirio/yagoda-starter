import { useQuery } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import type { Paginated } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { STALE } from '@/shared/api/queryClient';
import type {
  CrateBalance,
  CrateBalanceRow,
  CrateDocumentFilter,
  CrateIssuance,
  CrateReturn,
} from '../model/crate';

function documentParams(f: CrateDocumentFilter) {
  return {
    ...(f.pointId ? { collection_point_id: f.pointId } : {}),
    ...(f.supplierId ? { supplier_id: f.supplierId } : {}),
    ...(f.mode ? { mode: f.mode } : {}),
    ...(f.page ? { page: f.page } : {}),
    ...(f.includeVoided === undefined ? {} : { include_voided: f.includeVoided }),
    limit: f.limit ?? 100,
  };
}

/**
 * «У людей» — every supplier still holding crates at a point, in ONE read.
 *
 * `enabled` on the point for an OWNER only: an operator has no point to pass
 * (the server pins them from their token), so gating on `pointId` would mean
 * their screen never fired at all. `isOwner` is what distinguishes «no point
 * chosen yet» from «no point to choose».
 */
export function useCrateBalancesQuery({
  pointId,
  isOwner,
  includeZero,
}: {
  pointId: string | null;
  isOwner: boolean;
  includeZero?: boolean;
}) {
  return useQuery({
    queryKey: [...queryKeys.crateBalances, { pointId, includeZero }] as const,
    enabled: !isOwner || pointId !== null,
    queryFn: async (): Promise<Paginated<CrateBalanceRow>> => {
      const { data } = await httpClient.get<Paginated<CrateBalanceRow>>('/crate-balances', {
        params: {
          ...(pointId ? { collection_point_id: pointId } : {}),
          ...(includeZero ? { include_zero: true } : {}),
          limit: 100,
        },
      });
      return data;
    },
    staleTime: STALE.list,
  });
}

/** One person's open tranches — oldest first, each at the price it was taken
 *  at (§6.5). This is what a return refunds from, in this order. */
export function useCrateBalanceQuery(supplierId: string | null) {
  return useQuery({
    queryKey: [...queryKeys.crateBalances, 'supplier', supplierId] as const,
    enabled: supplierId !== null,
    queryFn: async (): Promise<CrateBalance> => {
      const { data } = await httpClient.get<CrateBalance>(
        `/suppliers/${supplierId}/crate-balance`,
      );
      return data;
    },
    staleTime: STALE.list,
  });
}

/** The issuance journal — never bare; scoped by point or supplier. */
export function useCrateIssuancesQuery(filter: CrateDocumentFilter) {
  return useQuery({
    queryKey: [...queryKeys.crates, 'issuances', filter] as const,
    enabled: Boolean(filter.pointId || filter.supplierId),
    queryFn: async (): Promise<Paginated<CrateIssuance>> => {
      const { data } = await httpClient.get<Paginated<CrateIssuance>>('/crate-issuances', {
        params: documentParams(filter),
      });
      return data;
    },
    staleTime: STALE.list,
  });
}

/** The returns journal — same scoping rule as the issuances above. */
export function useCrateReturnsQuery(filter: CrateDocumentFilter) {
  return useQuery({
    queryKey: [...queryKeys.crates, 'returns', filter] as const,
    enabled: Boolean(filter.pointId || filter.supplierId),
    queryFn: async (): Promise<Paginated<CrateReturn>> => {
      const { data } = await httpClient.get<Paginated<CrateReturn>>('/crate-returns', {
        params: documentParams(filter),
      });
      return data;
    },
    staleTime: STALE.list,
  });
}

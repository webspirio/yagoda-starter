import { useCallback } from 'react';
import { useUrlParam, keepUuids } from '@/shared/lib/url-state';
import { useMeQuery } from '../api/useMeQuery';

/**
 * Which point a money screen (shift, receipts, balances) works on. An operator
 * is pinned to their own point by the token — the server derives it and
 * ignores anything else. An owner has no point and PICKS one; the pick lives
 * in `?point=` so a reload or a shared link lands on the same point, and
 * nothing is written for an owner who has not picked.
 */
export function usePointScope() {
  const { data: me, isPending } = useMeQuery();
  const [param, setParam] = useUrlParam('point');
  const setPointId = useCallback((id: string | null) => setParam(id), [setParam]);
  // `collection_point_id` is `@IsUUID()` server-side; a hand-edited or stale
  // `?point=` must not reach the API as-is — shape it away here rather than
  // 400 every read it scopes.
  const pointId = keepUuids(param ? [param] : null)?.[0] ?? null;

  if (me?.role === 'point_operator') {
    return { pointId: me.collection_point_id, canPick: false, setPointId, isLoading: false };
  }
  return {
    pointId,
    canPick: me?.role === 'network_owner',
    setPointId,
    isLoading: isPending,
  };
}

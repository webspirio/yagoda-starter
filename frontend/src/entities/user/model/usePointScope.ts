import { useCallback } from 'react';
import { useUrlParam, keepUuids } from '@/shared/lib/url-state';
import { getStoredPoint, storePoint } from '@/shared/lib/point-preference';
import { useMeQuery } from '../api/useMeQuery';

/**
 * Which point a money screen (shift, receipts, balances) works on. An operator
 * is pinned to their own point by the token — the server derives it and
 * ignores anything else. An owner has no point and PICKS one.
 *
 * THE PICK IS REMEMBERED, and the URL still wins. `?point=` is what survives
 * being pasted to someone else, so a link always decides; the remembered value
 * only answers when the URL carries nothing. Before this, every screen had its
 * own URL and therefore its own empty `?point=`, so walking from «Каса за
 * день» to «Прийомка» dropped the choice and the owner picked the same point
 * again on every screen.
 *
 * WHAT THIS HOOK STILL DOES NOT KNOW is which point to show when nothing is
 * remembered either — that needs the point LIST, which lives in another entity
 * slice. `features/point-scope`'s `useWorkingPoint` composes the two a layer
 * up; see its header for why it cannot happen here.
 *
 * NOTHING IS WRITTEN FOR AN OPERATOR. A remembered id from a shared browser
 * must never decide what an operator's money screen shows.
 */
export function usePointScope() {
  const { data: me, isPending } = useMeQuery();
  const [param, setParam] = useUrlParam('point');
  const isOwner = me?.role === 'network_owner';

  const setPointId = useCallback(
    (id: string | null) => {
      setParam(id);
      // Remembered only for the role that can choose.
      if (isOwner) storePoint(id);
    },
    [setParam, isOwner],
  );

  // `collection_point_id` is `@IsUUID()` server-side; a hand-edited or stale
  // `?point=` must not reach the API as-is — shape it away here rather than
  // 400 every read it scopes. The remembered value is validated the same way
  // by `getStoredPoint`, so both paths carry the same guarantee.
  const fromUrl = keepUuids(param ? [param] : null)?.[0] ?? null;
  const pointId = fromUrl ?? (isOwner ? getStoredPoint() : null);

  if (me?.role === 'point_operator') {
    return { pointId: me.collection_point_id, canPick: false, setPointId, isLoading: false };
  }
  return { pointId, canPick: Boolean(isOwner), setPointId, isLoading: isPending };
}

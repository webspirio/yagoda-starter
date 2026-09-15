import { useMemo } from 'react';
import { usePointScope } from '@/entities/user';
import { usePointOptionsQuery, type PointOption } from '@/entities/collection-point';

/**
 * WHICH POINT THE SCREEN IS ABOUT, resolved the way an owner expects.
 *
 * WHY THIS IS A FEATURE AND NOT PART OF `entities/user`. The answer depends on
 * TWO entities at once — the user (their role, and the point an operator is
 * pinned to) and the collection points (which one is the склад). FSD forbids a
 * cross-import between slices on one layer, and merging `user` into
 * `collection-point` would be absurd, so the composition moves UP a layer.
 * That is Strategy C — compose from above — and this hook is where it happens,
 * once, rather than in each of the screens that need it.
 *
 * THE RESOLUTION ORDER, and why each step is where it is:
 *
 *   1. `?point=` — an explicit choice, and the only one that survives being
 *      pasted to someone else. A link must always win over anything local.
 *   2. The remembered point — the last one this owner picked, on any screen.
 *      Every screen has its own URL, so without this the choice died at every
 *      navigation and the owner re-picked the same point all day.
 *   3. THE WAREHOUSE — the owner's own place, and the only point they are
 *      always concerned with. This is the first-visit answer, not a preference.
 *   4. Any active point, if this network has no warehouse at all.
 *
 * AN OPERATOR PASSES THROUGH UNTOUCHED. Their point comes from their token and
 * the server ignores anything else, so none of the above ever applies to them —
 * and it must not, because a remembered id from a shared browser must never
 * decide what an operator's money screen shows.
 *
 * NOTHING IS WRITTEN TO THE URL BY RESOLVING. A fallback that pushed itself
 * into `?point=` would rewrite history on every page load and turn the Back
 * button into a loop; the id is returned, and only a real pick is recorded.
 */
export function useWorkingPoint() {
  const scope = usePointScope();
  const { data: points, isPending } = usePointOptionsQuery();

  const fallback = useMemo(() => defaultPointOf(points), [points]);

  // An operator is pinned by the server; nothing here may move them.
  if (!scope.canPick) return scope;

  return {
    ...scope,
    pointId: scope.pointId ?? fallback,
    // Still loading while the points are on their way: a screen that reads
    // `pointId === null` as «nothing chosen» would flash an empty state and
    // then fill in, which reads as a bug.
    isLoading: scope.isLoading || isPending,
  };
}

/** §4.8's склад, else any active point, else nothing to fall back to. */
function defaultPointOf(points: PointOption[] | undefined): string | null {
  if (!points || points.length === 0) return null;
  const warehouse = points.find((p) => p.kind === 'base');
  return (warehouse ?? points[0]).id;
}

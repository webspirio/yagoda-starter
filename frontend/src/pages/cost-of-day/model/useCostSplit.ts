import { useCallback } from 'react';
import { useUrlParam } from '@/shared/lib/url-state';
import { getStoredCostSplit, storeCostSplit } from '@/shared/lib/split-preference';
import { isCostSplit, type CostSplit } from '@/entities/cost-of-day';

/**
 * «Розподіл кошика» as page state (spec 2026-10-24 §3.1): `?split=` when it
 * holds a known value, else the browser's remembered choice, else `weight`.
 * An unknown value never reaches the API — it would be a 400 there.
 *
 * Picking a split writes BOTH: the URL so a reload or a shared link shows the
 * same view, and the memory so the next visit without `?split=` does too.
 */
export function useCostSplit(): [CostSplit, (next: CostSplit) => void] {
  const [param, setParam] = useUrlParam('split');
  const stored = getStoredCostSplit();
  const split: CostSplit = isCostSplit(param) ? param : isCostSplit(stored) ? stored : 'weight';

  const setSplit = useCallback(
    (next: CostSplit) => {
      setParam(next);
      storeCostSplit(next);
    },
    [setParam],
  );

  return [split, setSplit];
}

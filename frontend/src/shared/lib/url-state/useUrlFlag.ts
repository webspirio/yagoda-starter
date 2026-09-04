import { useCallback } from 'react';
import { useUrlParam } from './useUrlParam';

/** The only truthy encoding. Anything else — including `0` — reads as lowered. */
const RAISED = '1';

/**
 * A boolean UI flag held in the query string, so it survives the unmount an
 * outward navigation causes and is restored on the way back. See `useUrlParam`
 * for why a write replaces the history entry rather than pushing one.
 *
 * Lowered is encoded as ABSENT rather than `=0`: the URL is shareable, and a
 * closed sheet should leave nothing behind to explain.
 */
export function useUrlFlag(name: string): [boolean, (open: boolean) => void] {
  const [value, setValue] = useUrlParam(name);

  const setFlag = useCallback(
    (open: boolean) => setValue(open ? RAISED : null),
    [setValue],
  );

  return [value === RAISED, setFlag];
}

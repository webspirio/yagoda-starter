import { useCallback } from 'react';
import { useSearchParams } from 'react-router';

/**
 * `null` deletes the key. A `string[]` becomes repeated params — and an EMPTY
 * array a single present-but-empty one, which is how "the user cleared this
 * dimension" stays distinguishable from "absent, so use the default" (see
 * `useUrlList`).
 */
export type UrlPatchValue = string | number | string[] | null;

/**
 * Applies several query-param changes in ONE navigation.
 *
 * That is the whole point: every list setter here also resets the page, so a
 * single user action touches two keys. Two sequential `setSearchParams` calls
 * in one tick both read the same un-committed `prev`, so the second silently
 * drops the first — a lost page reset that only shows up as an out-of-range
 * request. One patch, one write, no interleaving.
 *
 * Writes replace the current history entry; see `useUrlParam` for why that is
 * what makes state survive a round trip without growing the history.
 */
export function useUrlPatch(): (patch: Record<string, UrlPatchValue>) => void {
  const [, setSearchParams] = useSearchParams();

  return useCallback(
    (patch: Record<string, UrlPatchValue>) => {
      setSearchParams(
        (prev) => {
          // A copy of `prev`, never a fresh URLSearchParams: keys this patch
          // says nothing about must survive untouched.
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(patch)) {
            if (value === null) {
              next.delete(key);
            } else if (Array.isArray(value)) {
              // Delete first — `append` in a loop would otherwise stack the new
              // values on top of the old ones.
              next.delete(key);
              if (value.length === 0) next.append(key, '');
              else for (const item of value) next.append(key, item);
            } else {
              next.set(key, String(value));
            }
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
}

import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { useUrlPatch } from './useUrlPatch';

/**
 * A multi-select dimension held in the query string as repeated params
 * (`?city=a&city=b`).
 *
 * Reads `string[] | null`, and the `null` is load-bearing: an ABSENT param
 * means "untouched, so use the caller's default" -- the user's own saved
 * cities, a list's default cohort, `DEFAULT_STATUS` -- while an EMPTY array
 * means the user deliberately widened the dimension to all. Callers resolve
 * it the same way: `override ?? theDefault`. Where the default is itself
 * `[]` the two collapse, and `?? []` is all a caller needs.
 *
 * The empty case is encoded as a present-but-empty param (`?city=`), which is
 * what makes that distinction round-trip through a URL at all.
 */
export function useUrlList(name: string): [string[] | null, (value: string[] | null) => void] {
  const [searchParams] = useSearchParams();
  const patch = useUrlPatch();

  const value = useMemo(() => {
    // Read inside the memo, keyed on `searchParams` itself: it is memoised per
    // location, so this recomputes exactly when the URL changes and never in
    // between. An earlier version keyed on the joined values and missed the
    // absent -> explicitly-empty transition, since `[]` and `['']` join alike.
    const raw = searchParams.getAll(name);
    return raw.length === 0 ? null : raw.filter((item) => item !== '');
  }, [searchParams, name]);

  const setValue = useCallback((next: string[] | null) => patch({ [name]: next }), [name, patch]);

  return [value, setValue];
}

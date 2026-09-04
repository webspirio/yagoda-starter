/**
 * Drops values a hand-edited URL should not be able to inject, preserving the
 * `null` that means "param absent, use the caller's default" (see `useUrlList`).
 *
 * This is the boundary. The query string is user-editable and shareable, so an
 * unknown enum value has to stop here rather than travel on to a backend that
 * answers a bad enum with a 400 -- a shared link with one stale filter value
 * would otherwise render an error page instead of a list.
 */
export function keepKnown<T extends string>(
  values: string[] | null,
  allowed: readonly T[],
): T[] | null {
  if (values === null) return null;
  const known = new Set<string>(allowed);
  return values.filter((value): value is T => known.has(value));
}

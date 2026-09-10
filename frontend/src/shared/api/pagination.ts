/**
 * The list envelope every paginated `GET` endpoint returns — hand-copied
 * into nine model files before this consolidation (`git log` still shows the
 * comments each copy carried about why: FSD forbids a same-layer
 * cross-import, so `entities/payout` could not just `import` it from
 * `entities/intake`). One definition here, imported everywhere, ends that.
 */
export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

/**
 * True when `page.data` is only the most recent slice of a longer list —
 * every read in this app caps at `limit: 100` with no paging UI, so a screen
 * that sums or lists `page.data` needs to know when that sum or list is
 * incomplete. `undefined` (a read still pending, or disabled) reads as "not
 * truncated" rather than throwing — the same "say nothing until there is
 * something to say" default every call site already assumed by hand.
 */
export function isTruncated<T>(page: Paginated<T> | undefined): boolean {
  return page ? page.total > page.data.length : false;
}

/**
 * Drops anything that is not a UUID, preserving the `null` that means "param
 * absent, use the caller's default" (see `useUrlList`).
 *
 * The id-shaped filters -- e.g. a tag or category id -- carry reference-list
 * ids this client cannot enumerate, so `keepKnown` has no list to check them
 * against. The backend does validate them (`@IsUUID` with `each: true`), which
 * is exactly the problem: one malformed id in a shared or hand-edited link
 * turns the whole list into a 400, an error page in place of a list, over a
 * value the user never typed into the UI. Shape is all this can check -- an id
 * that is well-formed but unknown simply matches nothing, which is a correct
 * empty list rather than an error.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function keepUuids(values: string[] | null): string[] | null {
  if (values === null) return null;
  return values.filter((value) => UUID.test(value));
}

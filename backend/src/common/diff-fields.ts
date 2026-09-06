export interface FieldDiff {
  changed: string[];
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

/**
 * The one field-diff used to build an audit payload.
 *
 * Returns `null` — not an empty diff — when nothing in `keys` moved, because
 * every call site already guards on exactly that: a no-op PATCH must not write
 * an entry, and an audit log full of noise is one nobody reads.
 *
 * Comparison is `!==`, matching the four hand-rolled versions this replaces.
 * That is identity for the value types actually diffed here (string, boolean,
 * null, and `numeric` columns, which TypeORM returns as strings).
 */
export function diffFields<T extends object>(
  before: T,
  after: T,
  keys: readonly (keyof T & string)[],
): FieldDiff | null {
  const changed = keys.filter((key) => before[key] !== after[key]);
  if (changed.length === 0) return null;

  return {
    changed,
    before: Object.fromEntries(changed.map((key) => [key, before[key]])),
    after: Object.fromEntries(changed.map((key) => [key, after[key]])),
  };
}

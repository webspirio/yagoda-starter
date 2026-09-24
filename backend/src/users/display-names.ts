import { EntityManager, In } from 'typeorm';
import { User } from './user.entity';
import { displayNameOf } from './display-name';

/**
 * `displayNameOf`, BATCHED — the seam every list-shaped response reaches for
 * (D-8: `ShiftResponse.opened_by_name`/`closed_by_name`,
 * `CashCountRowResponse.counted_by_name`) instead of resolving one user per
 * row. ONE `id IN (...)` query, never one per row — a page of shifts or cash
 * counts loads exactly one map and every row's mapper call reads it.
 *
 * An id with no matching row (there is no FK from a response's `*_user_id`
 * column to a live `users` row that survives forever, only `is_active`) is
 * simply absent from the map; every caller reads it back with
 * `names.get(id) ?? null`, matching `displayNameOf`'s own contract of never
 * guessing at a name it cannot derive.
 */
export async function loadDisplayNames(
  manager: EntityManager,
  ids: Iterable<string>,
): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return new Map();

  const rows = await manager.find(User, {
    where: { id: In(uniqueIds) },
    select: { id: true, first_name: true, last_name: true },
  });

  return new Map(rows.map((row) => [row.id, displayNameOf(row)]));
}

import type { User } from './user.entity';

/**
 * THE definition of a user's display name. There is no `display_name` column
 * (see `user.entity.ts`), so every response that shows one derives it — and
 * three call sites now do: `GET /me`, the user-admin mapper, and the message
 * naming who still calls a collection point home.
 *
 * It lives here, in the users domain, because those three had already begun
 * to diverge: two spelled it inline and only one of them trimmed, so a user
 * with an empty `last_name` rendered as "Оксана " in one place and "Оксана"
 * in another. A name shown to a person is a single fact; the `.trim()` is
 * part of it.
 *
 * Structurally typed rather than taking a full `User`: the caller may hold a
 * partially selected row, and this needs exactly two columns.
 */
export function displayNameOf(user: Pick<User, 'first_name' | 'last_name'>): string {
  return `${user.first_name} ${user.last_name}`.trim();
}

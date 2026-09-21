import { useQuery } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import type { Paginated } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { STALE } from '@/shared/api/queryClient';

/**
 * The `GET /users` row shape this hook needs. Mirrors `AdminUser`
 * (`pages/users/api/users.ts` / `pages/users/model/user.ts`) field-for-field —
 * `entities/` may not import from `pages/`, so the shape is repeated here
 * rather than shared, but it must never drift from it. `first_name`/`last_name`
 * are NOT NULL columns on `users` (confirmed against `user.entity.ts` and the
 * `UserResponse` DTO), so they arrive as `string`, never `null` — an unfilled
 * name is `''`, not `null`.
 */
export interface StaffMember {
  id: string;
  first_name: string;
  last_name: string;
  login: string;
}

/**
 * WHO — the staff directory, as an id → display-name map.
 *
 * A document stores `weighed_by_user_id` and `voided_by_user_id`, and every
 * screen that prints a storno trace has to turn one into a name. `GET /users`
 * is OWNER-ONLY, so `enabled` is the caller's answer to «is this reader
 * allowed to ask» — an operator screen passes `false` and simply prints no
 * name rather than firing a request that would 403.
 *
 * Resolves to a `Map`, not a list: every consumer wants a lookup — "who is
 * `voided_by_user_id`?" — and handing out the array puts the same `.find()`
 * in each of them.
 */
export function useStaffQuery(enabled: boolean) {
  return useQuery({
    // Appends to `queryKeys.users` rather than reusing it bare: `useUsersQuery`
    // (pages/users) already caches `['users']` as `Paginated<AdminUser>` with
    // `include_inactive: true`; sharing that key here would serve one read's
    // response to the other.
    queryKey: [...queryKeys.users, 'directory'] as const,
    enabled,
    queryFn: async (): Promise<Map<string, string>> => {
      // include_inactive: users are never deleted, only deactivated, and this
      // hook exists to name the author of a HISTORICAL or voided document —
      // omitting it (service default: false) would drop anyone who has since
      // left from the Map entirely, leaving a storno with no author at all
      // (§8.7 forbids exactly that). Mirrors pages/users/api/users.ts's own
      // "Owner-facing registry, so inactive users are asked for too."
      const { data } = await httpClient.get<Paginated<StaffMember>>('/users', {
        params: { limit: 100, include_inactive: true },
      });
      return new Map(
        data.data.map((u) => [
          u.id,
          // .trim() before .filter(Boolean): NOT NULL doesn't mean non-empty,
          // and a whitespace-only name is truthy — without the trim it would
          // survive the filter and print a blank author beside a storno
          // reason, the exact failure the `|| login` fallback exists to stop.
          [u.first_name.trim(), u.last_name.trim()].filter(Boolean).join(' ') || u.login,
        ]),
      );
    },
    staleTime: STALE.reference,
  });
}

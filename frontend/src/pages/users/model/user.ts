export type UserRole = 'network_owner' | 'point_operator';

/** Re-exported so existing `../model/user` importers keep working — see `@/shared/api/pagination.ts`. */
export type { Paginated } from '@/shared/api';

/**
 * Mirrors the backend `UserResponse`. `display_name` is server-derived from
 * first/last name; `collection_point_id` is `null` for a network owner (they
 * belong to the network, not a point). Users are never deleted — deactivate
 * them via `is_active`.
 */
export interface AdminUser {
  id: string;
  login: string;
  first_name: string;
  last_name: string;
  display_name: string;
  role: UserRole;
  collection_point_id: string | null;
  is_active: boolean;
  avatar_url: string | null;
  created_at: string;
}

/**
 * POST body. `collection_point_id` is REQUIRED for a point operator and
 * FORBIDDEN for a network owner — send `null` for the owner.
 */
export interface CreateUserInput {
  first_name: string;
  last_name: string;
  login: string;
  password: string;
  role: UserRole;
  collection_point_id?: string | null;
}

/**
 * PATCH body. All optional. `first_name`/`last_name`/`login`/`role`/`is_active`
 * back NOT NULL columns — send them ONLY when changed and NEVER as `null`;
 * `collection_point_id` may be `null` (clears a point / owner has none). No
 * password here — that has its own endpoint.
 */
export interface UpdateUserInput {
  id: string;
  first_name?: string;
  last_name?: string;
  login?: string;
  role?: UserRole;
  is_active?: boolean;
  collection_point_id?: string | null;
}

/** PUT `/users/:id/password` body carrier — password reset is its own mutation. */
export interface SetPasswordInput {
  id: string;
  password: string;
}

/**
 * `GET /users/:id/password`. `password` is null whenever there is nothing to
 * show, and `vault_enabled` says WHY: false means the deployment has no
 * `PASSWORD_VAULT_KEY` (nothing the owner can do in the UI), true means this
 * particular password was issued before the vault and reissuing it makes it
 * readable.
 */
export interface RevealedPassword {
  password: string | null;
  vault_enabled: boolean;
}

/**
 * Form values — all strings/booleans for the controls. `collection_point_id`
 * is '' when unset; `role` defaults to `point_operator` (the common case).
 */
export interface UserFormValues {
  first_name: string;
  last_name: string;
  login: string;
  password: string;
  role: UserRole;
  collection_point_id: string;
  is_active: boolean;
}

import { User } from '../users/user.entity';
import { UserRole } from '../users/user-role.enum';
import { displayNameOf } from '../users/display-name';

export interface UserResponse {
  id: string;
  login: string;
  first_name: string;
  last_name: string;
  /** DERIVED — there is no display_name column. */
  display_name: string;
  role: UserRole;
  collection_point_id: string | null;
  is_active: boolean;
  avatar_url: string | null;
  created_at: string;
}

export function toUserResponse(user: User, login: string): UserResponse {
  return {
    id: user.id,
    login,
    first_name: user.first_name,
    last_name: user.last_name,
    // Not spelled inline here: `displayNameOf` is the one definition, shared
    // with GET /me and with the "reassign these users first" message.
    display_name: displayNameOf(user),
    role: user.role,
    collection_point_id: user.collection_point_id,
    is_active: user.is_active,
    avatar_url: user.avatar_url,
    created_at: user.created_at.toISOString(),
  };
}

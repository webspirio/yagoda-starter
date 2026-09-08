export type UserRole = 'network_owner' | 'point_operator';

export interface Me {
  id: string;
  username: string;
  /** Server-derived from first_name + last_name. Read-only: the owner names
   *  staff through the users admin API, not the profile screen. */
  display_name: string;
  avatar_url: string | null;
  language_code: string | null;
  role: UserRole;
  /** null for a network_owner — they belong to the network, not a point. */
  collection_point_id: string | null;
}

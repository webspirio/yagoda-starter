/**
 * §10.1 knows exactly two roles: the person at the point who receives berries,
 * and the person who runs the network.
 *
 * The values are `point_operator` / `network_owner`, NOT `point_manager` /
 * `network_admin` — the earlier names called the person AT THE POINT a
 * "manager" and the person running the network an "administrator", which is
 * neither what they are nor what the rules call them. Renamed 02.09.2026;
 * recorded here so it is not "corrected" back.
 */
export enum UserRole {
  NetworkOwner = 'network_owner',
  PointOperator = 'point_operator',
}

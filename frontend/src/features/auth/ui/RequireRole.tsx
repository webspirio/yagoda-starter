import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useMeQuery, type UserRole } from '@/entities/user';
import { Spinner } from '@/shared/ui/spinner';

/**
 * Route guard on ROLE, to be composed inside `RequireAuth` — which handles the
 * "no token at all" case and redirects to /login.
 *
 * IT CANNOT MIRROR `RequireAuth`, AND THE REASON IS LOAD-BEARING. `RequireAuth`
 * decides synchronously, because the token is in a Zustand store read from
 * localStorage. Role is NOT in the token: the JWT payload is `{ sub }` and
 * nothing else, deliberately, so that nothing inside it can go stale while a
 * user is demoted or reassigned. Role therefore arrives from the `me` query,
 * which on a cold load is still in flight when this first renders.
 *
 * So a pending query renders a spinner and redirects NOBODY. Redirecting on
 * "role is not yet network_owner" would bounce an owner to the dashboard for
 * one frame on every hard refresh of a guarded route.
 *
 * This is UX, not enforcement. Every write the guarded screens make is
 * `@Auth(UserRole.NetworkOwner)` server-side and 403s regardless of what the
 * client chose to render.
 */
export function RequireRole({ role, children }: { role: UserRole; children: ReactNode }) {
  const { data: me, isPending } = useMeQuery();

  if (isPending) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }
  if (me?.role !== role) return <Navigate to="/" replace />;
  return <>{children}</>;
}

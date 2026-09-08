import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMeQuery, type UserRole } from '@/entities/user';
import { Spinner } from '@/shared/ui/spinner';

/**
 * Route guard on ROLE, composed INSIDE `RequireAuth` — which handles the
 * "no token at all" case and redirects to /login.
 *
 * It cannot mirror `RequireAuth`, and the reason is load-bearing. `RequireAuth`
 * decides synchronously because the token is a Zustand value read from
 * localStorage. Role is NOT in the token (the JWT payload is `{ sub }` and
 * nothing else, deliberately, so nothing in it goes stale when a user is
 * demoted or reassigned). Role arrives from the `me` query, which on a cold
 * load is still in flight when this first renders — so a pending query renders
 * a spinner and redirects nobody. Redirecting on "role is not yet owner" would
 * bounce a real owner to the dashboard for one frame on every hard refresh.
 *
 * This is UX, not enforcement: every write the guarded screens make is
 * `@Auth(UserRole.NetworkOwner)` server-side and 403s regardless. A FAILED
 * `me` query renders an error rather than "wrong role" — fail-closed buys
 * nothing here (the server 403s anyway) and would blank a legitimate owner on
 * a transient 500.
 */
export function RequireRole({ role, children }: { role: UserRole; children: ReactNode }) {
  const { t } = useTranslation();
  const { data: me, isPending, isError } = useMeQuery();

  if (isPending) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }
  if (isError || !me) {
    return (
      <p role="alert" className="text-destructive">
        {t('common.somethingWentWrong')}
      </p>
    );
  }
  if (me.role !== role) return <Navigate to="/" replace />;
  return <>{children}</>;
}

import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useSession } from '@/entities/user';

/**
 * Gate for authenticated routes. Guards on the token's presence only — the
 * backend is the authority on whether it is still valid, and a 401 clears the
 * session, which re-runs this component and redirects.
 *
 * The attempted path travels in router state so the login screen can send the
 * user back where they were headed.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const token = useSession((s) => s.token);
  const location = useLocation();

  if (token === null) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
}

import { Navigate, useLocation } from 'react-router';

/**
 * `/day` → `/point-cash`, query string and all (#221). A bare
 * `<Navigate to="/point-cash" />` drops `?point=` and `?date=`, which is the
 * whole reason the old address is kept: a shared link to a past day must land
 * on that day. Its own module because `router.tsx` exports plain values and is
 * therefore not a Fast Refresh boundary (see the note on `./lazy-routes`).
 */
export function RedirectToPointCash() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: '/point-cash', search }} replace />;
}

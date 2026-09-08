import { createBrowserRouter, type RouteObject } from 'react-router';
import { AppLayout } from './layouts/AppLayout';
import { RouteError } from './providers/RouteError';
import { RequireAuth, RequireRole } from '@/features/auth';
import { LoginPage } from '@/pages/login';
import { DashboardPage } from '@/pages/dashboard';
import { ProfilePage } from '@/pages/profile';
import { PointsPage } from '@/pages/points';
import { UsersPage } from '@/pages/users';
import { SuppliersPage } from '@/pages/suppliers';
import { CatalogPage } from '@/pages/catalog';
import { PricesPage } from '@/pages/prices';
import { DayPage } from '@/pages/day';
import { ReceptionPage } from '@/pages/reception';
import { NotFoundPage } from '@/pages/not-found';
import { UiKitPage } from '@/pages/ui-kit';

/**
 * `routes` is exported separately from `router` so tests can drive the same
 * tree through `createMemoryRouter`.
 *
 * `/login` is the only public route. Everything else is wrapped in
 * RequireAuth individually rather than guarding the layout, so the layout can
 * render the auth screens bare (see AppLayout's CHROMELESS list).
 */
export const routes: RouteObject[] = [
  // Standalone dev gallery of the shared/ui kit — no AppLayout shell, no auth,
  // so it opens directly at /ui-kit for visual review.
  { path: '/ui-kit', element: <UiKitPage />, errorElement: <RouteError /> },
  {
    element: <AppLayout />,
    errorElement: <RouteError />,
    children: [
      { path: '/login', element: <LoginPage /> },
      {
        path: '/',
        element: (
          <RequireAuth>
            <DashboardPage />
          </RequireAuth>
        ),
      },
      {
        path: '/profile',
        element: (
          <RequireAuth>
            <ProfilePage />
          </RequireAuth>
        ),
      },
      {
        // Suppliers are a point-level record open to BOTH roles — an operator
        // sees only their own point's (scoped server-side from the token), the
        // owner sees all — so this is RequireAuth WITHOUT a role gate.
        path: '/suppliers',
        element: (
          <RequireAuth>
            <SuppliersPage />
          </RequireAuth>
        ),
      },
      {
        // Both roles: the operator receives the berries, the owner watches the
        // same screen on a point they picked. Owner-only actions inside are
        // gated by `me.role`, not by the route.
        path: '/reception',
        element: (
          <RequireAuth>
            <ReceptionPage />
          </RequireAuth>
        ),
      },
      {
        // Both roles: the operator runs their shift, the owner reads (and reopens).
        path: '/day',
        element: (
          <RequireAuth>
            <DayPage />
          </RequireAuth>
        ),
      },
      {
        path: '/points',
        element: (
          <RequireAuth>
            <RequireRole role="network_owner">
              <PointsPage />
            </RequireRole>
          </RequireAuth>
        ),
      },
      {
        path: '/users',
        element: (
          <RequireAuth>
            <RequireRole role="network_owner">
              <UsersPage />
            </RequireRole>
          </RequireAuth>
        ),
      },
      {
        // Day prices are owner-only: `/current` GET is open to both roles
        // server-side, but `POST /grade-prices` is @Auth(NetworkOwner). The
        // operator's read-only price view arrives with the intake screen later.
        path: '/prices',
        element: (
          <RequireAuth>
            <RequireRole role="network_owner">
              <PricesPage />
            </RequireRole>
          </RequireAuth>
        ),
      },
      {
        // The tare & grades catalog is owner-only: GET is open to both roles
        // server-side, but every write here is @Auth(NetworkOwner).
        path: '/catalog',
        element: (
          <RequireAuth>
            <RequireRole role="network_owner">
              <CatalogPage />
            </RequireRole>
          </RequireAuth>
        ),
      },
      {
        path: '*',
        element: (
          <RequireAuth>
            <NotFoundPage />
          </RequireAuth>
        ),
      },
    ],
  },
];

export const router = createBrowserRouter(routes);

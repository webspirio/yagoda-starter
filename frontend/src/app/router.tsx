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
import { DebtsPage } from '@/pages/debts';
import { SupplierCardPage } from '@/pages/supplier-card';
import { CatalogPage } from '@/pages/catalog';
import { PricesPage } from '@/pages/prices';
import { DayPage } from '@/pages/day';
import { ReceptionPage } from '@/pages/reception';
import { JournalPage } from '@/pages/journal';
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
        // Both roles: the API scopes an operator to their point and an owner
        // to everything, same as /suppliers — no role gate here either.
        path: '/debts',
        element: (
          <RequireAuth>
            <DebtsPage />
          </RequireAuth>
        ),
      },
      {
        // The supplier's card — same point-level scope as the list above, so
        // it carries the same guard: RequireAuth, no role gate.
        path: '/suppliers/:id',
        element: (
          <RequireAuth>
            <SupplierCardPage />
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
        // Both roles: `GET /grade-prices` (current + history) is open to both
        // server-side, but `POST /grade-prices` is @Auth(NetworkOwner) — the
        // operator sees the same table LOCKED instead of Change/Set.
        path: '/prices',
        element: (
          <RequireAuth>
            <PricesPage />
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
        // The full receipts/payouts register is owner-only — an operator's
        // view is scoped to their own point's shift already (Каса за день).
        path: '/journal',
        element: (
          <RequireAuth>
            <RequireRole role="network_owner">
              <JournalPage />
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

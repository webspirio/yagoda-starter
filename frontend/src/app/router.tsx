import { createBrowserRouter, Outlet, type RouteObject } from 'react-router';
import { AppLayout } from './layouts/AppLayout';
import { RouteError } from './providers/RouteError';
import { HydrateFallback } from './providers/HydrateFallback';
import { RequireAuth, RequireRole } from '@/features/auth';
import { LoginPage } from '@/pages/login';
import { DashboardPage } from '@/pages/dashboard';
import { ProfilePage } from '@/pages/profile';
import { SuppliersPage } from '@/pages/suppliers';
import { DebtsPage } from '@/pages/debts';
import { SupplierCardPage } from '@/pages/supplier-card';
import { PricesPage } from '@/pages/prices';
import { DayPage } from '@/pages/day';
import { ReceptionPage } from '@/pages/reception';
import { CratesPage } from '@/pages/crates';
import { PointCashPage } from '@/pages/point-cash';
import { NotFoundPage } from '@/pages/not-found';

/**
 * `routes` is exported separately from `router` so tests can drive the same
 * tree through `createMemoryRouter`.
 *
 * `/login` is the only public route. Everything else is wrapped in
 * RequireAuth individually rather than guarding the layout, so the layout can
 * render the auth screens bare (see AppLayout's CHROMELESS list).
 *
 * Every eager route below imports its page statically, so it ships in the
 * app's one entry chunk. Owner-only pages (`/catalog` included — see its
 * comment below) are `lazy` instead, grouped under the one pathless guard
 * layout further down, so their code only downloads on first navigation to
 * one of them.
 */
export const routes: RouteObject[] = [
  // Standalone dev gallery of the shared/ui kit — no AppLayout shell, no auth,
  // so it opens directly at /ui-kit for visual review. Dev-only: a developer
  // tool, not something production ships. `import.meta.env.DEV` is baked in
  // at build time, so the production bundle never even contains this array
  // entry, let alone the lazily-imported page module.
  ...(import.meta.env.DEV
    ? [
        {
          path: '/ui-kit',
          lazy: () => import('@/pages/ui-kit').then((m) => ({ Component: m.UiKitPage })),
          errorElement: <RouteError />,
          // Outside AppLayout, so no ancestor route supplies a fallback for a
          // direct load — without its own, React Router warns "No
          // HydrateFallback element provided" and renders nothing meanwhile.
          hydrateFallbackElement: <HydrateFallback />,
        } satisfies RouteObject,
      ]
    : []),
  {
    element: <AppLayout />,
    errorElement: <RouteError />,
    hydrateFallbackElement: <HydrateFallback />,
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
        // Both roles: the OPERATOR is the one standing at the table handing
        // crates over, so there is no role gate here. §10.2 gates only the
        // ALLOTMENT, which lives on the points screen.
        path: '/crates',
        element: (
          <RequireAuth>
            <CratesPage />
          </RequireAuth>
        ),
      },
      {
        // Owner-only pages, grouped under ONE guard layout so the shell
        // (AppLayout, above) and both guards stay eager while only the
        // matched page's own module is deferred (`lazy` resolves on first
        // match). A lazy route's own entry may hold only `path` + `lazy` —
        // react-router lets STATIC properties on a route win over `lazy`
        // ones, so a guard declared on the lazy route itself would never
        // actually run — which is why RequireAuth/RequireRole live here, on
        // a pathless parent, and each lazy child below is nothing but a path
        // and an import.
        //
        // A typed owner URL still fetches this group's `lazy` chunk before
        // RequireRole redirects — accepted 2026-09-21; document it, don't build around it.
        //
        // errorElement here (rather than relying on AppLayout's own, above) stops a
        // rejected `lazy()` fetch from bubbling all the way up and replacing the WHOLE
        // shell: an ordinary redeploy retires old hashed chunks, so a session that still
        // holds a stale index.html can have one of these five imports reject. Without an
        // errorElement on THIS route, react-router bubbles the error to the nearest
        // ancestor that has one — AppLayout — unmounting the sidebar and nav along with
        // the failed page. Declaring it here instead means only this group's own content
        // (the Outlet above) is replaced; the shell survives.
        element: (
          <RequireAuth>
            <RequireRole role="network_owner">
              <Outlet />
            </RequireRole>
          </RequireAuth>
        ),
        errorElement: <RouteError />,
        children: [
          {
            path: '/points',
            lazy: () => import('@/pages/points').then((m) => ({ Component: m.PointsPage })),
          },
          {
            path: '/users',
            lazy: () => import('@/pages/users').then((m) => ({ Component: m.UsersPage })),
          },
          {
            // The tare & grades catalog is owner-only: GET is open to both
            // roles server-side, but every write here is @Auth(NetworkOwner).
            path: '/catalog',
            lazy: () => import('@/pages/catalog').then((m) => ({ Component: m.CatalogPage })),
          },
          {
            // The full receipts/payouts register is owner-only — an operator's
            // view is scoped to their own point's shift already (Каса за день).
            path: '/journal',
            lazy: () => import('@/pages/journal').then((m) => ({ Component: m.JournalPage })),
          },
          {
            // Лише керівник: заборгованість перед ІНШИМИ точками — не справа
            // приймальника (§7, G16). Тому роль-гейт маршруту, а не сірі кнопки.
            path: '/transfers',
            lazy: () => import('@/pages/transfers').then((m) => ({ Component: m.TransfersPage })),
          },
        ],
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
        // Обидві ролі: приймальник прибитий до своєї точки токеном, керівник
        // обирає точку. Дії всередині гейтяться `me.role`, не маршрутом.
        path: '/point-cash',
        element: (
          <RequireAuth>
            <PointCashPage />
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

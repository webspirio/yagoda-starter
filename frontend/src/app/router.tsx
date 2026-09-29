import { createBrowserRouter, Outlet, type RouteObject } from 'react-router';
import { AppLayout } from './layouts/AppLayout';
import { RouteError } from './providers/RouteError';
import { HydrateFallback } from './providers/HydrateFallback';
import { RequireAuth, RequireRole } from '@/features/auth';

// EAGER — the screens an operator opens every shift, plus the two auth-shaped
// ones. These stay in the entry chunk deliberately: a chunk request costs a
// round trip on the mobile data an operator is standing in the field with, and
// paying it for /reception or /day would make the daily path slower to save
// bytes the daily path was already going to need.
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

// LAZY — the owner-only group, in ONE chunk fetched the first time an owner
// opens any of these seven screens. They live in their own module because a
// file that DEFINES components and also exports plain values (`routes`,
// `router`) is not a Fast Refresh boundary — eslint-plugin-react-refresh
// says so, and this repo's eslint config answers that by extracting rather
// than whitelisting. `./lazy-routes` carries the measurements behind the
// one-chunk choice and the guard-before-chunk ordering the routes below
// depend on; read it before adding an eighth.
import {
  CatalogPage,
  CostOfDayPage,
  JournalPage,
  PointsPage,
  ReweighPage,
  TransfersPage,
  UsersPage,
} from './lazy-routes';

/**
 * `routes` is exported separately from `router` so tests can drive the same
 * tree through `createMemoryRouter`.
 *
 * `/login` is the only public route. Everything else is wrapped in
 * RequireAuth individually rather than guarding the layout, so the layout can
 * render the auth screens bare (see AppLayout's CHROMELESS list).
 *
 * Every eager route below imports its page statically, so it ships in the
 * app's entry chunk. Owner-only pages (`/catalog` included — see its comment
 * below) are React.lazy instead, grouped under the one pathless guard layout
 * further down, so their shared chunk only downloads the first time an owner
 * opens one of them.
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
        // Owner-only pages, grouped under ONE guard layout. The pages are
        // React.lazy components from `./lazy-routes` (one shared chunk), and
        // the guards here are the ORDERING that chunk depends on: RequireRole
        // renders the `<Outlet />` — and so constructs-then-renders the lazy
        // child — only once the role check passes, so an operator is
        // redirected before the chunk is ever requested
        // (router.lazy-guard.test.tsx holds that down).
        //
        // errorElement here (rather than relying on AppLayout's own, above) stops a
        // rejected chunk fetch from bubbling all the way up and replacing the WHOLE
        // shell: an ordinary redeploy retires old hashed chunks, so a session that still
        // holds a stale index.html can have the owner chunk's import reject. Without an
        // errorElement on THIS route, react-router bubbles the error to the nearest
        // ancestor that has one — AppLayout — unmounting the sidebar and nav along with
        // the failed page. Declaring it here instead means only this group's own content
        // (the Outlet above) is replaced; the shell survives — which is also why
        // `fullHeight={false}` matters here and nowhere else: this fallback renders INSIDE
        // AppLayout's `<main>`, in the pane the sidebar leaves for it, not as the whole
        // page the way AppLayout's own errorElement (above) or /ui-kit's is.
        element: (
          <RequireAuth>
            <RequireRole role="network_owner">
              <Outlet />
            </RequireRole>
          </RequireAuth>
        ),
        errorElement: <RouteError fullHeight={false} />,
        children: [
          { path: '/points', element: <PointsPage /> },
          { path: '/users', element: <UsersPage /> },
          {
            // The tare & grades catalog is owner-only: GET is open to both
            // roles server-side, but every write here is @Auth(NetworkOwner).
            path: '/catalog',
            element: <CatalogPage />,
          },
          {
            // The full receipts/payouts register is owner-only — an operator's
            // view is scoped to their own point's shift already (Каса за день).
            path: '/journal',
            element: <JournalPage />,
          },
          {
            // Лише керівник: заборгованість перед ІНШИМИ точками — не справа
            // приймальника (§7, G16). Тому роль-гейт маршруту, а не сірі кнопки.
            path: '/transfers',
            element: <TransfersPage />,
          },
          {
            // Owner-only: this is the screen at the scale, at the base — not a
            // point-level document any operator could write.
            path: '/reweigh',
            element: <ReweighPage />,
          },
          {
            // Owner-only, like /reweigh: §8's reads as well as its writes are the
            // base's view of a point, not something the point sees about itself.
            path: '/cost-of-day',
            element: <CostOfDayPage />,
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

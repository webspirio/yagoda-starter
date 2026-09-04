import { createBrowserRouter, type RouteObject } from 'react-router';
import { AppLayout } from './layouts/AppLayout';
import { RouteError } from './providers/RouteError';
import { RequireAuth } from '@/features/auth';
import { LoginPage } from '@/pages/login';
import { DashboardPage } from '@/pages/dashboard';
import { ProfilePage } from '@/pages/profile';
import { NotFoundPage } from '@/pages/not-found';

/**
 * `routes` is exported separately from `router` so tests can drive the same
 * tree through `createMemoryRouter`.
 *
 * `/login` is the only public route. Everything else is wrapped in
 * RequireAuth individually rather than guarding the layout, so the layout can
 * render the auth screens bare (see AppLayout's CHROMELESS list).
 */
export const routes: RouteObject[] = [
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

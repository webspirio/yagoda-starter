import type { ReactNode } from 'react';
import { act, render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation, type DataRouter } from 'react-router';

/**
 * Test-only: mounts `children` at `entry` inside a real data router, and hands
 * back the live location plus the router (for `historyAction` assertions).
 * A real router, not a stub — the replace-vs-push guarantee this module rests
 * on is only observable on one.
 */
export function renderAt(entry: string, children: ReactNode) {
  const seen = { search: '' };
  function Probe() {
    seen.search = useLocation().search;
    return <>{children}</>;
  }
  const router: DataRouter = createMemoryRouter([{ path: '*', element: <Probe /> }], {
    initialEntries: [entry],
  });
  const view = render(<RouterProvider router={router} />);
  return {
    seen,
    router,
    click: (label: string) => act(() => view.getByText(label).click()),
  };
}

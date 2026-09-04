import { describe, it, expect } from 'vitest';
import { act, render, renderHook } from '@testing-library/react';
import {
  createMemoryRouter,
  RouterProvider,
  useLocation,
  type DataRouter,
} from 'react-router';
import type { ReactNode } from 'react';
import { useUrlParam } from './useUrlParam';

function wrapperAt(entry: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const router = createMemoryRouter([{ path: '*', element: <>{children}</> }], {
      initialEntries: [entry],
    });
    return <RouterProvider router={router} />;
  };
}

describe('useUrlParam', () => {
  it('is null when the param is absent', () => {
    const { result } = renderHook(() => useUrlParam('tab'), { wrapper: wrapperAt('/e/1') });
    expect(result.current[0]).toBeNull();
  });

  it('reads the value already in the query string', () => {
    const { result } = renderHook(() => useUrlParam('tab'), {
      wrapper: wrapperAt('/e/1?tab=payments'),
    });
    expect(result.current[0]).toBe('payments');
  });

  it('round-trips a written value', () => {
    const { result } = renderHook(() => useUrlParam('tab'), { wrapper: wrapperAt('/e/1') });
    act(() => result.current[1]('roster'));
    expect(result.current[0]).toBe('roster');
  });

  it('removes the param entirely when set to null', () => {
    let search = '';
    function Probe() {
      const [, setTab] = useUrlParam('tab');
      search = useLocation().search;
      return <button onClick={() => setTab(null)}>clear</button>;
    }
    const router = createMemoryRouter([{ path: '*', element: <Probe /> }], {
      initialEntries: ['/e/1?tab=payments'],
    });
    const { getByText } = render(<RouterProvider router={router} />);
    act(() => getByText('clear').click());
    expect(search).toBe('');
  });

  it('leaves other query params untouched', () => {
    let search = '';
    function Probe() {
      const [, setTab] = useUrlParam('tab');
      search = useLocation().search;
      return <button onClick={() => setTab('roster')}>set</button>;
    }
    const router = createMemoryRouter([{ path: '*', element: <Probe /> }], {
      initialEntries: ['/e/1?attendees=1'],
    });
    const { getByText } = render(<RouterProvider router={router} />);
    act(() => getByText('set').click());
    expect(new URLSearchParams(search).get('attendees')).toBe('1');
    expect(new URLSearchParams(search).get('tab')).toBe('roster');
  });

  /*
   * The load-bearing one. A write REPLACES the current history entry rather
   * than pushing a new one: that is what lets the URL mirror UI state without
   * growing the history (an open/close pair would otherwise leave a dead entry
   * that swallows one back press), while still restoring on a pop — a replaced
   * entry keeps its rewritten URL when navigation returns to it.
   */
  it('replaces the current history entry instead of pushing', () => {
    function Probe() {
      const [, setTab] = useUrlParam('tab');
      return <button onClick={() => setTab('roster')}>set</button>;
    }
    const router: DataRouter = createMemoryRouter([{ path: '*', element: <Probe /> }], {
      initialEntries: ['/e/1'],
    });
    const { getByText } = render(<RouterProvider router={router} />);
    act(() => getByText('set').click());
    expect(router.state.historyAction).toBe('REPLACE');
  });
});

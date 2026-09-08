import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, Outlet } from 'react-router';
import type { ReactNode } from 'react';
import { usePointScope } from './usePointScope';

const { meMock } = vi.hoisted(() => ({ meMock: vi.fn() }));
vi.mock('../api/useMeQuery', () => ({ useMeQuery: () => meMock() }));

function wrapperAt(entry: string) {
  return ({ children }: { children: ReactNode }) => {
    const router = createMemoryRouter(
      [
        {
          path: '/x',
          element: (
            <>
              {children}
              <Outlet />
            </>
          ),
        },
      ],
      {
        initialEntries: [entry],
      },
    );
    return <RouterProvider router={router} />;
  };
}

beforeEach(() => meMock.mockReset());

describe('usePointScope', () => {
  it('binds an operator to their own point and offers no picker', () => {
    meMock.mockReturnValue({
      data: { role: 'point_operator', collection_point_id: 'p1' },
      isPending: false,
    });
    const { result } = renderHook(() => usePointScope(), { wrapper: wrapperAt('/x?point=p9') });
    expect(result.current).toMatchObject({ pointId: 'p1', canPick: false });
  });

  it('lets an owner pick a point through ?point= and starts unpicked', () => {
    meMock.mockReturnValue({
      data: { role: 'network_owner', collection_point_id: null },
      isPending: false,
    });
    const { result } = renderHook(() => usePointScope(), { wrapper: wrapperAt('/x') });
    expect(result.current).toMatchObject({ pointId: null, canPick: true });
    // A real pointId is UUID-shaped on the wire — `keepUuids` would drop
    // anything else, so the round trip has to use one here too.
    act(() => result.current.setPointId('3fa85f64-5717-4562-b3fc-2c963f66afa6'));
    expect(result.current.pointId).toBe('3fa85f64-5717-4562-b3fc-2c963f66afa6');
  });

  it('drops a mangled ?point= instead of forwarding it to the API', () => {
    meMock.mockReturnValue({
      data: { role: 'network_owner', collection_point_id: null },
      isPending: false,
    });
    const { result } = renderHook(() => usePointScope(), {
      wrapper: wrapperAt('/x?point=not-a-uuid'),
    });
    expect(result.current.pointId).toBeNull();
  });
});

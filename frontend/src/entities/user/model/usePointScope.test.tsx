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
          // A SPLAT, so a test can render at a DIFFERENT path — which is the
          // whole point of the persistence cases: every screen has its own URL.
          path: '*',
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

const A = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const B = '11111111-1111-4111-8111-111111111111';

const asOwner = () =>
  meMock.mockReturnValue({
    data: { role: 'network_owner', collection_point_id: null },
    isPending: false,
  });

beforeEach(() => {
  meMock.mockReset();
  localStorage.clear();
});

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

/**
 * The owner used to re-pick the same point on every screen, because each screen
 * has its own URL and therefore its own empty `?point=`.
 */
describe('usePointScope — remembering the pick', () => {
  it('remembers a picked point for the next screen', () => {
    asOwner();
    const first = renderHook(() => usePointScope(), { wrapper: wrapperAt('/x') });
    act(() => first.result.current.setPointId(A));

    // A different screen: its own URL, no `?point=` on it at all.
    const next = renderHook(() => usePointScope(), { wrapper: wrapperAt('/y') });
    expect(next.result.current.pointId).toBe(A);
  });

  /** A pasted link must decide, or it stops being shareable. */
  it('lets ?point= win over what was remembered', () => {
    asOwner();
    const first = renderHook(() => usePointScope(), { wrapper: wrapperAt('/x') });
    act(() => first.result.current.setPointId(A));

    const next = renderHook(() => usePointScope(), { wrapper: wrapperAt(`/y?point=${B}`) });
    expect(next.result.current.pointId).toBe(B);
  });

  it('forgets the point when the owner clears the pick', () => {
    asOwner();
    const { result } = renderHook(() => usePointScope(), { wrapper: wrapperAt('/x') });
    act(() => result.current.setPointId(A));
    act(() => result.current.setPointId(null));

    const next = renderHook(() => usePointScope(), { wrapper: wrapperAt('/y') });
    expect(next.result.current.pointId).toBeNull();
  });

  /**
   * A remembered id from a SHARED BROWSER must never decide what an operator's
   * money screen shows — the server pins them, and so does this.
   */
  it('never lets a remembered point reach an operator', () => {
    asOwner();
    const owner = renderHook(() => usePointScope(), { wrapper: wrapperAt('/x') });
    act(() => owner.result.current.setPointId(A));

    meMock.mockReturnValue({
      data: { role: 'point_operator', collection_point_id: 'p1' },
      isPending: false,
    });
    const operator = renderHook(() => usePointScope(), { wrapper: wrapperAt('/y') });
    expect(operator.result.current.pointId).toBe('p1');
  });

  it('does not remember anything an operator does', () => {
    meMock.mockReturnValue({
      data: { role: 'point_operator', collection_point_id: 'p1' },
      isPending: false,
    });
    const { result } = renderHook(() => usePointScope(), { wrapper: wrapperAt('/x') });
    act(() => result.current.setPointId(A));

    expect(localStorage.getItem('web-starter:point')).toBeNull();
  });

  it('ignores a remembered value that is not a uuid', () => {
    asOwner();
    localStorage.setItem('web-starter:point', 'garbage');
    const { result } = renderHook(() => usePointScope(), { wrapper: wrapperAt('/x') });
    expect(result.current.pointId).toBeNull();
  });
});

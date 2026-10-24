import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import type { ReactNode } from 'react';
import { getStoredCostSplit, storeCostSplit } from '@/shared/lib/split-preference';
import { useCostSplit } from './useCostSplit';

function wrapperAt(entry: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const router = createMemoryRouter([{ path: '*', element: <>{children}</> }], {
      initialEntries: [entry],
    });
    return <RouterProvider router={router} />;
  };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Spec 2026-10-24 §3.1 — URL first, then the remembered choice, then `weight`. */
describe('useCostSplit', () => {
  it('reads a valid ?split=', () => {
    const { result } = renderHook(() => useCostSplit(), { wrapper: wrapperAt('/c?split=value') });
    expect(result.current[0]).toBe('value');
  });

  it('falls back to the remembered choice when the URL value is unknown', () => {
    storeCostSplit('own');
    const { result } = renderHook(() => useCostSplit(), { wrapper: wrapperAt('/c?split=bogus') });
    expect(result.current[0]).toBe('own');
  });

  it('is weight with nothing in the URL and nothing remembered', () => {
    const { result } = renderHook(() => useCostSplit(), { wrapper: wrapperAt('/c') });
    expect(result.current[0]).toBe('weight');
  });

  it('ignores a corrupt remembered value', () => {
    storeCostSplit('garbage');
    const { result } = renderHook(() => useCostSplit(), { wrapper: wrapperAt('/c') });
    expect(result.current[0]).toBe('weight');
  });

  it('is weight when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result } = renderHook(() => useCostSplit(), { wrapper: wrapperAt('/c') });
    expect(result.current[0]).toBe('weight');
  });

  it('writes both the URL and the remembered choice', () => {
    const { result } = renderHook(() => ({ split: useCostSplit(), search: useLocation().search }), {
      wrapper: wrapperAt('/c?date=2026-10-19'),
    });
    act(() => result.current.split[1]('own'));
    expect(result.current.split[0]).toBe('own');
    const params = new URLSearchParams(result.current.search);
    expect(params.get('split')).toBe('own');
    expect(params.get('date')).toBe('2026-10-19');
    expect(getStoredCostSplit()).toBe('own');
  });
});

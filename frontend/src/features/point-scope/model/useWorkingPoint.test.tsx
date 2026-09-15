import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useWorkingPoint } from './useWorkingPoint';

const { scopeMock, pointsMock } = vi.hoisted(() => ({
  scopeMock: vi.fn(),
  pointsMock: vi.fn(),
}));

vi.mock('@/entities/user', () => ({ usePointScope: () => scopeMock() }));
vi.mock('@/entities/collection-point', () => ({
  usePointOptionsQuery: () => pointsMock(),
}));

const SHYPYNKY = { id: 'p1', name: 'Шипинки', kind: 'reception' as const };
const HAIOVE = { id: 'p2', name: 'Гайове', kind: 'reception' as const };
const WAREHOUSE = { id: 'w1', name: 'Склад', kind: 'base' as const };

const owner = (over: Record<string, unknown> = {}) => ({
  pointId: null,
  canPick: true,
  setPointId: vi.fn(),
  isLoading: false,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  scopeMock.mockReturnValue(owner());
  pointsMock.mockReturnValue({
    data: [SHYPYNKY, HAIOVE, WAREHOUSE],
    isPending: false,
    isError: false,
  });
});

describe('useWorkingPoint', () => {
  /**
   * The first-visit answer. The warehouse is the owner's own place and the one
   * point they are always concerned with.
   */
  it('falls back to the WAREHOUSE when nothing is chosen or remembered', () => {
    const { result } = renderHook(() => useWorkingPoint());
    expect(result.current.pointId).toBe('w1');
  });

  it('never overrides an explicit choice', () => {
    scopeMock.mockReturnValue(owner({ pointId: 'p2' }));
    const { result } = renderHook(() => useWorkingPoint());
    expect(result.current.pointId).toBe('p2');
  });

  it('falls back to any active point when the network has no warehouse', () => {
    pointsMock.mockReturnValue({
      data: [SHYPYNKY, HAIOVE],
      isPending: false,
      isError: false,
    });
    const { result } = renderHook(() => useWorkingPoint());
    expect(result.current.pointId).toBe('p1');
  });

  it('has nothing to fall back to when there are no points at all', () => {
    pointsMock.mockReturnValue({ data: [], isPending: false, isError: false });
    const { result } = renderHook(() => useWorkingPoint());
    expect(result.current.pointId).toBeNull();
  });

  /**
   * A screen reading `pointId === null` as «nothing chosen» would flash an
   * empty state and then fill in, which reads as a bug.
   */
  it('stays loading until the points have arrived', () => {
    pointsMock.mockReturnValue({ data: undefined, isPending: true, isError: false });
    const { result } = renderHook(() => useWorkingPoint());
    expect(result.current.isLoading).toBe(true);
  });

  /**
   * An operator is pinned by their token. Nothing about warehouses, memory or
   * fallbacks may move them.
   */
  it('passes an operator through untouched', () => {
    const operator = { pointId: 'p1', canPick: false, setPointId: vi.fn(), isLoading: false };
    scopeMock.mockReturnValue(operator);

    const { result } = renderHook(() => useWorkingPoint());

    expect(result.current).toBe(operator);
  });

  it('leaves an operator alone even when their point is somehow empty', () => {
    scopeMock.mockReturnValue({
      pointId: null,
      canPick: false,
      setPointId: vi.fn(),
      isLoading: false,
    });
    const { result } = renderHook(() => useWorkingPoint());
    // NOT the warehouse: an operator with no point is a server-side problem,
    // and quietly showing them someone else's point would hide it.
    expect(result.current.pointId).toBeNull();
  });

  it('keeps the setter the entity hook provided, so a pick is still recorded', () => {
    const setPointId = vi.fn();
    scopeMock.mockReturnValue(owner({ setPointId }));
    const { result } = renderHook(() => useWorkingPoint());
    expect(result.current.setPointId).toBe(setPointId);
  });
});

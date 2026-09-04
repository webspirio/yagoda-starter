import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useEntranceOnce } from './motion';

describe('useEntranceOnce', () => {
  it("returns 'hidden' on a key's first mount, false thereafter", () => {
    const first = renderHook(() => useEntranceOnce('once-key-a'));
    expect(first.result.current).toBe('hidden');
    first.unmount();

    const second = renderHook(() => useEntranceOnce('once-key-a'));
    expect(second.result.current).toBe(false);
  });

  it('tracks keys independently', () => {
    renderHook(() => useEntranceOnce('once-key-b'));
    const other = renderHook(() => useEntranceOnce('once-key-c'));
    expect(other.result.current).toBe('hidden');
  });
});

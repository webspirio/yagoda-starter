import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useForm } from 'react-hook-form';

const ds = vi.hoisted(() => ({
  loadLocal: vi.fn<(k: string) => string | null>(() => null),
  writeLocal: vi.fn(),
  removeLocal: vi.fn(),
}));
vi.mock('./draftStorage', () => ds);

import { useFormDraft, type UseFormDraftOptions } from './useFormDraft';

type V = { name: string };
const env = (o: object) => JSON.stringify(o);

beforeEach(() => {
  vi.clearAllMocks();
  ds.loadLocal.mockReturnValue(null);
});

function harness(opts?: Partial<UseFormDraftOptions<V, { b?: number }>>) {
  return renderHook(() => {
    const methods = useForm<V>({ defaultValues: { name: '' } });
    const draft = useFormDraft<V, { b?: number }>({
      methods,
      storageKey: 'k',
      version: 1,
      ...opts,
    });
    return { methods, draft };
  });
}

describe('useFormDraft — restore', () => {
  it('restores values from localStorage on mount', () => {
    ds.loadLocal.mockReturnValue(env({ v: 1, updatedAt: 5, values: { name: 'Ada' } }));
    const { result } = harness();
    expect(result.current.methods.getValues('name')).toBe('Ada');
  });

  it('discards a version mismatch', () => {
    ds.loadLocal.mockReturnValue(env({ v: 2, updatedAt: 5, values: { name: 'Ada' } }));
    const { result } = harness();
    expect(result.current.methods.getValues('name')).toBe('');
  });

  it('discards when isStale returns true, and sweeps the invalid stored copy', () => {
    ds.loadLocal.mockReturnValue(env({ v: 1, updatedAt: 5, values: { name: 'Ada' }, meta: { b: 1 } }));
    const { result } = harness({ isStale: () => true });
    expect(result.current.methods.getValues('name')).toBe('');
    expect(ds.removeLocal).toHaveBeenCalledWith('k');
  });

  it('discards a draft older than maxAgeMs', () => {
    ds.loadLocal.mockReturnValue(env({ v: 1, updatedAt: 1000, values: { name: 'Ada' } }));
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1000 + 60_000);
    const { result } = harness({ maxAgeMs: 10_000 });
    expect(result.current.methods.getValues('name')).toBe('');
    nowSpy.mockRestore();
  });

  it('calls onRestore with the restored meta', () => {
    ds.loadLocal.mockReturnValue(env({ v: 1, updatedAt: 5, values: { name: 'Ada' }, meta: { b: 7 } }));
    const onRestore = vi.fn();
    harness({ onRestore });
    expect(onRestore).toHaveBeenCalledWith({ b: 7 });
  });
});

describe('useFormDraft — persistence', () => {
  it('does not persist the restore echo (unchanged payload)', async () => {
    vi.useFakeTimers();
    ds.loadLocal.mockReturnValue(env({ v: 1, updatedAt: 5, values: { name: 'Ada' } }));
    harness();
    await vi.advanceTimersByTimeAsync(500);
    expect(ds.writeLocal).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('persists a real field change (debounced)', async () => {
    vi.useFakeTimers();
    const { result } = harness();
    act(() => result.current.methods.setValue('name', 'New', { shouldDirty: true }));
    await vi.advanceTimersByTimeAsync(500);
    expect(ds.writeLocal).toHaveBeenCalledWith('k', expect.stringContaining('New'));
    vi.useRealTimers();
  });

  it('clearDraft cancels pending saves and removes the key', () => {
    const { result } = harness();
    act(() => result.current.draft.clearDraft());
    expect(ds.removeLocal).toHaveBeenCalledWith('k');
  });
});

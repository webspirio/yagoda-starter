import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  QueryClientProvider,
  focusManager,
  useMutation,
  useQuery,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createQueryClient } from './cachePolicy';
import { queryClient } from './queryClient';
import { queryKeys } from './queryKeys';

const HOUR = 60 * 60_000;

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function mount(client: QueryClient, queryKey: QueryKey, queryFn: () => Promise<string>) {
  return renderHook(() => useQuery({ queryKey, queryFn }), { wrapper: wrapperFor(client) });
}

afterEach(() => focusManager.setFocused(undefined));

describe('createQueryClient — nothing is cached unless its key is allowlisted', () => {
  it.each([
    ['intakes', [...queryKeys.intakes, { shiftId: 's1' }]],
    ['point-cash', [...queryKeys.pointCash, 'one', 'p1', null]],
    // Near misses: look like catalog keys, are not on the list.
    ['grade-prices', [...queryKeys.gradePrices, 'p1']],
    ['collection-points', [...queryKeys.collectionPoints, 'options']],
  ])('%s: refetches on every mount and is dropped once unmounted', async (_label, key) => {
    const client = createQueryClient();
    const fn = vi.fn(async () => 'rows');

    const first = mount(client, key, fn);
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();
    await waitFor(() => expect(client.getQueryCache().find({ queryKey: key })).toBeUndefined());

    const second = mount(client, key, fn);
    // No previous visit's figure on screen while the fresh one loads.
    expect(second.result.current.data).toBeUndefined();
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['me', queryKeys.me],
    ['tare-types (leaf)', [...queryKeys.tareTypes, 'options']],
    ['products', queryKeys.products],
    ['product-grades (leaf)', [...queryKeys.productGrades(), 'active']],
    ['product-grades (per product)', queryKeys.productGrades('prod-1')],
  ])('%s: is served from cache on remount inside its window', async (_label, key) => {
    const client = createQueryClient();
    const fn = vi.fn(async () => 'value');

    const first = mount(client, key, fn);
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();

    const second = mount(client, key, fn);
    expect(second.result.current.data).toBe('value');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('refetches a key off the allowlist when the window regains focus', async () => {
    const client = createQueryClient();
    const key = [...queryKeys.pointCash, 'one', 'p1', null];
    const fn = vi.fn(async () => '100.00');

    const view = mount(client, key, fn);
    await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
  });

  it('does not refetch an allowlisted key on focus inside its window', async () => {
    const client = createQueryClient();
    const key = [...queryKeys.tareTypes, 'options'];
    const fn = vi.fn(async () => 'tares');

    const view = mount(client, key, fn);
    await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('keeps a key alive while another screen still reads it', async () => {
    const client = createQueryClient();
    const key = [...queryKeys.pointCash, 'one', 'p1', null];
    const fn = vi.fn(async () => '100.00');

    const form = mount(client, key, fn);
    const panel = mount(client, key, fn);
    await waitFor(() => expect(panel.result.current.isSuccess).toBe(true));
    form.unmount();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(client.getQueryCache().find({ queryKey: key })).toBeDefined();
    expect(panel.result.current.data).toBe('100.00');
  });

  it("forgets a settled mutation's data once nothing observes it", async () => {
    const client = createQueryClient();
    const view = renderHook(() => useMutation({ mutationFn: async () => 'plaintext' }), {
      wrapper: wrapperFor(client),
    });
    await act(() => view.result.current.mutateAsync());
    view.unmount();
    await waitFor(() => expect(client.getMutationCache().getAll()).toHaveLength(0));
  });
});

describe('queryClient', () => {
  it('is the app client, built by the policy', () => {
    expect(queryClient.getDefaultOptions().queries?.gcTime).toBe(0);
    expect(queryClient.getDefaultOptions().queries?.staleTime).toBe(0);
    // The persister needs gcTime >= its 24h maxAge for the one key it keeps.
    expect(queryClient.getQueryDefaults(queryKeys.me).gcTime).toBe(24 * HOUR);
  });
});

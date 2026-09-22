import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ReactNode } from 'react';
import { httpClient, attachAuthInterceptors } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { useAddReweighItemMutation, useVoidReweighItemMutation } from './useReweighMutations';

attachAuthInterceptors(httpClient, { getToken: () => null, onUnauthorized: () => {} });

let mock: MockAdapter;
let queryClient: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

beforeEach(() => {
  mock = new MockAdapter(httpClient);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => mock.restore());

describe('useAddReweighItemMutation', () => {
  it('posts one line to its shift and invalidates the reweigh reads', async () => {
    mock.onPost('/shifts/s1/reweigh-items').reply(200, { id: 'ri1' });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useAddReweighItemMutation(), { wrapper });

    await result.current.mutateAsync({
      shiftId: 's1',
      product_grade_id: 'g1',
      gross_kg: '120.50',
      pallet_kg: '20.00',
      tare: [{ tare_type_id: 't1', units: 10 }],
    });

    // Assert the RECORDED request body, not merely that a post happened —
    // axios-mock-adapter records every request into `mock.history` before
    // handler matching, so a length check alone proves nothing was sent
    // correctly.
    expect(mock.history.post).toHaveLength(1);
    expect(mock.history.post[0].url).toBe('/shifts/s1/reweigh-items');
    expect(JSON.parse(mock.history.post[0].data as string)).toEqual({
      product_grade_id: 'g1',
      gross_kg: '120.50',
      pallet_kg: '20.00',
      tare: [{ tare_type_id: 't1', units: 10 }],
    });
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.reweighs });
    });
  });

  it('omits an absent pallet rather than sending a zero string', async () => {
    mock.onPost('/shifts/s1/reweigh-items').reply(200, { id: 'ri1' });
    const { result } = renderHook(() => useAddReweighItemMutation(), { wrapper });

    await result.current.mutateAsync({
      shiftId: 's1',
      product_grade_id: 'g1',
      gross_kg: '10.00',
      tare: [],
    });

    expect(mock.history.post).toHaveLength(1);
    const body = JSON.parse(mock.history.post[0].data as string) as Record<string, unknown>;
    expect(body).toEqual({ product_grade_id: 'g1', gross_kg: '10.00', tare: [] });
    expect(body).not.toHaveProperty('pallet_kg');
  });
});

describe('useVoidReweighItemMutation', () => {
  it('voids by LINE id with the reason and invalidates', async () => {
    mock.onPost('/reweigh-items/ri1/void').reply(200, { id: 'ri1' });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useVoidReweighItemMutation(), { wrapper });

    await result.current.mutateAsync({ id: 'ri1', reason: 'двічі ввели ту саму машину' });

    expect(mock.history.post).toHaveLength(1);
    expect(mock.history.post[0].url).toBe('/reweigh-items/ri1/void');
    expect(JSON.parse(mock.history.post[0].data as string)).toEqual({
      reason: 'двічі ввели ту саму машину',
    });
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.reweighs });
    });
  });
});

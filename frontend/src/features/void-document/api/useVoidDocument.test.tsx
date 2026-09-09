import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ReactNode } from 'react';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { useVoidDocumentMutation } from './useVoidDocument';

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

describe('useVoidDocumentMutation', () => {
  it('posts to /intakes/:id/void for an intake', async () => {
    mock.onPost('/intakes/i1/void').reply(200);
    const { result } = renderHook(() => useVoidDocumentMutation(), { wrapper });

    await result.current.mutateAsync({ kind: 'intake', id: 'i1', reason: 'mistake' });

    expect(mock.history.post).toHaveLength(1);
    expect(mock.history.post[0].url).toBe('/intakes/i1/void');
    expect(JSON.parse(mock.history.post[0].data as string)).toEqual({ reason: 'mistake' });
  });

  it('posts to /payouts/:id/void for a payout', async () => {
    mock.onPost('/payouts/p1/void').reply(200);
    const { result } = renderHook(() => useVoidDocumentMutation(), { wrapper });

    await result.current.mutateAsync({ kind: 'payout', id: 'p1', reason: 'wrong amount' });

    expect(mock.history.post).toHaveLength(1);
    expect(mock.history.post[0].url).toBe('/payouts/p1/void');
    expect(JSON.parse(mock.history.post[0].data as string)).toEqual({ reason: 'wrong amount' });
  });

  it('invalidates intakes, payouts and supplierBalances together on success', async () => {
    mock.onPost('/intakes/i1/void').reply(200);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useVoidDocumentMutation(), { wrapper });

    await result.current.mutateAsync({ kind: 'intake', id: 'i1', reason: 'mistake' });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.intakes });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.payouts });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.supplierBalances });
    });
  });
});

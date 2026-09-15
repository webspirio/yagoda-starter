import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ReactNode } from 'react';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { useResolveTransferMutation } from './useResolveTransfer';

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

describe('useResolveTransferMutation', () => {
  it('posts the resolved figures and invalidates transfers AND point cash together', async () => {
    mock.onPost('/transfers/t1/resolve').reply(200, { id: 't1', status: 'disputed' });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useResolveTransferMutation(), { wrapper });

    await result.current.mutateAsync({ id: 't1', resolved_cash: '49500.00', resolved_crates: 118 });

    expect(mock.history.post).toHaveLength(1);
    expect(mock.history.post[0].url).toBe('/transfers/t1/resolve');
    expect(JSON.parse(mock.history.post[0].data as string)).toEqual({
      resolved_cash: '49500.00',
      resolved_crates: 118,
    });
    // §7.9 (ред. 09.09.2026) — `resolved_cash` feeds PointCashService's
    // formula the moment `resolved_at` is set, so a resolved dispute must
    // invalidate the point's cash figure, not just the document itself.
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.transfers });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.pointCash });
    });
  });
});

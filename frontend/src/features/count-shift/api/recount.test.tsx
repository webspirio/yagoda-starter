import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ReactNode } from 'react';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { useRecountMutation } from './recount';

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

describe('useRecountMutation', () => {
  it("posts the berry book and the counted amount — crates aren't counted (§4.3)", async () => {
    mock.onPost('/cash-counts').reply(201, { id: 'c1' });
    const { result } = renderHook(() => useRecountMutation(), { wrapper });
    await result.current.mutateAsync({ counted_amount: '1500.00' });
    await waitFor(() => expect(mock.history.post).toHaveLength(1));
    expect(mock.history.post[0].url).toBe('/cash-counts');
    expect(JSON.parse(mock.history.post[0].data)).toEqual({
      book: 'berry',
      counted_amount: '1500.00',
    });
  });

  it('invalidates cashCounts and pointCash — the panel reads both back after a recount', async () => {
    mock.onPost('/cash-counts').reply(201, { id: 'c1' });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useRecountMutation(), { wrapper });

    await result.current.mutateAsync({ counted_amount: '1500.00' });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.cashCounts });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.pointCash });
    });
  });
});

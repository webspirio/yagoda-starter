import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ReactNode } from 'react';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { usePayoutsQuery, payoutsQueryOptions } from './usePayouts';

let mock: MockAdapter;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

beforeEach(() => {
  mock = new MockAdapter(httpClient);
});
afterEach(() => mock.restore());

describe('usePayoutsQuery', () => {
  it('does not fire with no shift, supplier or point set', () => {
    const { result } = renderHook(() => usePayoutsQuery({}), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('fetches headers for a shift, mapping the filter to snake_case params', async () => {
    const envelope = { data: [{ id: 'p1' }], total: 1, page: 1, limit: 100 };
    mock
      .onGet('/payouts', { params: { shift_id: 's1', include_voided: true, limit: 100 } })
      .reply(200, envelope);
    const { result } = renderHook(() => usePayoutsQuery({ shiftId: 's1' }), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(envelope));
  });

  it('sends a date range and page, and is enabled by a range alone', async () => {
    mock
      .onGet('/payouts', {
        params: { from: '2026-09-01', to: '2026-09-30', page: 2, include_voided: true, limit: 100 },
      })
      .reply(200, { data: [], total: 0, page: 2, limit: 100 });
    const { result } = renderHook(
      () => usePayoutsQuery({ from: '2026-09-01', to: '2026-09-30', page: 2 }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data?.page).toBe(2));
  });
});

describe('payoutsQueryOptions', () => {
  it('has the same queryKey the hook registers for the same filter', () => {
    const filter = {};
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const localWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    renderHook(() => usePayoutsQuery(filter), { wrapper: localWrapper });
    const [query] = queryClient.getQueryCache().getAll();
    expect(query?.queryKey).toEqual(payoutsQueryOptions(filter).queryKey);
    expect(payoutsQueryOptions(filter).queryKey).toEqual([...queryKeys.payouts, filter]);
  });
});

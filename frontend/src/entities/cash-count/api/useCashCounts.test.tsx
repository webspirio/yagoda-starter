import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ReactNode } from 'react';
import { httpClient, attachAuthInterceptors } from '@/shared/api';
import { useCashCountsQuery } from './useCashCounts';

attachAuthInterceptors(httpClient, { getToken: () => null, onUnauthorized: () => {} });

let mock: MockAdapter;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);
const page = { data: [], total: 0, page: 1, limit: 100 };

beforeEach(() => {
  mock = new MockAdapter(httpClient);
});
afterEach(() => mock.restore());

describe('useCashCountsQuery', () => {
  it('maps onlyDiscrepancies onto only_discrepancies', async () => {
    mock.onGet('/cash-counts').reply(200, page);
    renderHook(() => useCashCountsQuery({ pointId: 'p1', onlyDiscrepancies: true }), { wrapper });
    await waitFor(() => expect(mock.history.get).toHaveLength(1));
    expect(mock.history.get[0].params).toMatchObject({
      collection_point_id: 'p1',
      only_discrepancies: true,
    });
  });

  // Review round 2, minor finding — a caller with no point, shift or date
  // range must not fire `GET /cash-counts` for the whole network.
  it('does not fire with no point, shift or date range at all', () => {
    mock.onGet('/cash-counts').reply(200, page);
    const { result } = renderHook(() => useCashCountsQuery({}), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mock.history.get).toHaveLength(0);
  });

  it('fires for a from/to range with no point or shift', async () => {
    mock.onGet('/cash-counts').reply(200, page);
    renderHook(
      () => useCashCountsQuery({ from: '2026-09-01', to: '2026-09-10' }),
      { wrapper },
    );
    await waitFor(() => expect(mock.history.get).toHaveLength(1));
  });
});

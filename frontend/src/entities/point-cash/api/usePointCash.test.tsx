import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ReactNode } from 'react';
import { httpClient, attachAuthInterceptors } from '@/shared/api';
import { usePointCashQuery, usePointCashForPointQuery } from './usePointCash';

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

describe('usePointCashQuery', () => {
  it('reads the network list and passes as_of through', async () => {
    mock.onGet('/point-cash', { params: { as_of: '2026-09-10', limit: 100 } }).reply(200, page);
    const { result } = renderHook(() => usePointCashQuery({ asOf: '2026-09-10' }), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(page));
  });

  it('scopes the read to one point — the whole network is not fetched to find one row', async () => {
    mock
      .onGet('/point-cash', {
        params: { as_of: '2026-09-10', collection_point_id: 'p1', limit: 100 },
      })
      .reply(200, page);
    const { result } = renderHook(
      () => usePointCashQuery({ asOf: '2026-09-10', pointId: 'p1' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data).toEqual(page));
  });

  it('does not fire when the caller opts out', () => {
    mock.onGet('/point-cash').reply(200, page);
    const { result } = renderHook(
      () => usePointCashQuery({ asOf: '2026-09-10', pointId: 'p1', enabled: false }),
      { wrapper },
    );
    expect(result.current.fetchStatus).toBe('idle');
    expect(mock.history.get).toHaveLength(0);
  });
});

describe('usePointCashForPointQuery', () => {
  it('reads one point and does not fire without one', async () => {
    const idle = renderHook(() => usePointCashForPointQuery(null), { wrapper });
    expect(idle.result.current.fetchStatus).toBe('idle');

    mock.onGet('/point-cash/p1').reply(200, { collection_point_id: 'p1', cash: '0.00' });
    const { result } = renderHook(() => usePointCashForPointQuery('p1'), { wrapper });
    await waitFor(() => expect(result.current.data?.cash).toBe('0.00'));
  });
});

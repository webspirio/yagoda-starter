import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ReactNode } from 'react';
import { httpClient, attachAuthInterceptors } from '@/shared/api';
import { useCurrentShiftQuery, useShiftOnDateQuery } from './useShifts';

// Without this, a mocked 404 surfaces as a plain AxiosError rather than the
// ApiError the 404-as-null branch in useCurrentShiftQuery checks for — see
// client.test.ts's own attachAuthInterceptors tests. Attached once at module
// scope (not per test) so it is never stacked on the shared httpClient
// singleton; a bare hooks stub is enough since no test here exercises auth.
attachAuthInterceptors(httpClient, { getToken: () => null, onUnauthorized: () => {} });

let mock: MockAdapter;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);
const shift = {
  id: 's1',
  collection_point_id: 'p1',
  business_date: '2026-09-08',
  status: 'open',
  opened_by_user_id: 'u1',
  closed_by_user_id: null,
  closed_at: null,
  created_at: '2026-09-08T04:30:00Z',
};

beforeEach(() => {
  mock = new MockAdapter(httpClient);
});
afterEach(() => mock.restore());

describe('useCurrentShiftQuery', () => {
  it('reads the open shift for the point and treats 404 as "none"', async () => {
    mock.onGet('/shifts/current', { params: { collection_point_id: 'p1' } }).reply(200, shift);
    const { result } = renderHook(() => useCurrentShiftQuery('p1'), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(shift));

    mock
      .onGet('/shifts/current', { params: { collection_point_id: 'p2' } })
      .reply(404, { message: 'No open shift' });
    const none = renderHook(() => useCurrentShiftQuery('p2'), { wrapper });
    await waitFor(() => expect(none.result.current.data).toBeNull());
  });
  it('does not fire without a point', () => {
    const { result } = renderHook(() => useCurrentShiftQuery(null), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useShiftOnDateQuery', () => {
  it('asks for the one shift on that date and returns it or null', async () => {
    mock
      .onGet('/shifts', {
        params: { collection_point_id: 'p1', from: '2026-09-07', to: '2026-09-07', limit: 1 },
      })
      .reply(200, {
        data: [{ ...shift, id: 's0', business_date: '2026-09-07', status: 'closed' }],
        total: 1,
        page: 1,
        limit: 1,
      });
    const { result } = renderHook(() => useShiftOnDateQuery('p1', '2026-09-07'), { wrapper });
    await waitFor(() => expect(result.current.data?.id).toBe('s0'));
  });
});

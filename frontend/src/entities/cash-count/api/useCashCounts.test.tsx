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
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ReactNode } from 'react';
import { httpClient, attachAuthInterceptors } from '@/shared/api';
import { useNetworkCostOfDayQuery } from './useNetworkCostOfDay';

attachAuthInterceptors(httpClient, { getToken: () => null, onUnauthorized: () => {} });

let mock: MockAdapter;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

const network = {
  date: '2026-10-22',
  points: [],
  provisional: false,
  accrued: '0.00',
  expenses_amount: '0.00',
  expenses_weighed: '0.00',
  reweighed_kg: '0.00',
  shortfall_amount: '0.00',
  top_ups_total: '0.00',
  weighed: null,
  price_cost_avg: null,
  unweighed: { intake_kg: '0.00', accrued: '0.00' },
  checks: null,
  products: [],
};

beforeEach(() => {
  mock = new MockAdapter(httpClient);
});
afterEach(() => mock.restore());

describe('useNetworkCostOfDayQuery', () => {
  it('reads every point’s собівартість for one date', async () => {
    mock.onGet('/reports/cost-of-day', { params: { date: '2026-10-22' } }).reply(200, network);

    const { result } = renderHook(() => useNetworkCostOfDayQuery('2026-10-22'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(network);
  });

  it('sends nothing while the page is about one point', () => {
    const { result } = renderHook(() => useNetworkCostOfDayQuery(null), { wrapper });

    expect(result.current.fetchStatus).toBe('idle');
    expect(mock.history.get).toHaveLength(0);
  });
});

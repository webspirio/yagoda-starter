import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ReactNode } from 'react';
import { httpClient } from '@/shared/api';
import { usePayoutQuery } from './usePayout';

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

describe('usePayoutQuery', () => {
  it('does not fire without an id', () => {
    const { result } = renderHook(() => usePayoutQuery(null), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('fetches GET /payouts/:id', async () => {
    const payout = { id: 'p1', balance_after: '-100.00', paid_by_number: 5, point_number: 3 };
    mock.onGet('/payouts/p1').reply(200, payout);
    const { result } = renderHook(() => usePayoutQuery('p1'), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(payout));
  });
});

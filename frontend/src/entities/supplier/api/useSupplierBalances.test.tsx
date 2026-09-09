import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ReactNode } from 'react';
import { httpClient, attachAuthInterceptors } from '@/shared/api';
import { useSupplierBalanceQuery, useSupplierBalancesQuery } from './useSupplierBalances';

// Attached once at module scope (not per test) so it is never stacked on the
// shared httpClient singleton — see useShifts.test.tsx for the same pattern.
attachAuthInterceptors(httpClient, { getToken: () => null, onUnauthorized: () => {} });

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

describe('useSupplierBalanceQuery', () => {
  it('reads the debt for one supplier', async () => {
    mock.onGet('/suppliers/s1/balance').reply(200, { supplier_id: 's1', debt: '10944.00' });
    const { result } = renderHook(() => useSupplierBalanceQuery('s1'), { wrapper });
    await waitFor(() => expect(result.current.data?.debt).toBe('10944.00'));
  });

  it('does not fire without an id', () => {
    const { result } = renderHook(() => useSupplierBalanceQuery(null), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useSupplierBalancesQuery', () => {
  it('lists the debts for a point, excluding zero balances by default', async () => {
    const row = {
      supplier_id: 's1',
      first_name: 'Ivan',
      last_name: 'Koval',
      is_active: true,
      collection_point_id: 'p1',
      debt: '10944.00',
    };
    mock
      .onGet('/supplier-balances', {
        params: { collection_point_id: 'p1', include_zero: false, limit: 100 },
      })
      .reply(200, { data: [row], total: 1, page: 1, limit: 100 });
    const { result } = renderHook(
      () => useSupplierBalancesQuery({ pointId: 'p1', includeZero: false }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data?.data).toEqual([row]));
  });
});

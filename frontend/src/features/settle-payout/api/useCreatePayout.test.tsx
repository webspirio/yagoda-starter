import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ReactNode } from 'react';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { useCreatePayoutMutation } from './useCreatePayout';

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

describe('useCreatePayoutMutation', () => {
  it('posts the payout and invalidates payouts, supplier balances AND point cash', async () => {
    mock.onPost('/payouts').reply(201, { id: 'pay1' });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCreatePayoutMutation(), { wrapper });

    await result.current.mutateAsync({ code: 'ВИП-001', supplier_id: 's1', amount: '300.00' });

    expect(mock.history.post).toHaveLength(1);
    expect(mock.history.post[0].url).toBe('/payouts');
    expect(JSON.parse(mock.history.post[0].data as string)).toEqual({
      code: 'ВИП-001',
      supplier_id: 's1',
      amount: '300.00',
    });
    // A payout is a term of the drawer formula: «Каса точки» must not keep
    // the pre-payout `cash` for `STALE.list` after the operator walks back.
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.payouts });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.supplierBalances });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.pointCash });
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ReactNode } from 'react';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { useCreateTopUpMutation } from './useCreateTopUp';

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

describe('useCreateTopUpMutation', () => {
  it('posts the top-up and invalidates top-ups, balances and intakes', async () => {
    mock.onPost('/intake-top-ups').reply(201, { id: 't1' });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCreateTopUpMutation(), { wrapper });

    await result.current.mutateAsync({ intake_id: 'i1', amount: '200.00', reason: 'ціна' });

    expect(mock.history.post[0].url).toBe('/intake-top-ups');
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.intakeTopUps });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.supplierBalances });
      // The parent receipt's open_amount now includes this top-up.
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.intakes });
    });
  });
});

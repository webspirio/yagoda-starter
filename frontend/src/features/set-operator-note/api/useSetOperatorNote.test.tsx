import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ReactNode } from 'react';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { useSetOperatorNoteMutation } from './useSetOperatorNote';

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

describe('useSetOperatorNoteMutation', () => {
  it('PUTs operator_note and refreshes shifts and cash counts', async () => {
    mock.onPut('/cash-counts/c1/operator-note').reply(200, { id: 'c1', operator_note: 'віддав решту' });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useSetOperatorNoteMutation(), { wrapper });

    await result.current.mutateAsync({ countId: 'c1', operatorNote: 'віддав решту' });

    expect(JSON.parse(mock.history.put[0].data as string)).toEqual({ operator_note: 'віддав решту' });
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.shifts });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.cashCounts });
    });
  });
});

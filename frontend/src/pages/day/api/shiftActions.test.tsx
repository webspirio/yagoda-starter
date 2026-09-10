import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ReactNode } from 'react';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { useReopenShiftMutation } from './shiftActions';

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

describe('useReopenShiftMutation', () => {
  it('posts the reason to the shift being reopened', async () => {
    mock.onPost('/shifts/s1/reopen').reply(200, { id: 's1' });
    const { result } = renderHook(() => useReopenShiftMutation(), { wrapper });
    await result.current.mutateAsync({ id: 's1', reason: 'wrong count' });
    await waitFor(() => expect(mock.history.post).toHaveLength(1));
    expect(mock.history.post[0].url).toBe('/shifts/s1/reopen');
    expect(JSON.parse(mock.history.post[0].data)).toEqual({ reason: 'wrong count' });
  });

  it('invalidates on success via the shared useInvalidateDay hook — its full list is covered by features/count-shift', async () => {
    mock.onPost('/shifts/s1/reopen').reply(200, { id: 's1' });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useReopenShiftMutation(), { wrapper });

    await result.current.mutateAsync({ id: 's1', reason: 'wrong count' });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.shifts });
    });
  });
});

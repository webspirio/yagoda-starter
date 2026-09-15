import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ReactNode } from 'react';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { useOpenShiftMutation, useCloseShiftMutation } from './shiftActions';

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

describe('useOpenShiftMutation', () => {
  it('sends the counted drawer amount — the backend requires it', async () => {
    mock.onPost('/shifts').reply(201, { id: 's1' });
    const { result } = renderHook(() => useOpenShiftMutation(), { wrapper });
    await result.current.mutateAsync({ counted_amount: '1500.00' });
    await waitFor(() => expect(mock.history.post).toHaveLength(1));
    expect(JSON.parse(mock.history.post[0].data)).toEqual({ counted_amount: '1500.00' });
  });
});

describe('useCloseShiftMutation', () => {
  it('posts the count to the shift being closed', async () => {
    mock.onPost('/shifts/s1/close').reply(200, { id: 's1' });
    const { result } = renderHook(() => useCloseShiftMutation(), { wrapper });
    await result.current.mutateAsync({ id: 's1', counted_amount: '980.40' });
    await waitFor(() => expect(mock.history.post).toHaveLength(1));
    expect(mock.history.post[0].url).toBe('/shifts/s1/close');
    expect(JSON.parse(mock.history.post[0].data)).toEqual({ counted_amount: '980.40' });
  });

  it('invalidates shifts, intakes, payouts, cashCounts and pointCash — closing moves a point\'s cash figure', async () => {
    mock.onPost('/shifts/s1/close').reply(200, { id: 's1' });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCloseShiftMutation(), { wrapper });

    await result.current.mutateAsync({ id: 's1', counted_amount: '980.40' });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.shifts });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.intakes });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.payouts });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.cashCounts });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.pointCash });
    });
  });
});

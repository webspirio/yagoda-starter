import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ReactNode } from 'react';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { useAcceptTransferMutation, useDisputeTransferMutation } from './useReceiveTransfer';

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

describe('useAcceptTransferMutation', () => {
  it('accepting invalidates transfers and point cash — and NOT shifts', async () => {
    mock.onPost('/transfers/t1/accept').reply(200, { id: 't1', status: 'accepted' });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useAcceptTransferMutation(), { wrapper });

    await result.current.mutateAsync('t1');

    expect(mock.history.post).toHaveLength(1);
    expect(mock.history.post[0].url).toBe('/transfers/t1/accept');
    // §7.9 — «поля суми в точки НЕМАЄ»: no body on accept.
    expect(mock.history.post[0].data).toBeUndefined();
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.transfers });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.pointCash });
    });
    // `TransfersService.transition` READS the open shift (§4.1) to stamp the
    // TRANSFER's `accepted_date`; the shift row itself is never written, so
    // refetching every shift query would buy nothing.
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: queryKeys.shifts });
  });
});

describe('useDisputeTransferMutation', () => {
  it('disputing posts the counted figures and note, and invalidates the same two keys', async () => {
    mock.onPost('/transfers/t1/dispute').reply(200, { id: 't1', status: 'disputed' });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useDisputeTransferMutation(), { wrapper });

    await result.current.mutateAsync({
      id: 't1',
      reported_cash: '49500.00',
      reported_crates: 118,
      dispute_note: 'Двох ящиків не було',
    });

    expect(mock.history.post).toHaveLength(1);
    expect(mock.history.post[0].url).toBe('/transfers/t1/dispute');
    expect(JSON.parse(mock.history.post[0].data as string)).toEqual({
      reported_cash: '49500.00',
      reported_crates: 118,
      dispute_note: 'Двох ящиків не було',
    });
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.transfers });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.pointCash });
    });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: queryKeys.shifts });
  });
});

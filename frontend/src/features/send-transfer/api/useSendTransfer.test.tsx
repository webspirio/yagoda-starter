import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ReactNode } from 'react';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { useSendTransferMutation } from './useSendTransfer';

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

describe('useSendTransferMutation', () => {
  it('posts the transfer and invalidates transfers AND point cash together', async () => {
    mock.onPost('/transfers').reply(201, { id: 't1' });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useSendTransferMutation(), { wrapper });

    await result.current.mutateAsync({
      collection_point_id: 'p1',
      cash: '50000.00',
      crates: 120,
      carrier: 'Петро',
    });

    expect(mock.history.post).toHaveLength(1);
    expect(mock.history.post[0].url).toBe('/transfers');
    expect(JSON.parse(mock.history.post[0].data as string)).toEqual({
      collection_point_id: 'p1',
      cash: '50000.00',
      crates: 120,
      carrier: 'Петро',
    });
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.transfers });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.pointCash });
    });
  });

  it('carries correction_of_transfer_id when the send corrects a prior one (§9.3)', async () => {
    mock.onPost('/transfers').reply(201, { id: 't2' });
    const { result } = renderHook(() => useSendTransferMutation(), { wrapper });

    await result.current.mutateAsync({
      collection_point_id: 'p1',
      cash: '0.00',
      crates: 10,
      carrier: 'Петро',
      correction_of_transfer_id: 't1',
    });

    expect(JSON.parse(mock.history.post[0].data as string)).toMatchObject({
      correction_of_transfer_id: 't1',
    });
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ReactNode } from 'react';
import { httpClient, attachAuthInterceptors } from '@/shared/api';
import { useReweighQuery, reweighQueryOptions } from './useReweigh';

attachAuthInterceptors(httpClient, { getToken: () => null, onUnauthorized: () => {} });

let mock: MockAdapter;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);
const reconciliation = {
  shift_id: 's1',
  closed_at: null,
  accepted_anything: true,
  items: [],
  products: [],
  grades: [],
};

beforeEach(() => {
  mock = new MockAdapter(httpClient);
});
afterEach(() => mock.restore());

describe('useReweighQuery', () => {
  it('reads one shift reconciliation', async () => {
    mock.onGet('/shifts/s1/reweigh', { params: {} }).reply(200, reconciliation);

    const { result } = renderHook(() => useReweighQuery('s1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(reconciliation);
  });

  it('asks for the voided lines when told to', async () => {
    mock
      .onGet('/shifts/s1/reweigh', { params: { include_voided: true } })
      .reply(200, reconciliation);

    renderHook(() => useReweighQuery('s1', { includeVoided: true }), { wrapper });

    await waitFor(() => expect(mock.history.get).toHaveLength(1));
    expect(mock.history.get[0].params).toEqual({ include_voided: true });
  });

  it('does not fire without a shift — «no shift» is a state, not a request', () => {
    const { result } = renderHook(() => useReweighQuery(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mock.history.get).toHaveLength(0);
  });

  it('keys the two variants apart so one never serves the other', () => {
    const plain = reweighQueryOptions('s1').queryKey;
    const voided = reweighQueryOptions('s1', { includeVoided: true }).queryKey;
    expect(plain).not.toEqual(voided);
  });
});

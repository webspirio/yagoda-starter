import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ReactNode } from 'react';
import { httpClient, attachAuthInterceptors } from '@/shared/api';
import { useTransfersQuery } from './useTransfers';

attachAuthInterceptors(httpClient, { getToken: () => null, onUnauthorized: () => {} });

let mock: MockAdapter;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);
const page = { data: [], total: 0, page: 1, limit: 100 };

beforeEach(() => {
  mock = new MockAdapter(httpClient);
});
afterEach(() => mock.restore());

describe('useTransfersQuery', () => {
  it('maps the filter onto the API snake_case params', async () => {
    mock
      .onGet('/transfers', {
        params: {
          collection_point_id: 'p1',
          status: 'sent',
          include_voided: false,
          limit: 100,
        },
      })
      .reply(200, page);
    const { result } = renderHook(
      () => useTransfersQuery({ pointId: 'p1', status: 'sent' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data).toEqual(page));
  });

  it('defaults include_voided to false — a voided transfer is not added back', async () => {
    mock.onGet('/transfers').reply(200, page);
    renderHook(() => useTransfersQuery({ pointId: 'p1' }), { wrapper });
    await waitFor(() => expect(mock.history.get).toHaveLength(1));
    expect(mock.history.get[0].params.include_voided).toBe(false);
  });

  it('reads the whole network when the filter is empty — the owner’s own list', async () => {
    mock.onGet('/transfers').reply(200, page);
    const { result } = renderHook(() => useTransfersQuery({}), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(page));
  });

  it('does not fire when the caller opts out', () => {
    mock.onGet('/transfers').reply(200, page);
    const { result } = renderHook(() => useTransfersQuery({ enabled: false }), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mock.history.get).toHaveLength(0);
  });

  it('keeps the gate out of the request — `enabled` is not an API param', async () => {
    mock.onGet('/transfers').reply(200, page);
    renderHook(() => useTransfersQuery({ pointId: 'p1', enabled: true }), { wrapper });
    await waitFor(() => expect(mock.history.get).toHaveLength(1));
    expect(mock.history.get[0].params).not.toHaveProperty('enabled');
  });
});

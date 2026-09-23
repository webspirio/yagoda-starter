import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ReactNode } from 'react';
import { httpClient, attachAuthInterceptors } from '@/shared/api';
import { useCrateStandingQuery, useCrateIssuancesQuery } from './useCrates';

attachAuthInterceptors(httpClient, { getToken: () => null, onUnauthorized: () => {} });

let mock: MockAdapter;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

const STANDING = {
  collection_point_id: 'p1',
  allotment: 800,
  in_field: 195,
  deposit_units: 115,
  deposit_held: '13800.00',
  at_base: 264,
  on_hand: 341,
  shortfall: 459,
};

beforeEach(() => {
  mock = new MockAdapter(httpClient);
});
afterEach(() => mock.restore());

describe('useCrateStandingQuery', () => {
  it('asks for the chosen point', async () => {
    mock.onGet('/crate-standing', { params: { collection_point_id: 'p1' } }).reply(200, STANDING);
    const { result } = renderHook(() => useCrateStandingQuery({ pointId: 'p1', isOwner: true }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(STANDING);
  });

  /** An owner with no point would get a 400 — the request must not leave. */
  it('does not fire for an owner who has not chosen a point', async () => {
    const { result } = renderHook(() => useCrateStandingQuery({ pointId: null, isOwner: true }), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    // Flush microtasks so a request that WOULD have fired has had its chance.
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.fetchStatus).toBe('idle');
    expect(mock.history.get).toHaveLength(0);
  });

  it('fires for an operator without a point — the server pins them', async () => {
    mock.onGet('/crate-standing').reply(200, STANDING);
    renderHook(() => useCrateStandingQuery({ pointId: null, isOwner: false }), { wrapper });
    await waitFor(() => expect(mock.history.get).toHaveLength(1));
    expect(mock.history.get[0].params).toEqual({});
  });
});

describe('useCrateIssuancesQuery', () => {
  it('sends include_voided when asked', async () => {
    mock.onGet('/crate-issuances').reply(200, { data: [], total: 0, page: 1, limit: 100 });
    renderHook(() => useCrateIssuancesQuery({ supplierId: 's1', includeVoided: true }), { wrapper });
    await waitFor(() => expect(mock.history.get).toHaveLength(1));
    expect(mock.history.get[0].params).toEqual({ supplier_id: 's1', include_voided: true, limit: 100 });
  });
});

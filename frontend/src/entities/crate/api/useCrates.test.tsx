import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ReactNode } from 'react';
import { httpClient, attachAuthInterceptors } from '@/shared/api';
import type { CrateStanding } from '../model/crate';
import { useCrateStandingQuery, useCrateIssuancesQuery, useCrateHoldersQuery } from './useCrates';

attachAuthInterceptors(httpClient, { getToken: () => null, onUnauthorized: () => {} });

let mock: MockAdapter;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

const STANDING: CrateStanding = {
  collection_point_id: 'p1',
  allotment: 800,
  received: 808,
  on_hand: 341,
  in_transit: 0,
  in_field: 195,
  deposit_units: 115,
  deposit_held: '13800.00',
  with_berry: 264,
  total: 800,
  shortfall: 0,
  holders: 2,
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

describe('useCrateHoldersQuery', () => {
  const holder = (i: number) => ({ supplier_id: `s${i}` });
  const page = (from: number, n: number, total: number) => ({
    data: Array.from({ length: n }, (_, i) => holder(from + i)),
    total,
    page: 1,
    limit: 100,
  });

  it('walks every page until it has `total` rows', async () => {
    mock.onGet('/crate-balances').replyOnce(200, page(0, 100, 150)).onGet('/crate-balances').replyOnce(200, page(100, 50, 150));
    const { result } = renderHook(() => useCrateHoldersQuery('p1', true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(150);
    expect(mock.history.get.map((c) => c.params)).toEqual([
      { collection_point_id: 'p1', limit: 100, page: 1 },
      { collection_point_id: 'p1', limit: 100, page: 2 },
    ]);
  });

  it('keeps a holder once when a shifting sort serves it on two pages', async () => {
    mock
      .onGet('/crate-balances')
      .replyOnce(200, page(0, 100, 150))
      .onGet('/crate-balances')
      .replyOnce(200, page(99, 51, 150));
    const { result } = renderHook(() => useCrateHoldersQuery('p1', true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const ids = result.current.data!.map((r) => r.supplier_id);
    expect(ids).toHaveLength(150);
    expect(new Set(ids).size).toBe(150);
    expect(mock.history.get).toHaveLength(2);
  });

  it('makes one request when everything fits on one page', async () => {
    mock.onGet('/crate-balances').reply(200, page(0, 100, 100));
    const { result } = renderHook(() => useCrateHoldersQuery('p1', true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(100);
    expect(mock.history.get).toHaveLength(1);
  });

  it('returns [] after one request when there are no holders', async () => {
    mock.onGet('/crate-balances').reply(200, page(0, 0, 0));
    const { result } = renderHook(() => useCrateHoldersQuery('p1', true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
    expect(mock.history.get).toHaveLength(1);
  });

  it('stops on an empty page even if `total` promised more', async () => {
    mock.onGet('/crate-balances').replyOnce(200, page(0, 100, 150)).onGet('/crate-balances').replyOnce(200, page(100, 0, 150));
    const { result } = renderHook(() => useCrateHoldersQuery('p1', true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(100);
    expect(mock.history.get).toHaveLength(2);
  });

  it('does not fire when disabled', async () => {
    const { result } = renderHook(() => useCrateHoldersQuery('p1', false), { wrapper });
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.fetchStatus).toBe('idle');
    expect(mock.history.get).toHaveLength(0);
  });
});

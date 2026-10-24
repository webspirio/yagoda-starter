import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ReactNode } from 'react';
import { httpClient, attachAuthInterceptors } from '@/shared/api';
import { useCostOfDayQuery } from './useCostOfDay';

attachAuthInterceptors(httpClient, { getToken: () => null, onUnauthorized: () => {} });

let mock: MockAdapter;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

const day = {
  shift_id: 's1',
  closed_at: null,
  provisional: true,
  accrued: '131900.00',
  reweighed_kg: '854.00',
  shortfall_amount: '1660.00',
  expenses_amount: '3800.00',
  basket: '5460.00',
  per_kg: '6.39',
  shortfall_per_kg: '1.94',
  expenses_per_kg: '4.45',
  total_check: '135700.00',
  weighed: {
    intake_kg: '865.00',
    shortfall_kg: '11.00',
    accrued: '131900.00',
    shortfall: '1660.00',
  },
  full_cost: '135700.00',
  price_cost_avg: '158.90',
  unweighed: { intake_kg: '0.00', accrued: '0.00' },
  checks: { shares_ok: true, total_ok: true },
  top_ups_included: true,
  top_ups_latest_at: null,
  top_ups_total: '0.00',
  products: [],
};

beforeEach(() => {
  mock = new MockAdapter(httpClient);
});
afterEach(() => mock.restore());

describe('useCostOfDayQuery', () => {
  it('reads one shift собівартість', async () => {
    mock.onGet('/shifts/s1/cost-of-day').reply(200, day);

    const { result } = renderHook(() => useCostOfDayQuery('s1', 'weight'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(day);
  });

  it('does not fire without a shift — «no shift» is a state, not a request', () => {
    const { result } = renderHook(() => useCostOfDayQuery(undefined, 'weight'), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mock.history.get).toHaveLength(0);
  });

  it('sends the split and keeps one cache entry per split — spec 2026-10-24 §4', async () => {
    mock.onGet('/shifts/s1/cost-of-day').reply(200, day);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const shared = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const own = renderHook(() => useCostOfDayQuery('s1', 'own'), { wrapper: shared });
    await waitFor(() => expect(own.result.current.isSuccess).toBe(true));
    const value = renderHook(() => useCostOfDayQuery('s1', 'value'), { wrapper: shared });
    await waitFor(() => expect(value.result.current.isSuccess).toBe(true));

    expect(mock.history.get.map((r) => r.params)).toEqual([{ split: 'own' }, { split: 'value' }]);
  });

  it('keeps the shift’s figures on screen while another split loads — review, focus 5', async () => {
    mock.onGet('/shifts/s1/cost-of-day').reply(200, day);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const shared = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, rerender } = renderHook(
      ({ split }: { split: 'weight' | 'own' }) => useCostOfDayQuery('s1', split),
      { wrapper: shared, initialProps: { split: 'weight' } },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    mock.onGet('/shifts/s1/cost-of-day').reply(() => new Promise(() => {}));
    rerender({ split: 'own' });

    // Never pending — a pending read swaps the sheet for a spinner and unmounts
    // the expenses strip with its half-typed line.
    expect(result.current.isPending).toBe(false);
    expect(result.current.isPlaceholderData).toBe(true);
    expect(result.current.data).toEqual(day);
  });

  it('never shows another shift’s figures as a placeholder', async () => {
    mock.onGet('/shifts/s1/cost-of-day').reply(200, day);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const shared = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, rerender } = renderHook(
      ({ shiftId }: { shiftId: string }) => useCostOfDayQuery(shiftId, 'weight'),
      { wrapper: shared, initialProps: { shiftId: 's1' } },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    mock.onGet('/shifts/s2/cost-of-day').reply(() => new Promise(() => {}));
    rerender({ shiftId: 's2' });

    expect(result.current.isPending).toBe(true);
    expect(result.current.data).toBeUndefined();
  });
});

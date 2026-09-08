import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ReactNode } from 'react';
import { httpClient } from '@/shared/api';
import type { Shift } from '@/entities/shift';
import type { Intake } from '@/entities/intake';
import type { Payout } from '@/entities/payout';
import { useNetworkToday } from './useNetworkToday';

let mock: MockAdapter;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

beforeEach(() => {
  mock = new MockAdapter(httpClient);
  // «Today» is 2026-09-08 in local time — todayIso() reads the local calendar day.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-08T09:00:00') });
});
afterEach(() => {
  mock.restore();
  vi.useRealTimers();
});

const openShift: Shift = {
  id: 's1',
  collection_point_id: 'p1',
  business_date: '2026-09-08',
  status: 'open',
  opened_by_user_id: 'u1',
  closed_by_user_id: null,
  closed_at: null,
  created_at: '2026-09-08T05:00:00Z',
};

const intake = (over: Partial<Intake> & Pick<Intake, 'id' | 'code' | 'amount'>): Intake => ({
  shift_id: 's1',
  collection_point_id: 'p1',
  business_date: '2026-09-08',
  supplier_id: 'sup1',
  received_by_user_id: 'u1',
  voided_at: null,
  voided_by_user_id: null,
  void_reason: null,
  created_at: '2026-09-08T07:10:00Z',
  ...over,
});

const payout = (over: Partial<Payout> & Pick<Payout, 'id' | 'code' | 'amount'>): Payout => ({
  shift_id: 's1',
  collection_point_id: 'p1',
  business_date: '2026-09-08',
  supplier_id: 'sup1',
  paid_by_user_id: 'u1',
  voided_at: null,
  voided_by_user_id: null,
  void_reason: null,
  return_settled_at: null,
  return_settled_by_user_id: null,
  return_note: null,
  created_at: '2026-09-08T11:00:00Z',
  ...over,
});

function mockPoint(
  pointId: string,
  data: { shift?: Shift | null; intakes?: Intake[]; payouts?: Payout[] } = {},
) {
  const dateParams = { from: '2026-09-08', to: '2026-09-08' };
  mock
    .onGet('/shifts', { params: { collection_point_id: pointId, ...dateParams, limit: 1 } })
    .reply(200, { data: data.shift ? [data.shift] : [], total: data.shift ? 1 : 0, page: 1, limit: 1 });
  mock
    .onGet('/intakes', {
      params: { collection_point_id: pointId, ...dateParams, include_voided: true, limit: 100 },
    })
    .reply(200, {
      data: data.intakes ?? [],
      total: (data.intakes ?? []).length,
      page: 1,
      limit: 100,
    });
  mock
    .onGet('/payouts', {
      params: { collection_point_id: pointId, ...dateParams, include_voided: true, limit: 100 },
    })
    .reply(200, {
      data: data.payouts ?? [],
      total: (data.payouts ?? []).length,
      page: 1,
      limit: 100,
    });
}

describe('useNetworkToday', () => {
  it('reads today across every point and sums only the live documents', async () => {
    mockPoint('p1', {
      shift: openShift,
      intakes: [
        intake({ id: 'i1', code: 'KV-0001', amount: '100.00' }),
        intake({ id: 'i2', code: 'KV-0002', amount: '28.00' }),
        intake({
          id: 'i3',
          code: 'KV-0003',
          amount: '99.00',
          voided_at: '2026-09-08T10:00:00Z',
          void_reason: 'Wrong supplier',
        }),
      ],
      payouts: [payout({ id: 'y1', code: 'VD-0001', amount: '40.00' })],
    });
    mockPoint('p2', {}); // no shift opened today, no documents

    const { result } = renderHook(() => useNetworkToday(['p1', 'p2']), { wrapper });

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.isError).toBe(false);
    expect(result.current.rows).toEqual([
      { pointId: 'p1', shift: openShift, receipts: 2, accrued: '128.00', paid: '40.00', truncated: false },
      { pointId: 'p2', shift: null, receipts: 0, accrued: '0.00', paid: '0.00', truncated: false },
    ]);
    expect(result.current.anyTruncated).toBe(false);
  });

  it('flags isError when any of the three reads for any point fails', async () => {
    mock
      .onGet('/shifts', {
        params: { collection_point_id: 'p1', from: '2026-09-08', to: '2026-09-08', limit: 1 },
      })
      .reply(500);
    mock
      .onGet('/intakes', {
        params: {
          collection_point_id: 'p1',
          from: '2026-09-08',
          to: '2026-09-08',
          include_voided: true,
          limit: 100,
        },
      })
      .reply(200, { data: [], total: 0, page: 1, limit: 100 });
    mock
      .onGet('/payouts', {
        params: {
          collection_point_id: 'p1',
          from: '2026-09-08',
          to: '2026-09-08',
          include_voided: true,
          limit: 100,
        },
      })
      .reply(200, { data: [], total: 0, page: 1, limit: 100 });

    const { result } = renderHook(() => useNetworkToday(['p1']), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('returns no rows and is not pending for an empty point list', () => {
    const { result } = renderHook(() => useNetworkToday([]), { wrapper });

    expect(result.current.rows).toEqual([]);
    expect(result.current.isPending).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(result.current.anyTruncated).toBe(false);
  });

  it('flags a point truncated when its intakes hit the 100-row cap the day screen also uses, and aggregates that across the network', async () => {
    const dateParams = { from: '2026-09-08', to: '2026-09-08' };
    mock
      .onGet('/shifts', { params: { collection_point_id: 'p1', ...dateParams, limit: 1 } })
      .reply(200, { data: [openShift], total: 1, page: 1, limit: 1 });
    mock
      .onGet('/intakes', {
        params: { collection_point_id: 'p1', ...dateParams, include_voided: true, limit: 100 },
      })
      // The server holds 150 receipts today at p1; only the first 100 (here,
      // one, to keep the fixture small) come back on this page.
      .reply(200, {
        data: [intake({ id: 'i1', code: 'KV-0001', amount: '10.00' })],
        total: 150,
        page: 1,
        limit: 100,
      });
    mock
      .onGet('/payouts', {
        params: { collection_point_id: 'p1', ...dateParams, include_voided: true, limit: 100 },
      })
      .reply(200, { data: [], total: 0, page: 1, limit: 100 });
    mockPoint('p2', { shift: openShift, intakes: [intake({ id: 'i2', code: 'KV-0002', amount: '5.00' })] });

    const { result } = renderHook(() => useNetworkToday(['p1', 'p2']), { wrapper });

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.isError).toBe(false);
    expect(result.current.rows[0]).toMatchObject({ pointId: 'p1', truncated: true });
    expect(result.current.rows[1]).toMatchObject({ pointId: 'p2', truncated: false });
    expect(result.current.anyTruncated).toBe(true);
  });
});

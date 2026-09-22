import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ReactNode } from 'react';
import { httpClient } from '@/shared/api';
import type { Shift } from '@/entities/shift';
import type { Reweigh, ReweighItem } from '@/entities/reweigh';
import type { PointOption } from '@/entities/collection-point';
import { useDayReweighs } from './useDayReweighs';

let mock: MockAdapter;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

beforeEach(() => {
  mock = new MockAdapter(httpClient);
});
afterEach(() => {
  mock.restore();
});

const POINTS: PointOption[] = [
  { id: 'p1', name: 'Шипинки', kind: 'reception', target_crates: null },
  { id: 'p2', name: 'Конищів', kind: 'reception', target_crates: null },
];

const shift = (id: string, pointId: string): Shift => ({
  id,
  collection_point_id: pointId,
  business_date: '2026-09-21',
  status: 'open',
  opened_by_user_id: 'u1',
  closed_by_user_id: null,
  closed_at: null,
  created_at: '2026-09-21T05:00:00Z',
  explanation: null,
  broken_crates: null,
    opened_by_name: null,
    closed_by_name: null,
});

const item = (over: Partial<ReweighItem> & Pick<ReweighItem, 'id' | 'created_at'>): ReweighItem => ({
  reweigh_id: 'r1',
  item_order: 1,
  product_grade_id: 'pg1',
  gross_kg: '10.00',
  pallet_kg: '1.00',
  tare_weight_kg: '0.50',
  net_kg: '8.50',
  tare: [],
  weighed_by_user_id: 'u1',
  voided_at: null,
  voided_by_user_id: null,
  void_reason: null,
  ...over,
});

function mockShift(pointId: string, date: string, resolved: Shift | null) {
  mock
    .onGet('/shifts', { params: { collection_point_id: pointId, from: date, to: date, limit: 1 } })
    .reply(200, { data: resolved ? [resolved] : [], total: resolved ? 1 : 0, page: 1, limit: 1 });
}

function mockReweigh(shiftId: string, items: ReweighItem[]) {
  const body: Reweigh = {
    shift_id: shiftId,
    closed_at: null,
    accepted_anything: items.length > 0,
    items,
    products: [],
    grades: [],
  };
  mock.onGet(`/shifts/${shiftId}/reweigh`, { params: { include_voided: true } }).reply(200, body);
}

describe('useDayReweighs', () => {
  it('asks each point for its shift on that date', async () => {
    mockShift('p1', '2026-09-21', null);
    mockShift('p2', '2026-09-21', null);

    renderHook(() => useDayReweighs(POINTS, '2026-09-21'), { wrapper });

    await waitFor(() => {
      expect(mock.history.get.filter((r) => r.url === '/shifts')).toHaveLength(2);
    });
  });

  it('labels every line with the point it came from, and fires no reconciliation for a point with no shift', async () => {
    mockShift('p1', '2026-09-21', shift('s1', 'p1'));
    mockShift('p2', '2026-09-21', null);
    mockReweigh('s1', [item({ id: 'i1', created_at: '2026-09-21T10:00:00Z' })]);

    const { result } = renderHook(() => useDayReweighs(POINTS, '2026-09-21'), { wrapper });

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.lines).toHaveLength(1);
    expect(result.current.lines[0]).toMatchObject({ pointId: 'p1', pointName: 'Шипинки' });

    // p2 never resolved a shift — a reconciliation request for it would be
    // `/shifts/undefined/reweigh`, and none went out at all.
    expect(mock.history.get.filter((r) => r.url?.includes('/reweigh'))).toHaveLength(1);
  });

  it('orders newest first ACROSS points, not per point', async () => {
    mockShift('p1', '2026-09-21', shift('s1', 'p1'));
    mockShift('p2', '2026-09-21', shift('s2', 'p2'));
    // p1 (iterated first) holds the OLDER line; a naive per-point
    // concatenation would still list it first. Only a merged sort by
    // `created_at` puts p2's 11:00 line ahead of p1's 10:00 line.
    mockReweigh('s1', [item({ id: 'i1', created_at: '2026-09-21T10:00:00Z' })]);
    mockReweigh('s2', [item({ id: 'i2', created_at: '2026-09-21T11:00:00Z' })]);

    const { result } = renderHook(() => useDayReweighs(POINTS, '2026-09-21'), { wrapper });

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.lines.map((l) => l.pointId)).toEqual(['p2', 'p1']);
  });

  /**
   * THE SHORT TABLE. A point whose shift or reconciliation read fails simply
   * drops out of `withShift`/`lines` — there is no other way for this shape
   * to carry on — so `lines` stays a VALID list that is quietly missing a
   * point's weighings, under a caption that says «по всіх пунктах». Only
   * `isError` tells the table apart from a genuinely quiet day, which is why
   * `useNetworkToday` aggregates the same flag over its own fan-out.
   */
  it('reports a failed reconciliation read rather than silently dropping that point', async () => {
    mockShift('p1', '2026-09-21', shift('s1', 'p1'));
    mockShift('p2', '2026-09-21', shift('s2', 'p2'));
    mockReweigh('s1', [item({ id: 'i1', created_at: '2026-09-21T10:00:00Z' })]);
    mock.onGet('/shifts/s2/reweigh', { params: { include_voided: true } }).reply(500);

    const { result } = renderHook(() => useDayReweighs(POINTS, '2026-09-21'), { wrapper });

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.isError).toBe(true);
    // p1's line still arrives — the flag reports the gap, it does not blank
    // the table that the surviving point's storno is reached from.
    expect(result.current.lines).toHaveLength(1);
  });

  it('reports a failed SHIFT read too — that point never even reaches the second wave', async () => {
    mockShift('p1', '2026-09-21', shift('s1', 'p1'));
    mock
      .onGet('/shifts', {
        params: { collection_point_id: 'p2', from: '2026-09-21', to: '2026-09-21', limit: 1 },
      })
      .reply(500);
    mockReweigh('s1', []);

    const { result } = renderHook(() => useDayReweighs(POINTS, '2026-09-21'), { wrapper });

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.isError).toBe(true);
  });

  it('stays clear of the error flag on a day every point answered', async () => {
    mockShift('p1', '2026-09-21', shift('s1', 'p1'));
    mockShift('p2', '2026-09-21', null);
    mockReweigh('s1', []);

    const { result } = renderHook(() => useDayReweighs(POINTS, '2026-09-21'), { wrapper });

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.isError).toBe(false);
  });

  it('requests the voided lines too — a storno must stay visible', async () => {
    mockShift('p1', '2026-09-21', shift('s1', 'p1'));
    mockShift('p2', '2026-09-21', null);
    mockReweigh('s1', []);

    renderHook(() => useDayReweighs(POINTS, '2026-09-21'), { wrapper });

    await waitFor(() => {
      expect(mock.history.get.some((r) => r.url === '/shifts/s1/reweigh')).toBe(true);
    });
    const reweighRequest = mock.history.get.find((r) => r.url === '/shifts/s1/reweigh');
    expect(reweighRequest?.params).toEqual({ include_voided: true });
  });
});

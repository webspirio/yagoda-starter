import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ReactNode } from 'react';
import { httpClient, attachAuthInterceptors } from '@/shared/api';
import { usePricedGradesQuery } from './usePricedGrades';

// Module-scope, not per-test — see useShifts.test.tsx for why: attaching once
// keeps the shared httpClient singleton from stacking interceptors across
// tests, and nothing here exercises auth beyond needing the client wired.
attachAuthInterceptors(httpClient, { getToken: () => null, onUnauthorized: () => {} });

let mock: MockAdapter;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

beforeEach(() => {
  mock = new MockAdapter(httpClient);
});
afterEach(() => mock.restore());

describe('usePricedGradesQuery', () => {
  it("joins the grade catalog to the point's current prices, dropping unpriced grades", async () => {
    mock.onGet('/products').reply(200, {
      data: [{ id: 'prod1', name: 'Малина' }],
      total: 1,
      page: 1,
      limit: 100,
    });
    mock.onGet('/product-grades', { params: { include_inactive: false } }).reply(200, {
      data: [
        { id: 'g1', product_id: 'prod1', name: 'Перший сорт', is_active: true },
        { id: 'g2', product_id: 'prod1', name: 'Другий сорт', is_active: true },
      ],
      total: 2,
      page: 1,
      limit: 100,
    });
    mock.onGet('/grade-prices/current', { params: { collection_point_id: 'p1' } }).reply(200, {
      data: [
        {
          id: 'price1',
          collection_point_id: 'p1',
          product_grade_id: 'g1',
          base_price: '135.00',
          max_markup: '30.00',
          max_discount: '30.00',
          created_by_user_id: 'u1',
          reason: null,
          created_at: '2026-09-08T04:30:00Z',
        },
      ],
      total: 1,
      page: 1,
      limit: 100,
    });

    const { result } = renderHook(() => usePricedGradesQuery('p1'), { wrapper });

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.isError).toBe(false);
    expect(result.current.data).toEqual([
      {
        id: 'g1',
        name: 'Перший сорт',
        productId: 'prod1',
        productName: 'Малина',
        base_price: '135.00',
        max_markup: '30.00',
        max_discount: '30.00',
      },
    ]);
    // Proves the point id actually reaches the prices request, not just that
    // SOME grade-prices call happened — the mock above only replies when
    // `collection_point_id` matches, but this asserts it explicitly.
    expect(
      mock.history.get.some(
        (r) => r.url === '/grade-prices/current' && r.params?.collection_point_id === 'p1',
      ),
    ).toBe(true);
  });

  it('does not fire the prices read without a point', async () => {
    mock.onGet('/products').reply(200, { data: [], total: 0, page: 1, limit: 100 });
    mock
      .onGet('/product-grades', { params: { include_inactive: false } })
      .reply(200, { data: [], total: 0, page: 1, limit: 100 });
    // No handler registered for /grade-prices/current at all — if the `enabled:
    // pointId !== null` gate were removed, the query would fire an unmatched
    // request and axios-mock-adapter would reject it, surfacing as an error
    // instead of silently passing.
    renderHook(() => usePricedGradesQuery(null), { wrapper });

    // Let the (ungated) catalog reads land so there's been a real tick for a
    // gated prices request to have fired too, if the gate were broken.
    await waitFor(() => expect(mock.history.get.some((r) => r.url === '/products')).toBe(true));
    await waitFor(() =>
      expect(mock.history.get.some((r) => r.url === '/product-grades')).toBe(true),
    );

    expect(mock.history.get.some((r) => r.url === '/grade-prices/current')).toBe(false);
  });
});

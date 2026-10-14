import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { nextTotalsPage, useSupplierTotalsInfiniteQuery } from './useSupplierTotals';

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock('@/shared/api', () => ({ httpClient: { get: getMock } }));

const page = (n: number, total: number) => ({ data: [], total, page: n, limit: 100 });

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('nextTotalsPage', () => {
  it('asks for the next page while rows remain, and stops on the last', () => {
    expect(nextTotalsPage(page(1, 193))).toBe(2);
    expect(nextTotalsPage(page(2, 193))).toBeUndefined();
    expect(nextTotalsPage(page(1, 100))).toBeUndefined();
    expect(nextTotalsPage(page(1, 0))).toBeUndefined();
  });
});

describe('useSupplierTotalsInfiniteQuery', () => {
  beforeEach(() => getMock.mockReset().mockResolvedValue({ data: page(1, 1) }));

  it('starts at page 1 with the sort, order and trimmed search in the request', async () => {
    renderHook(() => useSupplierTotalsInfiniteQuery({ search: ' Ков ', sort: 'amount', order: 'asc' }), { wrapper });
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));
    expect(getMock).toHaveBeenCalledWith('/supplier-totals', {
      params: { q: 'Ков', sort: 'amount', order: 'asc', page: 1, limit: 100 },
    });
  });

  it('a new sort is a new list from page 1, not page 2 appended to the old order', async () => {
    const { rerender } = renderHook(
      ({ sort }: { sort: 'weight' | 'amount' }) =>
        useSupplierTotalsInfiniteQuery({ search: '', sort, order: 'desc' }),
      { wrapper, initialProps: { sort: 'weight' } },
    );
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));
    rerender({ sort: 'amount' });
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
    expect(getMock.mock.calls[1][1].params).toMatchObject({ sort: 'amount', page: 1 });
  });
});

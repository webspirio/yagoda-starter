import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useSupplierTotalsQuery } from './useSupplierTotals';

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock('@/shared/api', () => ({ httpClient: { get: getMock } }));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useSupplierTotalsQuery', () => {
  beforeEach(() => getMock.mockReset().mockResolvedValue({ data: [] }));

  it('sends the sort, order and trimmed search, and no page', async () => {
    renderHook(
      () =>
        useSupplierTotalsQuery({
          search: ' Ков ',
          sort: 'amount',
          order: 'asc',
          status: 'inactive',
        }),
      { wrapper },
    );
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));
    expect(getMock).toHaveBeenCalledWith('/supplier-totals', {
      params: { q: 'Ков', sort: 'amount', order: 'asc', status: 'inactive' },
    });
  });

  it('a new sort is a new request', async () => {
    const { rerender } = renderHook(
      ({ sort }: { sort: 'weight' | 'amount' }) =>
        useSupplierTotalsQuery({ search: '', sort, order: 'desc', status: 'active' }),
      { wrapper, initialProps: { sort: 'weight' } },
    );
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));
    rerender({ sort: 'amount' });
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
    expect(getMock.mock.calls[1][1].params).toMatchObject({ sort: 'amount' });
  });

  it('a new status is a new request', async () => {
    const { rerender } = renderHook(
      ({ status }: { status: 'active' | 'all' }) =>
        useSupplierTotalsQuery({ search: '', sort: 'weight', order: 'desc', status }),
      { wrapper, initialProps: { status: 'active' } },
    );
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));
    rerender({ status: 'all' });
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
    expect(getMock.mock.calls[1][1].params).toMatchObject({ status: 'all' });
  });
});

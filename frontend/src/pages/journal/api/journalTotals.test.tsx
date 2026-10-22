import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ReactNode } from 'react';
import { httpClient, attachAuthInterceptors } from '@/shared/api';
import { useJournalTotalsQuery } from './journalTotals';

attachAuthInterceptors(httpClient, { getToken: () => null, onUnauthorized: () => {} });

let mock: MockAdapter;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);
const september = { from: '2026-09-01', to: '2026-09-30', pointId: null, supplierId: null };

beforeEach(() => {
  mock = new MockAdapter(httpClient);
});
afterEach(() => mock.restore());

describe('useJournalTotalsQuery', () => {
  it('sends the range, and the point and supplier only when chosen', async () => {
    mock.onGet('/journal-totals').reply(200, { accrued: '1.00', paid: '0.00' });
    renderHook(() => useJournalTotalsQuery({ ...september, pointId: 'p1' }), { wrapper });
    await waitFor(() => expect(mock.history.get).toHaveLength(1));
    expect(mock.history.get[0].params).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
      collection_point_id: 'p1',
    });
  });

  // PR #275 review: a placeholder would show the previous range's money
  // under the new bounds, indistinguishable from a settled figure.
  it('drops the previous range sums while the new range loads', async () => {
    mock.onGet('/journal-totals').replyOnce(200, { accrued: '500.00', paid: '100.00' });
    mock.onGet('/journal-totals').reply(() => new Promise(() => {}));
    const { result, rerender } = renderHook((filter) => useJournalTotalsQuery(filter), {
      wrapper,
      initialProps: september,
    });
    await waitFor(() => expect(result.current.data).toEqual({ accrued: '500.00', paid: '100.00' }));

    rerender({ ...september, from: '2026-09-15' });

    expect(result.current.data).toBeUndefined();
  });
});

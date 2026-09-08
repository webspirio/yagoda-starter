import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ReactNode } from 'react';
import { httpClient } from '@/shared/api';
import { useIntakesQuery } from './useIntakes';

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

describe('useIntakesQuery', () => {
  it('does not fire with no shift, supplier or point set', () => {
    const { result } = renderHook(() => useIntakesQuery({}), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('fetches headers for a shift, mapping the filter to snake_case params', async () => {
    const envelope = { data: [{ id: 'i1' }], total: 1, page: 1, limit: 100 };
    mock
      .onGet('/intakes', { params: { shift_id: 's1', include_voided: true, limit: 100 } })
      .reply(200, envelope);
    const { result } = renderHook(() => useIntakesQuery({ shiftId: 's1' }), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(envelope));
  });
});

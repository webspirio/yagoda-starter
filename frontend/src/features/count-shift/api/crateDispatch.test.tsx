import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ReactNode } from 'react';
import { httpClient } from '@/shared/api';
import { useCrateDispatchQuery } from './crateDispatch';

let mock: MockAdapter;
let queryClient: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

beforeEach(() => {
  mock = new MockAdapter(httpClient);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => mock.restore());

describe('useCrateDispatchQuery', () => {
  it('reads §6.8’s three numbers for one shift', async () => {
    mock
      .onGet('/shifts/s1/crates')
      .reply(200, { with_berry: 142, broken: null, dispatched: null });

    const { result } = renderHook(() => useCrateDispatchQuery('s1'), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual({ with_berry: 142, broken: null, dispatched: null });
  });

  it('never calls the endpoint without a shift — there is nothing to ask about', async () => {
    const { result } = renderHook(() => useCrateDispatchQuery(null), { wrapper });

    // `enabled: false`, not a request that 404s on `/shifts/null/crates`.
    expect(result.current.fetchStatus).toBe('idle');
    expect(mock.history.get).toHaveLength(0);
  });
});

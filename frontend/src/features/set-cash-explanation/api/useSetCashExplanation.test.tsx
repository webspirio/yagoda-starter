import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ReactNode } from 'react';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { useSetCashExplanationMutation } from './useSetCashExplanation';

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

describe('useSetCashExplanationMutation', () => {
  it('PUTs the explanation and invalidates cash counts only', async () => {
    mock.onPut('/cash-counts/c1/explanation').reply(200, { id: 'c1' });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useSetCashExplanationMutation(), { wrapper });

    await result.current.mutateAsync({
      countId: 'c1',
      explanation: 'здачу віддали з іншої шухляди',
    });

    expect(mock.history.put).toHaveLength(1);
    expect(mock.history.put[0].url).toBe('/cash-counts/c1/explanation');
    expect(JSON.parse(mock.history.put[0].data as string)).toEqual({
      explanation: 'здачу віддали з іншої шухляди',
    });

    // §7.7 — the incident list reads `is_open`/`explanation` off the count; a
    // Shift carries no text any more, so `shifts` has nothing to refresh.
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.cashCounts });
    });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: queryKeys.shifts });
  });
});

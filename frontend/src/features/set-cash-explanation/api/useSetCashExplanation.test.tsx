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
  it('PUTs the explanation and invalidates shifts and cash counts', async () => {
    mock.onPut('/shifts/s1/explanation').reply(200, { id: 's1' });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useSetCashExplanationMutation(), { wrapper });

    await result.current.mutateAsync({
      shiftId: 's1',
      explanation: 'здачу віддали з іншої шухляди',
    });

    expect(mock.history.put).toHaveLength(1);
    expect(mock.history.put[0].url).toBe('/shifts/s1/explanation');
    expect(JSON.parse(mock.history.put[0].data as string)).toEqual({
      explanation: 'здачу віддали з іншої шухляди',
    });

    // §7.7 (ред. 09.09.2026) — explaining never moves a number, but the
    // owner's incident list (`GET /cash-counts?only_discrepancies=true`) reads
    // `is_open`/`explanation` off the count, and the shift itself carries the
    // explanation — both must refresh, or the incident looks unresolved.
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.shifts });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.cashCounts });
    });
  });
});

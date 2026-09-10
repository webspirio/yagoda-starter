import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ReactNode } from 'react';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { useSetPointTargetMutation } from './useSetPointTarget';

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

describe('useSetPointTargetMutation', () => {
  it('PATCHes the point with the given reason and invalidates point cash', async () => {
    mock.onPatch('/collection-points/p1').reply(200, {});
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useSetPointTargetMutation(), { wrapper });

    await result.current.mutateAsync({
      pointId: 'p1',
      target_cash: '500000.00',
      reason: 'розширили точку',
    });

    expect(mock.history.patch).toHaveLength(1);
    expect(mock.history.patch[0].url).toBe('/collection-points/p1');
    expect(JSON.parse(mock.history.patch[0].data as string)).toEqual({
      target_cash: '500000.00',
      reason: 'розширили точку',
    });

    // §6.1 — a target is a management decision (owner-only, §10.2), and
    // `PointCashService`'s shortfall reads `target_cash` straight off the
    // point row, so the point-cash figure must refresh alongside the
    // registry entry itself.
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.pointCash });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.collectionPoints });
    });
  });

  it('omits reason from the request when the caller sends none', async () => {
    // §6.1: a point's FIRST-EVER target needs no reason — the dialog then
    // calls this hook with `reason: ''`. The backend DTO's `reason` is
    // `@IsOptional()`, but that only skips validation when the field is
    // ABSENT; a PRESENT empty string still hits `@Length(1, 500)` and 400s.
    // So "no reason" over the wire has to mean "no `reason` key", not
    // `reason: ''`.
    mock.onPatch('/collection-points/p1').reply(200, {});
    const { result } = renderHook(() => useSetPointTargetMutation(), { wrapper });

    await result.current.mutateAsync({ pointId: 'p1', target_cash: '145453.00', reason: '' });

    expect(JSON.parse(mock.history.patch[0].data as string)).toEqual({
      target_cash: '145453.00',
    });
  });
});

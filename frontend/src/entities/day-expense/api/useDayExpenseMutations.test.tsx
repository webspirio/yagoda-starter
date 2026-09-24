import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ReactNode } from 'react';
import { httpClient, attachAuthInterceptors } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import {
  useCreateDayExpenseMutation,
  useUpdateDayExpenseMutation,
  useDeleteDayExpenseMutation,
} from './useDayExpenseMutations';

attachAuthInterceptors(httpClient, { getToken: () => null, onUnauthorized: () => {} });

let mock: MockAdapter;
let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

const row = {
  id: 'e1',
  shift_id: 's1',
  label: 'пальне',
  amount: '1000.00',
  created_by_user_id: 'u1',
  created_at: '2026-09-22T08:00:00.000Z',
  updated_at: '2026-09-22T08:00:00.000Z',
};

beforeEach(() => {
  mock = new MockAdapter(httpClient);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => mock.restore());

describe('day expense mutations', () => {
  it('posts a new line against the shift', async () => {
    mock.onPost('/shifts/s1/expenses').reply(201, row);

    const { result } = renderHook(() => useCreateDayExpenseMutation(), { wrapper });
    result.current.mutate({ shiftId: 's1', label: 'пальне', amount: '1000.00' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(JSON.parse(mock.history.post[0].data as string)).toEqual({
      label: 'пальне',
      amount: '1000.00',
    });
  });

  it('patches a line by id, and by id alone', async () => {
    mock.onPatch('/expenses/e1').reply(200, { ...row, amount: '1300.00' });

    const { result } = renderHook(() => useUpdateDayExpenseMutation(), { wrapper });
    result.current.mutate({ id: 'e1', amount: '1300.00' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(JSON.parse(mock.history.patch[0].data as string)).toEqual({ amount: '1300.00' });
  });

  it('deletes a line by id', async () => {
    mock.onDelete('/expenses/e1').reply(204);

    const { result } = renderHook(() => useDeleteDayExpenseMutation(), { wrapper });
    result.current.mutate({ id: 'e1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mock.history.delete[0].url).toBe('/expenses/e1');
  });

  // A витрата moves expenses_amount, basket, per_kg, expenses_per_kg and
  // every basket_share — refreshing only the list would leave the
  // собівартість on screen contradicting the line just typed under it. Each
  // of the three mutations below proves it invalidates BOTH keys; this is
  // three separate `it`s (not one `it.each` table) because the three hooks
  // take three different input types and TS unifies an `it.each` table
  // against its first row's type, which made the update/delete rows fail
  // `tsc -b` against `CreateDayExpenseInput`.
  it('invalidates BOTH the expenses and the собівартість after create', async () => {
    mock.onPost('/shifts/s1/expenses').reply(201, row);
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useCreateDayExpenseMutation(), { wrapper });
    result.current.mutate({ shiftId: 's1', label: 'пальне', amount: '1000.00' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const keys = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toContainEqual(queryKeys.dayExpenses);
    expect(keys).toContainEqual(queryKeys.costOfDay);
  });

  it('invalidates BOTH the expenses and the собівартість after update', async () => {
    mock.onPatch('/expenses/e1').reply(200, row);
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateDayExpenseMutation(), { wrapper });
    result.current.mutate({ id: 'e1', amount: '1300.00' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const keys = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toContainEqual(queryKeys.dayExpenses);
    expect(keys).toContainEqual(queryKeys.costOfDay);
  });

  it('invalidates BOTH the expenses and the собівартість after delete', async () => {
    mock.onDelete('/expenses/e1').reply(204);
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useDeleteDayExpenseMutation(), { wrapper });
    result.current.mutate({ id: 'e1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const keys = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toContainEqual(queryKeys.dayExpenses);
    expect(keys).toContainEqual(queryKeys.costOfDay);
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ReactNode } from 'react';
import { httpClient, attachAuthInterceptors } from '@/shared/api';
import { useStaffQuery } from './useStaff';

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

describe('useStaffQuery', () => {
  it('maps user ids to display names', async () => {
    mock.onGet('/users', { params: { limit: 100, include_inactive: true } }).reply(200, {
      data: [
        { id: 'u1', first_name: 'Оксана', last_name: 'Гайова', login: 'oksana' },
        { id: 'u2', first_name: 'Dev', last_name: 'Admin', login: 'admin' },
      ],
      total: 2,
      page: 1,
      limit: 100,
    });

    const { result } = renderHook(() => useStaffQuery(true), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.get('u1')).toBe('Оксана Гайова');
    expect(result.current.data?.get('u2')).toBe('Dev Admin');
  });

  it('falls back to the login when a name was never filled in', async () => {
    // first_name/last_name are NOT NULL columns (backend UserResponse), so an
    // unfilled name arrives as '', never null — confirmed against the real DTO,
    // not assumed from the brief.
    mock.onGet('/users', { params: { limit: 100, include_inactive: true } }).reply(200, {
      data: [{ id: 'u2', first_name: '', last_name: '', login: 'admin' }],
      total: 1,
      page: 1,
      limit: 100,
    });

    const { result } = renderHook(() => useStaffQuery(true), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.get('u2')).toBe('admin');
  });

  it('falls back to the login when a name is whitespace-only', async () => {
    // NOT NULL doesn't mean non-empty, and ' ' is truthy — this is the same
    // failure mode the login fallback exists to prevent, just via a name that
    // survives a bare `filter(Boolean)` instead of one that never arrives.
    mock.onGet('/users', { params: { limit: 100, include_inactive: true } }).reply(200, {
      data: [{ id: 'u3', first_name: ' ', last_name: ' ', login: 'oksana' }],
      total: 1,
      page: 1,
      limit: 100,
    });

    const { result } = renderHook(() => useStaffQuery(true), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.get('u3')).toBe('oksana');
  });

  it('asks for inactive staff too — a document may name someone who has since left', async () => {
    mock.onGet('/users', { params: { limit: 100, include_inactive: true } }).reply(200, {
      data: [{ id: 'u4', first_name: 'Іван', last_name: 'Коваль', login: 'ivan' }],
      total: 1,
      page: 1,
      limit: 100,
    });

    renderHook(() => useStaffQuery(true), { wrapper });

    await waitFor(() => expect(mock.history.get).toHaveLength(1));
    expect(mock.history.get[0].params).toEqual({ limit: 100, include_inactive: true });
  });

  it('does not fire for someone not allowed to read it', () => {
    const { result } = renderHook(() => useStaffQuery(false), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mock.history.get).toHaveLength(0);
  });
});

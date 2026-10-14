import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ReactNode } from 'react';
import { httpClient, attachAuthInterceptors } from '@/shared/api';
import { useNetworkSettingsQuery } from './useNetworkSettingsQuery';

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

describe('useNetworkSettingsQuery', () => {
  it('bounds the read, so a stalled request cannot hold the receipt’s Print button', async () => {
    mock.onGet('/network-settings').reply(200, { receipt_note: null, updated_at: 'x' });

    const { result } = renderHook(() => useNetworkSettingsQuery(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mock.history.get[0]?.timeout).toBeGreaterThan(0);
  });
});

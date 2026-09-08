import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ReactNode } from 'react';
import { httpClient, attachAuthInterceptors } from '@/shared/api';
import { useIntakePreview } from './useIntakePreview';
import type { IntakeFormValues } from '../model/intakeForm';

// Attached once at module scope so a mocked 400/409 body surfaces as the
// `ApiError` `apiErrorToFields` branches on, not a bare AxiosError — same
// reasoning as `entities/shift/api/useShifts.test.tsx`.
attachAuthInterceptors(httpClient, { getToken: () => null, onUnauthorized: () => {} });

let mock: MockAdapter;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

const emptyValues: IntakeFormValues = { code: '', supplier_id: '', items: [] };

const line = (overrides: Partial<IntakeFormValues['items'][number]> = {}) => ({
  product_grade_id: 'g1',
  gross_kg: '100',
  pallet_kg: '0.00',
  bonus: '0.00',
  tare: [{ tare_type_id: 't1', units: '1' }],
  ...overrides,
});

const previewableValues = (grossKg: string): IntakeFormValues => ({
  code: '',
  supplier_id: 's1',
  items: [line({ gross_kg: grossKg })],
});

const previewResponse = (amount: string) => ({
  collection_point_id: 'p1',
  supplier_id: 's1',
  business_date: '2026-09-08',
  amount,
  items: [
    {
      item_order: 1,
      product_grade_id: 'g1',
      gross_kg: '100.00',
      pallet_kg: '0.00',
      tare_weight_kg: '1.00',
      net_kg: '99.00',
      price: '10.00',
      bonus: '0.00',
      amount,
      tare: [{ tare_type_id: 't1', units: 1 }],
    },
  ],
});

beforeEach(() => {
  mock = new MockAdapter(httpClient);
  vi.useFakeTimers();
});
afterEach(() => {
  mock.restore();
  vi.useRealTimers();
});

describe('useIntakePreview', () => {
  it('never calls the server while the form is not previewable', async () => {
    mock.onPost('/intakes/preview').reply(200, previewResponse('990.00'));
    const { result } = renderHook(() => useIntakePreview(emptyValues, null, { enabled: true }), {
      wrapper,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(mock.history.post.length).toBe(0);
    expect(result.current.preview).toBeNull();
  });

  it('fires once, 250ms after the last of two rapid edits', async () => {
    mock.onPost('/intakes/preview').reply(200, previewResponse('990.00'));
    const { result, rerender } = renderHook(
      ({ values }) => useIntakePreview(values, null, { enabled: true }),
      { wrapper, initialProps: { values: emptyValues } },
    );

    rerender({ values: previewableValues('100') });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(mock.history.post.length).toBe(0);

    // A second edit before the first settles restarts the debounce window.
    rerender({ values: previewableValues('126.40') });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(mock.history.post.length).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });

    expect(mock.history.post.length).toBe(1);
    expect(JSON.parse(mock.history.post[0].data)).toEqual({
      supplier_id: 's1',
      items: [
        {
          product_grade_id: 'g1',
          gross_kg: '126.40',
          pallet_kg: '0.00',
          bonus: '0.00',
          tare: [{ tare_type_id: 't1', units: 1 }],
        },
      ],
    });
    // The mocked response resolves via a plain microtask (no fake timer
    // involved once the request is sent), so give it one more turn to flow
    // through the `.then` handler and into state before asserting.
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.preview?.amount).toBe('990.00');
  });

  it('discards a stale response that resolves after a newer one', async () => {
    let resolveFirst!: (value: [number, unknown]) => void;
    let resolveSecond!: (value: [number, unknown]) => void;
    mock.onPost('/intakes/preview').replyOnce(() => new Promise((r) => (resolveFirst = r)));
    mock.onPost('/intakes/preview').replyOnce(() => new Promise((r) => (resolveSecond = r)));

    const { result, rerender } = renderHook(
      ({ values }) => useIntakePreview(values, null, { enabled: true }),
      { wrapper, initialProps: { values: previewableValues('100') } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(mock.history.post.length).toBe(1);

    rerender({ values: previewableValues('200') });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(mock.history.post.length).toBe(2);

    // The NEWER request settles first.
    await act(async () => {
      resolveSecond([200, previewResponse('2000.00')]);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.preview?.amount).toBe('2000.00');

    // The OLDER (stale) request settles after — must not overwrite it.
    await act(async () => {
      resolveFirst([200, previewResponse('1000.00')]);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.preview?.amount).toBe('2000.00');
  });

  it('maps a 400 business-rule refusal onto `error`', async () => {
    mock.onPost('/intakes/preview').reply(400, { message: 'no price', code: 'GRADE_NOT_PRICED' });

    const { result } = renderHook(
      () => useIntakePreview(previewableValues('100'), null, { enabled: true }),
      { wrapper },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.error?.fieldErrors).toEqual([
      { field: 'items.0.product_grade_id', messageKey: 'reception.errors.gradeNotPriced' },
    ]);
    expect(result.current.isPending).toBe(false);
  });

  it('does not fire when disabled, even if previewable', async () => {
    mock.onPost('/intakes/preview').reply(200, previewResponse('990.00'));
    renderHook(() => useIntakePreview(previewableValues('100'), null, { enabled: false }), {
      wrapper,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(mock.history.post.length).toBe(0);
  });
});

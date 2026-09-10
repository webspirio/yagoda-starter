import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import { httpClient } from '@/shared/api';
import type { Transfer } from '@/entities/transfer';
import { ResolveTransferDialog } from './ResolveTransferDialog';

const disputed: Transfer = {
  id: 't1',
  collection_point_id: 'p1',
  cash: '50000.00',
  crates: 120,
  carrier: 'Петро',
  sent_by_user_id: 'u-owner',
  sent_at: '2026-09-10T08:00:00Z',
  status: 'disputed',
  accepted_by_user_id: 'u-op',
  accepted_date: '2026-09-10',
  accepted_at: '2026-09-10T09:00:00Z',
  reported_cash: '49500.00',
  reported_crates: 118,
  dispute_note: 'Двох ящиків не було',
  resolved_cash: null,
  resolved_crates: null,
  resolved_by_user_id: null,
  resolved_at: null,
  cash_discrepancy: '500.00',
  crates_discrepancy: 2,
  correction_of_transfer_id: null,
  voided_at: null,
  voided_by_user_id: null,
  void_reason: null,
  created_at: '2026-09-10T08:00:00Z',
};

let mock: MockAdapter;
afterEach(() => mock?.restore());

function setup(onClose = () => {}) {
  mock = new MockAdapter(httpClient);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ResolveTransferDialog transfer={disputed} open onClose={onClose} />
    </QueryClientProvider>,
  );
  return { mock, queryClient };
}

describe('ResolveTransferDialog', () => {
  it('defaults to what the point reported — the owner confirms or overrides', () => {
    // Дефолт саме reported_*: доки спір не вирішено, каса точки й так рахує
    // ЇЇ ВЛАСНЕ число (§7.9, ред. 09.09.2026). Дефолт, що дорівнює
    // відправленому, тихо переписав би цю суму.
    setup();
    expect(screen.getByLabelText(/resolved|Зараховуємо/i)).toHaveValue('49500.00');
  });

  it('defaults the crates field to what the point reported too', () => {
    setup();
    expect(screen.getByLabelText(/crates|ящик/i)).toHaveValue('118');
  });

  it('submits the (possibly overridden) figures', async () => {
    setup();
    mock.onPost('/transfers/t1/resolve').reply(200, { ...disputed, resolved_at: 'now' });

    const cashField = screen.getByLabelText(/resolved|Зараховуємо/i);
    await userEvent.clear(cashField);
    await userEvent.type(cashField, '50000.00');
    await userEvent.click(screen.getByRole('button', { name: /resolve|save|submit|Врегулювати|Зберегти/i }));

    await waitFor(() => expect(mock.history.post).toHaveLength(1));
    expect(JSON.parse(mock.history.post[0].data as string)).toEqual({
      resolved_cash: '50000.00',
      resolved_crates: 118,
    });
  });
});

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import { httpClient } from '@/shared/api';
import { formatUah } from '@/shared/lib/money';
import type { Transfer } from '@/entities/transfer';
import { DisputeTransferDialog } from './DisputeTransferDialog';

const sent: Transfer = {
  id: 't1',
  collection_point_id: 'p1',
  cash: '50000.00',
  crates: 120,
  carrier: 'Петро',
  sent_by_user_id: 'u-owner',
  sent_at: '2026-09-10T08:00:00Z',
  status: 'sent',
  accepted_by_user_id: null,
  accepted_date: null,
  accepted_at: null,
  reported_cash: null,
  reported_crates: null,
  dispute_note: null,
  resolved_cash: null,
  resolved_crates: null,
  resolved_by_user_id: null,
  resolved_at: null,
  cash_discrepancy: null,
  crates_discrepancy: null,
  correction_of_transfer_id: null,
  voided_at: null,
  voided_by_user_id: null,
  void_reason: null,
  created_at: '2026-09-10T08:00:00Z',
};

const SUBMIT = /submit|Надіслати/i;

let mock: MockAdapter;
afterEach(() => mock?.restore());

function setup(onClose = () => {}, transfer: Transfer = sent) {
  mock = new MockAdapter(httpClient);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <DisputeTransferDialog transfer={transfer} open onClose={onClose} />
    </QueryClientProvider>,
  );
  return { mock, queryClient };
}

describe('DisputeTransferDialog', () => {
  it('shows what was sent — this is reconciliation against a delivery note, not a blind control', () => {
    setup();
    expect(screen.getByText(new RegExp(formatUah(sent.cash, 'en')))).toBeInTheDocument();
    expect(screen.getByText(/120/)).toBeInTheDocument();
  });

  it('shows «1 crate», not «1 crates», when exactly one crate was sent', () => {
    setup(() => {}, { ...sent, crates: 1 });
    expect(screen.getByText(/1 crate$/)).toBeInTheDocument();
  });

  it('shows «5 crates» when several were sent', () => {
    setup(() => {}, { ...sent, crates: 5 });
    expect(screen.getByText(/5 crates$/)).toBeInTheDocument();
  });

  it('requires a note — the discrepancy is what the owner reads', async () => {
    setup();
    await userEvent.type(screen.getByLabelText(/reported|Нарахували/i), '49500');
    await userEvent.click(screen.getByRole('button', { name: SUBMIT }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('submits the counted figures and note', async () => {
    setup();
    mock.onPost('/transfers/t1/dispute').reply(200, { ...sent, status: 'disputed' });

    await userEvent.type(screen.getByLabelText(/reported|Нарахували/i), '49500');
    await userEvent.type(screen.getByLabelText(/note|сходиться/i), 'Двох ящиків не було');
    await userEvent.click(screen.getByRole('button', { name: SUBMIT }));

    await waitFor(() => expect(mock.history.post).toHaveLength(1));
    expect(JSON.parse(mock.history.post[0].data as string)).toEqual({
      reported_cash: '49500',
      reported_crates: 120,
      dispute_note: 'Двох ящиків не було',
    });
  });
});

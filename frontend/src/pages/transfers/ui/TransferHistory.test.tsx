import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../../test-axe';
import type { Transfer } from '@/entities/transfer';
import { TransferHistory } from './TransferHistory';

const transfer = (over: Partial<Transfer> = {}): Transfer => ({
  id: 't1',
  collection_point_id: 'p1',
  cash: '500.00',
  crates: 20,
  carrier: 'Petro',
  sent_by_user_id: 'u-owner',
  sent_at: '2026-09-10T08:00:00.000Z',
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
  created_at: '2026-09-10T08:00:00.000Z',
  ...over,
});

const noop = () => {};

describe('TransferHistory', () => {
  it('shows an empty state when nothing has been sent yet', () => {
    render(<TransferHistory transfers={[]} pointName={() => '—'} onVoid={noop} />);
    expect(screen.getByText('No transfers sent yet.')).toBeInTheDocument();
  });

  it('lists each transfer with its point, amounts, carrier and status', () => {
    render(
      <TransferHistory
        transfers={[transfer({ status: 'accepted', cash: '750.00', crates: 30, carrier: 'Ihor' })]}
        pointName={(id) => (id === 'p1' ? 'Shypynky' : id)}
        onVoid={noop}
      />,
    );

    expect(screen.getByText('Shypynky')).toBeInTheDocument();
    expect(screen.getByText('750.00 ₴')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('Ihor')).toBeInTheDocument();
    expect(screen.getByText('Accepted')).toBeInTheDocument();
  });

  it('offers to void every listed transfer', async () => {
    const user = userEvent.setup();
    const onVoid = vi.fn();
    const t = transfer({ id: 't7' });
    render(<TransferHistory transfers={[t]} pointName={() => 'Shypynky'} onVoid={onVoid} />);

    await user.click(screen.getByRole('button', { name: 'Void' }));
    expect(onVoid).toHaveBeenCalledWith(t);
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <TransferHistory transfers={[transfer()]} pointName={() => 'Shypynky'} onVoid={noop} />,
    );
    await expectNoAxeViolations(container);
  });
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../../test-axe';
import type { PointCashRow } from '@/entities/point-cash';
import type { Transfer } from '@/entities/transfer';
import { PointDebtTable } from './PointDebtTable';

const row = (over: Partial<PointCashRow> = {}): PointCashRow => ({
  collection_point_id: 'p1',
  name: 'Shypynky',
  target_cash: '5000.00',
  cash: '1000.00',
  shortfall: '4000.00',
  unexplained_difference: '0.00',
  latest_transfer: null,
  ...over,
});

const transfer = (over: Partial<Transfer> = {}): Transfer => ({
  id: 't1',
  collection_point_id: 'p1',
  cash: '500.00',
  crates: 20,
  carrier: 'Petro',
  sent_by_user_id: 'u-owner',
  sent_at: '2026-09-10T08:00:00.000Z',
  status: 'disputed',
  accepted_by_user_id: 'u-op',
  accepted_date: '2026-09-10',
  accepted_at: '2026-09-10T09:00:00.000Z',
  reported_cash: '450.00',
  reported_crates: 18,
  dispute_note: 'Порахували менше',
  resolved_cash: null,
  resolved_crates: null,
  resolved_by_user_id: null,
  resolved_at: null,
  cash_discrepancy: '50.00',
  crates_discrepancy: 2,
  correction_of_transfer_id: null,
  voided_at: null,
  voided_by_user_id: null,
  void_reason: null,
  created_at: '2026-09-10T08:00:00.000Z',
  ...over,
});

const noop = () => {};

describe('PointDebtTable — honesty rule: null target/shortfall render «—», never 0', () => {
  it('prints «—» for a point with no target and no shortfall', () => {
    render(
      <PointDebtTable
        rows={[row({ target_cash: null, shortfall: null })]}
        disputedTransfers={[]}
        onSend={noop}
        onResolve={noop}
      />,
    );

    // Both the target and shortfall columns are «—» — there are two such cells.
    expect(screen.getAllByRole('cell', { name: '—' })).toHaveLength(2);
    expect(screen.queryByText('0.00 ₴')).toBeNull();
  });

  it('prints the actual amounts when target and shortfall are assigned', () => {
    render(
      <PointDebtTable
        rows={[row({ target_cash: '5000.00', shortfall: '250.00' })]}
        disputedTransfers={[]}
        onSend={noop}
        onResolve={noop}
      />,
    );

    expect(screen.getByText('5,000.00 ₴')).toBeInTheDocument();
    expect(screen.getByText('250.00 ₴')).toBeInTheDocument();
  });
});

describe('PointDebtTable — the crates column has no backing tables', () => {
  it('puts a labelled placeholder in the crates column, not a zero', async () => {
    render(<PointDebtTable rows={[row()]} disputedTransfers={[]} onSend={noop} onResolve={noop} />);

    const cell = (await screen.findAllByRole('note'))[0];
    expect(cell).toBeInTheDocument();
    expect(screen.queryByText('0 ящ.')).toBeNull();
    expect(screen.queryByText('0')).toBeNull();
  });
});

describe('PointDebtTable — the status column', () => {
  it('shows the badge of the latest transfer, and nothing when there is none', () => {
    render(
      <PointDebtTable
        rows={[
          row({ collection_point_id: 'p1', latest_transfer: { status: 'sent', sent_at: '2026-09-10T08:00:00.000Z' } }),
          row({ collection_point_id: 'p2', name: 'Haiove', latest_transfer: null }),
        ]}
        disputedTransfers={[]}
        onSend={noop}
        onResolve={noop}
      />,
    );

    expect(screen.getByText('In transit')).toBeInTheDocument();
    expect(screen.queryByText('Accepted')).toBeNull();
    expect(screen.queryByText("Doesn't match")).toBeNull();
  });

  it('offers «Вирішити» only on a disputed transfer', () => {
    const { rerender } = render(
      <PointDebtTable
        rows={[row({ latest_transfer: { status: 'sent', sent_at: '2026-09-10T08:00:00.000Z' } })]}
        disputedTransfers={[]}
        onSend={noop}
        onResolve={noop}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull();

    rerender(
      <PointDebtTable
        rows={[row({ latest_transfer: { status: 'accepted', sent_at: '2026-09-10T08:00:00.000Z' } })]}
        disputedTransfers={[]}
        onSend={noop}
        onResolve={noop}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull();

    rerender(
      <PointDebtTable
        rows={[
          row({
            latest_transfer: { status: 'disputed', sent_at: '2026-09-10T08:00:00.000Z' },
          }),
        ]}
        disputedTransfers={[transfer({ sent_at: '2026-09-10T08:00:00.000Z' })]}
        onSend={noop}
        onResolve={noop}
      />,
    );
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeInTheDocument();
  });

  it('calls onResolve with the full disputed transfer, matched by point and sent time', async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    const disputed = transfer({ id: 't9', sent_at: '2026-09-10T08:00:00.000Z' });

    render(
      <PointDebtTable
        rows={[row({ latest_transfer: { status: 'disputed', sent_at: '2026-09-10T08:00:00.000Z' } })]}
        disputedTransfers={[disputed]}
        onSend={noop}
        onResolve={onResolve}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(onResolve).toHaveBeenCalledWith(disputed);
  });

  it('always offers to send a transfer, badge or not', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(
      <PointDebtTable
        rows={[row({ collection_point_id: 'p1', name: 'Shypynky', latest_transfer: null })]}
        disputedTransfers={[]}
        onSend={onSend}
        onResolve={noop}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith('p1', 'Shypynky');
  });
});

describe('PointDebtTable — accessibility', () => {
  it('has no axe violations', async () => {
    const { container } = render(
      <PointDebtTable
        rows={[
          row({ latest_transfer: { status: 'disputed', sent_at: '2026-09-10T08:00:00.000Z' } }),
        ]}
        disputedTransfers={[transfer({ sent_at: '2026-09-10T08:00:00.000Z' })]}
        onSend={noop}
        onResolve={noop}
      />,
    );
    await expectNoAxeViolations(container);
  });
});

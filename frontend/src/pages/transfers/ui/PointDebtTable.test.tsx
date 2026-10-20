import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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
  crate_deposits: '0.00',
  crate_deposit_units: 0,
  crate_cash: null,
  crate_unexplained_difference: '0.00',
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
        unresolvedDisputes={[]}
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
        unresolvedDisputes={[]}
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
    render(<PointDebtTable rows={[row()]} unresolvedDisputes={[]} onSend={noop} onResolve={noop} />);

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
          row({ collection_point_id: 'p1', latest_transfer: { status: 'sent', sent_at: '2026-09-10T08:00:00.000Z', resolved_at: null } }),
          row({ collection_point_id: 'p2', name: 'Haiove', latest_transfer: null }),
        ]}
        unresolvedDisputes={[]}
        onSend={noop}
        onResolve={noop}
      />,
    );

    expect(screen.getByText('In transit')).toBeInTheDocument();
    expect(screen.queryByText('Accepted')).toBeNull();
    expect(screen.queryByText("Doesn't match")).toBeNull();
  });

  it('offers «Вирішити» only when the point has an unresolved dispute', () => {
    // Gate is on `unresolvedDisputes` matched by point id (fix round 1,
    // finding 4) — `latest_transfer` here is deliberately left `null` on
    // every render so this test cannot pass by accident of the badge logic.
    const { rerender } = render(
      <PointDebtTable
        rows={[row({ collection_point_id: 'p1', latest_transfer: null })]}
        unresolvedDisputes={[]}
        onSend={noop}
        onResolve={noop}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull();

    rerender(
      <PointDebtTable
        rows={[row({ collection_point_id: 'p1', latest_transfer: null })]}
        // A dispute exists, but at a DIFFERENT point — must not leak in.
        unresolvedDisputes={[transfer({ collection_point_id: 'p2' })]}
        onSend={noop}
        onResolve={noop}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull();

    rerender(
      <PointDebtTable
        rows={[row({ collection_point_id: 'p1', latest_transfer: null })]}
        unresolvedDisputes={[transfer({ collection_point_id: 'p1' })]}
        onSend={noop}
        onResolve={noop}
      />,
    );
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeInTheDocument();
  });

  it('does NOT offer «Вирішити» once resolved, even though status stays disputed forever', () => {
    // `resolve()` never touches `status` (transfers.service.ts) — the badge
    // can still say «Doesn't match» here (`latest_transfer` has no
    // `resolved_at` to know better), but the page is expected to have
    // already dropped this point's transfer out of `unresolvedDisputes`
    // once it was resolved, and the button must follow that, not the badge.
    render(
      <PointDebtTable
        rows={[
          row({
            collection_point_id: 'p1',
            latest_transfer: { status: 'disputed', sent_at: '2026-09-10T08:00:00.000Z', resolved_at: null },
          }),
        ]}
        unresolvedDisputes={[]}
        onSend={noop}
        onResolve={noop}
      />,
    );

    expect(screen.getByText("Doesn't match")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull();
  });

  it('calls onResolve with the full disputed transfer, matched by point id alone', async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    // `sent_at` deliberately does NOT match the row's `latest_transfer.sent_at`
    // — proves the match is by `collection_point_id` only, not a cross-endpoint
    // timestamp comparison.
    const disputed = transfer({ id: 't9', collection_point_id: 'p1', sent_at: '2026-01-01T00:00:00.000Z' });

    render(
      <PointDebtTable
        rows={[
          row({
            collection_point_id: 'p1',
            latest_transfer: { status: 'accepted', sent_at: '2026-09-10T08:00:00.000Z', resolved_at: null },
          }),
        ]}
        unresolvedDisputes={[disputed]}
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
        unresolvedDisputes={[]}
        onSend={onSend}
        onResolve={noop}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith('p1', 'Shypynky');
  });
});

describe('PointDebtTable — the point badge (#76)', () => {
  it('reads «Doesn\'t match» for a point with one open dispute, beside its newer latest transfer', () => {
    render(
      <PointDebtTable
        rows={[
          row({
            latest_transfer: { status: 'accepted', sent_at: '2026-09-12T08:00:00.000Z', resolved_at: null },
          }),
        ]}
        unresolvedDisputes={[transfer()]}
        onSend={noop}
        onResolve={noop}
      />,
    );

    expect(screen.getByText("Doesn't match")).toBeInTheDocument();
    // A newer transfer's own status stays visible next to the dispute.
    expect(screen.getByText('Accepted')).toBeInTheDocument();
  });

  it('keeps a newer transfer «In transit» beside one open dispute', () => {
    render(
      <PointDebtTable
        rows={[row({ latest_transfer: { status: 'sent', sent_at: '2026-09-12T08:00:00.000Z', resolved_at: null } })]}
        unresolvedDisputes={[transfer()]}
        onSend={noop}
        onResolve={noop}
      />,
    );

    expect(screen.getByText('In transit')).toBeInTheDocument();
    expect(screen.getByText("Doesn't match")).toBeInTheDocument();
  });

  it('keeps a newer transfer «In transit» beside several open disputes', () => {
    render(
      <PointDebtTable
        rows={[row({ latest_transfer: { status: 'sent', sent_at: '2026-09-12T08:00:00.000Z', resolved_at: null } })]}
        unresolvedDisputes={[transfer({ id: 'a' }), transfer({ id: 'b' })]}
        onSend={noop}
        onResolve={noop}
      />,
    );

    expect(screen.getByText('In transit')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Doesn't match (2)" })).toBeInTheDocument();
  });

  it('keeps a newer, already settled dispute «Resolved» beside an older open one', () => {
    render(
      <PointDebtTable
        rows={[
          row({
            latest_transfer: {
              status: 'disputed',
              sent_at: '2026-09-12T08:00:00.000Z',
              resolved_at: '2026-09-12T10:00:00.000Z',
            },
          }),
        ]}
        unresolvedDisputes={[transfer()]}
        onSend={noop}
        onResolve={noop}
      />,
    );

    expect(screen.getByText("Doesn't match")).toBeInTheDocument();
    expect(screen.getByText('Resolved')).toBeInTheDocument();
  });

  it('does not repeat the disputed badge when the latest transfer IS the open dispute', () => {
    render(
      <PointDebtTable
        rows={[row({ latest_transfer: { status: 'disputed', sent_at: '2026-09-10T08:00:00.000Z', resolved_at: null } })]}
        unresolvedDisputes={[transfer()]}
        onSend={noop}
        onResolve={noop}
      />,
    );

    expect(screen.getAllByText("Doesn't match")).toHaveLength(1);
  });

  it('reads «Resolved» when the latest transfer is a dispute the owner already settled', () => {
    render(
      <PointDebtTable
        rows={[
          row({
            latest_transfer: {
              status: 'disputed',
              sent_at: '2026-09-10T08:00:00.000Z',
              resolved_at: '2026-09-11T09:00:00.000Z',
            },
          }),
        ]}
        unresolvedDisputes={[]}
        onSend={noop}
        onResolve={noop}
      />,
    );

    expect(screen.getByText('Resolved')).toBeInTheDocument();
    expect(screen.queryByText("Doesn't match")).toBeNull();
  });
});

describe('PointDebtTable — a point with one open dispute (#76)', () => {
  it('keeps the inline «Resolve» and is not expandable', () => {
    render(
      <PointDebtTable rows={[row()]} unresolvedDisputes={[transfer()]} onSend={noop} onResolve={noop} />,
    );

    expect(screen.getByRole('button', { name: 'Resolve' })).toBeInTheDocument();
    expect(document.querySelector('[aria-expanded]')).toBeNull();
  });
});

describe('PointDebtTable — a point with several open disputes (#76)', () => {
  const three = [
    transfer({ id: 'old', sent_at: '2026-09-08T08:00:00.000Z', cash: '100.00', reported_cash: '90.00', cash_discrepancy: '10.00' }),
    transfer({ id: 'new', sent_at: '2026-09-12T08:00:00.000Z', cash: '300.00', reported_cash: '270.00', cash_discrepancy: '30.00' }),
    transfer({ id: 'mid', sent_at: '2026-09-10T08:00:00.000Z', cash: '200.00', reported_cash: '180.00', cash_discrepancy: '20.00' }),
  ];

  it('shows the count on a collapsed toggle badge instead of an inline «Resolve»', () => {
    render(<PointDebtTable rows={[row()]} unresolvedDisputes={three} onSend={noop} onResolve={noop} />);

    const toggle = screen.getByRole('button', { name: "Doesn't match (3)" });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull();
  });

  it('expands to every dispute, newest first, each with its own «Resolve»', async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    render(<PointDebtTable rows={[row()]} unresolvedDisputes={three} onSend={noop} onResolve={onResolve} />);

    await user.click(screen.getByRole('button', { name: "Doesn't match (3)" }));
    expect(screen.getByRole('button', { name: "Doesn't match (3)" })).toHaveAttribute('aria-expanded', 'true');

    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('300.00 ₴');
    expect(items[1]).toHaveTextContent('200.00 ₴');
    expect(items[2]).toHaveTextContent('100.00 ₴');

    await user.click(within(items[1]).getByRole('button', { name: 'Resolve' }));
    expect(onResolve).toHaveBeenCalledWith(three[2]);
  });

  it('collapses again on a second click', async () => {
    const user = userEvent.setup();
    render(<PointDebtTable rows={[row()]} unresolvedDisputes={three} onSend={noop} onResolve={noop} />);

    const toggle = screen.getByRole('button', { name: "Doesn't match (3)" });
    await user.click(toggle);
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('toggles on a click anywhere in the row, but not on «Send»', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<PointDebtTable rows={[row()]} unresolvedDisputes={three} onSend={onSend} onResolve={noop} />);

    await user.click(screen.getByText('Shypynky'));
    expect(screen.getByRole('list')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalled();
    expect(screen.getByRole('list')).toBeInTheDocument();
  });

  it('does not collapse when a dispute\'s own «Resolve» is clicked', async () => {
    const user = userEvent.setup();
    render(<PointDebtTable rows={[row()]} unresolvedDisputes={three} onSend={noop} onResolve={noop} />);

    await user.click(screen.getByRole('button', { name: "Doesn't match (3)" }));
    await user.click(screen.getAllByRole('button', { name: 'Resolve' })[0]);
    expect(screen.getByRole('list')).toBeInTheDocument();
  });

  it('shows a dispute\'s reported cash, the difference, the crates and the point\'s note', async () => {
    const user = userEvent.setup();
    render(
      <PointDebtTable
        rows={[row()]}
        unresolvedDisputes={[
          transfer({ id: 'a', cash: '500.00', reported_cash: '450.00', cash_discrepancy: '50.00', crates: 20, reported_crates: 18, crates_discrepancy: 2, dispute_note: 'Порахували менше' }),
          transfer({ id: 'b', sent_at: '2026-09-01T08:00:00.000Z', cash_discrepancy: '0.00', crates_discrepancy: 0, dispute_note: null }),
        ]}
        onSend={noop}
        onResolve={noop}
      />,
    );

    await user.click(screen.getByRole('button', { name: "Doesn't match (2)" }));
    const [first, second] = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(first).toHaveTextContent('450.00 ₴');
    expect(within(first).getByText('50.00 ₴')).toHaveClass('text-destructive');
    expect(first).toHaveTextContent('Crates: sent 20 · counted 18 · difference 2');
    expect(first).toHaveTextContent('Порахували менше');
    expect(within(second).getByText('0.00 ₴')).not.toHaveClass('text-destructive');
    expect(second).not.toHaveTextContent('Crates:');
  });

  it('keeps only one point open at a time', async () => {
    const user = userEvent.setup();
    render(
      <PointDebtTable
        rows={[row({ collection_point_id: 'p1' }), row({ collection_point_id: 'p2', name: 'Haiove' })]}
        unresolvedDisputes={[
          transfer({ id: 'a1', collection_point_id: 'p1' }),
          transfer({ id: 'a2', collection_point_id: 'p1' }),
          transfer({ id: 'b1', collection_point_id: 'p2' }),
          transfer({ id: 'b2', collection_point_id: 'p2' }),
        ]}
        onSend={noop}
        onResolve={noop}
      />,
    );

    const [p1, p2] = screen.getAllByRole('button', { name: "Doesn't match (2)" });
    await user.click(p1);
    await user.click(p2);
    expect(p1).toHaveAttribute('aria-expanded', 'false');
    expect(p2).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('list')).toHaveLength(1);
  });

  it('falls back to the one-dispute layout once a refetch leaves a single dispute', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <PointDebtTable rows={[row()]} unresolvedDisputes={three.slice(0, 2)} onSend={noop} onResolve={noop} />,
    );
    await user.click(screen.getByRole('button', { name: "Doesn't match (2)" }));

    rerender(<PointDebtTable rows={[row()]} unresolvedDisputes={three.slice(0, 1)} onSend={noop} onResolve={noop} />);
    expect(screen.queryByRole('list')).toBeNull();
    expect(document.querySelector('[aria-expanded]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeInTheDocument();
  });

  it('does not re-open by itself after the point drops below two disputes and gains one again', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <PointDebtTable rows={[row()]} unresolvedDisputes={three} onSend={noop} onResolve={noop} />,
    );
    await user.click(screen.getByRole('button', { name: "Doesn't match (3)" }));
    expect(screen.getByRole('list')).toBeInTheDocument();

    rerender(<PointDebtTable rows={[row()]} unresolvedDisputes={three.slice(0, 1)} onSend={noop} onResolve={noop} />);
    rerender(<PointDebtTable rows={[row()]} unresolvedDisputes={three.slice(0, 2)} onSend={noop} onResolve={noop} />);

    expect(screen.getByRole('button', { name: "Doesn't match (2)" })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('has no axe violations while expanded', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <PointDebtTable rows={[row()]} unresolvedDisputes={three} onSend={noop} onResolve={noop} />,
    );
    await user.click(screen.getByRole('button', { name: "Doesn't match (3)" }));
    await expectNoAxeViolations(container);
  });
});

describe('PointDebtTable — accessibility', () => {
  it('has no axe violations', async () => {
    const { container } = render(
      <PointDebtTable
        rows={[
          row({ latest_transfer: { status: 'disputed', sent_at: '2026-09-10T08:00:00.000Z', resolved_at: null } }),
        ]}
        unresolvedDisputes={[transfer({ sent_at: '2026-09-10T08:00:00.000Z' })]}
        onSend={noop}
        onResolve={noop}
      />,
    );
    await expectNoAxeViolations(container);
  });
});

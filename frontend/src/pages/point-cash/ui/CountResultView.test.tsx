import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { formatUah } from '@/shared/lib/money';
import type { CashCount } from '@/entities/cash-count';
import { expectNoAxeViolations } from '../../../test-axe';
import { CountResultView } from './CountResultView';

const row = (over: Partial<CashCount> = {}): CashCount => ({
  id: 'c1',
  shift_id: 's1',
  collection_point_id: 'p1',
  business_date: '2026-09-22',
  book: 'berry',
  kind: 'opening',
  counted_amount: '1000.00',
  expected_amount: '1000.00',
  discrepancy: '0.00',
  is_open: false,
  counted_by_user_id: 'u1',
  counted_by_name: 'Olha',
  counted_at: '2026-09-22T07:00:00Z',
  explanation: null,
  ...over,
});

describe('CountResultView', () => {
  it('renders nothing without a mode', () => {
    const { container } = render(
      <CountResultView open mode={null} row={row()} onClose={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing without a matching row — waits for the counts query rather than guessing', () => {
    const { container } = render(
      <CountResultView open mode="open" row={null} onClose={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows «Shift opened» and the counted figure for the open mode, with no discrepancy pill', async () => {
    const { container } = render(
      <CountResultView open mode="open" row={row({ counted_amount: '2500.00' })} onClose={vi.fn()} />,
    );

    expect(screen.getByRole('heading', { name: 'Shift opened' })).toBeInTheDocument();
    expect(screen.getByText('Counted')).toBeInTheDocument();
    expect(screen.getByText('2,500.00 ₴')).toBeInTheDocument();
    expect(screen.queryByText('Discrepancy')).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('shows «the day matched» and a leaf pill for a settled close', () => {
    render(
      <CountResultView
        open
        mode="close"
        row={row({ kind: 'closing', counted_amount: '3000.00', discrepancy: '0.00' })}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Shift closed. The day matched.' })).toBeInTheDocument();
    expect(screen.getByText('3,000.00 ₴')).toBeInTheDocument();
    expect(screen.getByText('Discrepancy').closest('span')).toHaveClass('text-leaf');
  });

  it('names the discrepancy and warns the owner will see it, for a non-zero close', () => {
    render(
      <CountResultView
        open
        mode="close"
        row={row({ kind: 'closing', counted_amount: '2950.00', discrepancy: '-50.00' })}
        onClose={vi.fn()}
      />,
    );

    const title = `Shift closed. Discrepancy ${formatUah('-50.00', 'en')} — the owner will see it on their own list.`;
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getByText('Discrepancy').closest('span')).toHaveClass('text-destructive');
  });

  it('calls onClose from the «Done» button', async () => {
    const onClose = vi.fn();
    render(<CountResultView open mode="open" row={row()} onClose={onClose} />);

    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });
});

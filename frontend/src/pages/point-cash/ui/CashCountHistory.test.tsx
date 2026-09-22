import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CashCount } from '@/entities/cash-count';
import { CashCountHistory } from './CashCountHistory';

const { countsMock, explainMock } = vi.hoisted(() => ({
  countsMock: vi.fn(),
  explainMock: vi.fn(),
}));

vi.mock('@/entities/cash-count', () => ({
  useCashCountsQuery: (filter: unknown) => countsMock(filter),
}));

// `ExplainDiscrepancyDialog` is the real component, only its own mutation is
// stubbed — the same convention `IncomingTransfers.test.tsx` uses.
vi.mock('@/features/set-cash-explanation/api/useSetCashExplanation', () => ({
  useSetCashExplanationMutation: () => ({ mutateAsync: explainMock, isPending: false }),
}));

const count = (over: Partial<CashCount> = {}): CashCount => ({
  id: 'c1',
  shift_id: 's1',
  collection_point_id: 'p1',
  business_date: '2026-09-10',
  book: 'berry',
  kind: 'opening',
  counted_amount: '1500.00',
  expected_amount: '1500.00',
  discrepancy: '0.00',
  is_open: false,
  counted_by_user_id: 'u1',
  counted_by_name: 'Olha',
  counted_at: '2026-09-10T07:00:00Z',
  explanation: null,
  ...over,
});

const page = (data: CashCount[]) => ({
  data: { data, total: data.length, page: 1, limit: 100 },
  isPending: false,
});

beforeEach(() => {
  countsMock.mockReset().mockReturnValue(page([]));
  explainMock.mockReset().mockResolvedValue({});
});

describe('CashCountHistory', () => {
  it('asks the cash-count entity for this point', () => {
    render(<CashCountHistory pointId="p1" isOwner={false} />);
    expect(countsMock).toHaveBeenCalledWith({ pointId: 'p1' });
  });

  it('waits for the read before saying the point was never counted', () => {
    // «Цю точку ще жодного разу не рахували» is a statement about the
    // point's whole history, and an unanswered query is not evidence for it
    // — flashing it on every load teaches the reader to distrust it.
    countsMock.mockReturnValue({ data: undefined, isPending: true });

    render(<CashCountHistory pointId="p1" isOwner={false} />);

    expect(screen.queryByText('No cash counts recorded for this point yet.')).toBeNull();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('says there is no history yet rather than showing an empty table', () => {
    render(<CashCountHistory pointId="p1" isOwner={false} />);
    expect(screen.getByText('No cash counts recorded for this point yet.')).toBeInTheDocument();
  });

  it("lists a count's figures", () => {
    countsMock.mockReturnValue(page([count()]));
    render(<CashCountHistory pointId="p1" isOwner={false} />);

    expect(screen.getAllByText('1,500.00 ₴')).toHaveLength(2);
    expect(screen.getByText('0.00 ₴')).toBeInTheDocument();
  });

  it('names who counted', () => {
    countsMock.mockReturnValue(page([count({ counted_by_name: 'Olha' })]));
    render(<CashCountHistory pointId="p1" isOwner={false} />);
    expect(screen.getByText('Olha')).toBeInTheDocument();
  });

  it('shows a dash for a row recorded before names were tracked', () => {
    countsMock.mockReturnValue(page([count({ counted_by_name: null })]));
    render(<CashCountHistory pointId="p1" isOwner={false} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('offers «Explain» only to the owner, only on an open discrepancy', () => {
    countsMock.mockReturnValue(page([count({ is_open: true, discrepancy: '-40.00' })]));
    const { rerender } = render(<CashCountHistory pointId="p1" isOwner={false} />);
    expect(screen.queryByRole('button', { name: 'Explain' })).toBeNull();
    expect(screen.getByText('Unexplained')).toBeInTheDocument();

    rerender(<CashCountHistory pointId="p1" isOwner />);
    expect(screen.getByRole('button', { name: 'Explain' })).toBeInTheDocument();
  });

  it('shows an already-saved explanation instead of the button', () => {
    countsMock.mockReturnValue(
      page([count({ is_open: false, discrepancy: '-40.00', explanation: 'Double-paid a payout' })]),
    );
    render(<CashCountHistory pointId="p1" isOwner />);

    expect(screen.getByText('Double-paid a payout')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Explain' })).toBeNull();
  });

  it('opens the explain dialog scoped to that count’s shift', async () => {
    const user = userEvent.setup();
    countsMock.mockReturnValue(
      page([count({ id: 'c9', shift_id: 's9', is_open: true, discrepancy: '-40.00' })]),
    );
    render(<CashCountHistory pointId="p1" isOwner />);

    await user.click(screen.getByRole('button', { name: 'Explain' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('40.00');
  });
});

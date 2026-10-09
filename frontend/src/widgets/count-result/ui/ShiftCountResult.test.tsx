import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CashCount } from '@/entities/cash-count';
import { ShiftCountResult } from './ShiftCountResult';

const { cashCountsMock, noteMock } = vi.hoisted(() => ({ cashCountsMock: vi.fn(), noteMock: vi.fn() }));

vi.mock('@/entities/cash-count', () => ({
  useCashCountsQuery: (filter: unknown) => cashCountsMock(filter),
}));
vi.mock('@/features/set-operator-note/api/useSetOperatorNote', () => ({
  useSetOperatorNoteMutation: () => ({ mutateAsync: noteMock }),
}));

const list = (data: CashCount[]) => ({ data: { data, total: data.length, page: 1, limit: 100 } });
const count = (over: Partial<CashCount> = {}): CashCount => ({
  id: 'cl',
  shift_id: 's-old',
  collection_point_id: 'p1',
  business_date: '2026-10-07',
  book: 'berry',
  kind: 'closing',
  counted_amount: '950.00',
  expected_amount: '1000.00',
  discrepancy: '-50.00',
  is_open: true,
  counted_by_user_id: 'u1',
  counted_by_name: 'Olha',
  counted_at: '2026-10-07T17:00:00Z',
  explanation: null,
  explained: false,
  operator_note: null,
  operator_note_editable: true,
  explainable: false,
  ...over,
});

describe('ShiftCountResult', () => {
  beforeEach(() => {
    cashCountsMock.mockReset();
    noteMock.mockReset();
  });

  it('shows nothing and reads no shift before a result exists', () => {
    cashCountsMock.mockReturnValue(list([]));
    render(<ShiftCountResult result={null} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(cashCountsMock).toHaveBeenCalledWith({ shiftId: undefined });
  });

  it('reads THAT shift and opens the note form on a close the closer may explain', async () => {
    cashCountsMock.mockReturnValue(list([count()]));
    render(<ShiftCountResult result={{ mode: 'close', shiftId: 's-old' }} onClose={() => {}} />);
    expect(cashCountsMock).toHaveBeenCalledWith({ shiftId: 's-old' });
    expect(await screen.findByRole('dialog')).toHaveTextContent(/Closing discrepancy/);
    expect(await screen.findByLabelText('Your explanation')).toBeInTheDocument();
  });

  it('shows the plain result, no form, when the close agreed', async () => {
    cashCountsMock.mockReturnValue(
      list([count({ discrepancy: '0.00', counted_amount: '1000.00', is_open: false, operator_note_editable: false })]),
    );
    render(<ShiftCountResult result={{ mode: 'close', shiftId: 's-old' }} onClose={() => {}} />);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('waits out the refetch instead of showing a cached closing count the close replaced', async () => {
    const stale = count({ id: 'cl-old' });
    const fresh = count({ id: 'cl-new', counted_amount: '980.00', discrepancy: '-20.00' });
    cashCountsMock.mockReturnValue({ ...list([stale]), isFetching: true });
    const { rerender } = render(<ShiftCountResult result={{ mode: 'close', shiftId: 's-old' }} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();

    cashCountsMock.mockReturnValue({ ...list([fresh]), isFetching: false });
    rerender(<ShiftCountResult result={{ mode: 'close', shiftId: 's-old' }} onClose={() => {}} />);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/20\.00/);
    expect(dialog).not.toHaveTextContent(/50\.00/);
  });

  it('«Cancel» on the form falls back to the result, which offers the form again', async () => {
    const user = userEvent.setup();
    cashCountsMock.mockReturnValue(list([count()]));
    render(<ShiftCountResult result={{ mode: 'close', shiftId: 's-old' }} onClose={() => {}} />);
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await user.click(await screen.findByRole('button', { name: 'Explain the discrepancy' }));
    expect(await screen.findByLabelText('Your explanation')).toBeInTheDocument();
  });
});

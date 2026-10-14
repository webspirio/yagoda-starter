import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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

  describe('two books (#178)', () => {
    const crates = (over: Partial<CashCount> = {}) =>
      count({
        id: 'cc',
        book: 'crates',
        counted_amount: '640.00',
        expected_amount: '1000.00',
        discrepancy: '-360.00',
        operator_note_editable: false,
        ...over,
      });
    const berrySettled = count({
      discrepancy: '0.00',
      counted_amount: '1000.00',
      is_open: false,
      operator_note_editable: false,
    });

    it('lists Cash and Deposits separately; a deposits-only difference names the deposits in the title', async () => {
      cashCountsMock.mockReturnValue(list([berrySettled, crates()]));
      render(<ShiftCountResult result={{ mode: 'close', shiftId: 's-old' }} onClose={() => {}} />);
      const dialog = await screen.findByRole('dialog');
      expect(dialog).toHaveTextContent(/Shift closed\. Deposits discrepancy .*360\.00/);
      const cash = within(dialog).getByRole('group', { name: 'Cash' });
      const deposits = within(dialog).getByRole('group', { name: 'Deposits' });
      expect(within(cash).getByText(/Discrepancy/).closest('span')).toHaveClass('text-leaf');
      expect(within(deposits).getByText(/Discrepancy/).closest('span')).toHaveClass('text-destructive');
      expect(deposits).toHaveTextContent(/640\.00/);
      expect(screen.queryByRole('textbox')).toBeNull();
    });

    it('a deposits-only difference on an open names the deposits too', async () => {
      cashCountsMock.mockReturnValue(
        list([
          count({ kind: 'opening', discrepancy: '0.00', operator_note_editable: false }),
          crates({ kind: 'opening' }),
        ]),
      );
      render(<ShiftCountResult result={{ mode: 'open', shiftId: 's-old' }} onClose={() => {}} />);
      expect(await screen.findByRole('dialog')).toHaveTextContent(/off in deposits against the previous close/);
    });

    it('when Cash is off the title keeps the cash wording and the cash amount', async () => {
      cashCountsMock.mockReturnValue(list([count({ operator_note_editable: false }), crates()]));
      render(<ShiftCountResult result={{ mode: 'close', shiftId: 's-old' }} onClose={() => {}} />);
      const dialog = await screen.findByRole('dialog');
      expect(dialog).toHaveTextContent(/Shift closed\. Discrepancy .*50\.00 ₴ — the owner/);
      expect(dialog).not.toHaveTextContent(/Deposits discrepancy/);
    });

    it('shows each book on an open too, discrepancy and all', async () => {
      cashCountsMock.mockReturnValue(
        list([
          count({ kind: 'opening', discrepancy: '0.00', operator_note_editable: false }),
          crates({ kind: 'opening', discrepancy: '0.00', counted_amount: '1000.00' }),
        ]),
      );
      render(<ShiftCountResult result={{ mode: 'open', shiftId: 's-old' }} onClose={() => {}} />);
      const dialog = await screen.findByRole('dialog');
      expect(dialog).toHaveTextContent('Shift opened');
      expect(within(dialog).getByRole('group', { name: 'Deposits' })).toBeInTheDocument();
      expect(within(dialog).getByRole('group', { name: 'Cash' })).toBeInTheDocument();
    });

    it('offers the note for Deposits when only Deposits is off', async () => {
      cashCountsMock.mockReturnValue(list([berrySettled, crates({ operator_note_editable: true })]));
      render(<ShiftCountResult result={{ mode: 'close', shiftId: 's-old' }} onClose={() => {}} />);
      expect(await screen.findByLabelText('Your explanation')).toBeInTheDocument();
      expect(screen.getByRole('dialog')).toHaveTextContent(/Closing discrepancy .*360\.00/);
    });

    it('offers Cash first and, once it is saved, Deposits; saving that closes', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      noteMock.mockResolvedValue({});
      cashCountsMock.mockReturnValue(list([count(), crates({ operator_note_editable: true })]));
      render(<ShiftCountResult result={{ mode: 'close', shiftId: 's-old' }} onClose={onClose} />);

      await user.type(await screen.findByLabelText('Your explanation'), 'short change');
      expect(screen.getByRole('dialog')).toHaveTextContent(/Closing discrepancy .*50\.00/);
      await user.click(screen.getByRole('button', { name: 'Save explanation' }));
      expect(noteMock).toHaveBeenLastCalledWith({ countId: 'cl', operatorNote: 'short change' });
      await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent(/Closing discrepancy .*360\.00/));
      expect(onClose).not.toHaveBeenCalled();

      await user.type(screen.getByLabelText('Your explanation'), 'crates lent');
      await user.click(screen.getByRole('button', { name: 'Save explanation' }));
      expect(noteMock).toHaveBeenLastCalledWith({ countId: 'cc', operatorNote: 'crates lent' });
      await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it('«Cancel» returns to the result, which offers a note per book that takes one', async () => {
      const user = userEvent.setup();
      cashCountsMock.mockReturnValue(list([count(), crates({ operator_note_editable: true })]));
      render(<ShiftCountResult result={{ mode: 'close', shiftId: 's-old' }} onClose={() => {}} />);
      await user.click(await screen.findByRole('button', { name: 'Cancel' }));
      expect(await screen.findByRole('group', { name: 'Deposits' })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Explain the discrepancy · Deposits' }));
      expect(screen.getByRole('dialog')).toHaveTextContent(/Closing discrepancy .*360\.00/);
    });
  });
});

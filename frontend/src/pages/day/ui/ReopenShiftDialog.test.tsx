import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/shared/api';
import type { Shift } from '@/entities/shift';
import { ReopenShiftDialog } from './ReopenShiftDialog';

const { reopenMock } = vi.hoisted(() => ({ reopenMock: vi.fn() }));

vi.mock('../api/shiftActions', () => ({
  useReopenShiftMutation: () => ({ mutateAsync: reopenMock, isPending: false }),
}));

const closedShift: Shift = {
  id: 's0',
  collection_point_id: 'p1',
  business_date: '2026-09-07',
  status: 'closed',
  opened_by_user_id: 'u1',
  closed_by_user_id: 'u1',
  closed_at: '2026-09-07T18:00:00Z',
  created_at: '2026-09-07T05:00:00Z',
  explanation: null,
  broken_crates: 3,
};

function renderDialog() {
  const onClose = vi.fn();
  return { onClose, ...render(<ReopenShiftDialog shift={closedShift} open onClose={onClose} />) };
}

beforeEach(() => {
  reopenMock.mockReset().mockResolvedValue({ ...closedShift, status: 'open', closed_at: null });
});

describe('ReopenShiftDialog', () => {
  it('refuses a blank reason — the reason IS the trace a reopen leaves', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Reopen' }));

    expect(await screen.findByText('Give a reason')).toBeInTheDocument();
    expect(reopenMock).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('refuses whitespace too, so a space bar cannot pass for an explanation', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText('Reason'), '   ');
    await user.click(screen.getByRole('button', { name: 'Reopen' }));

    expect(await screen.findByText('Give a reason')).toBeInTheDocument();
    expect(reopenMock).not.toHaveBeenCalled();
  });

  it('reopens the shift by id with the trimmed reason and closes itself', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    await user.type(screen.getByLabelText('Reason'), '  Cars still arriving  ');
    await user.click(screen.getByRole('button', { name: 'Reopen' }));

    await waitFor(() =>
      expect(reopenMock).toHaveBeenCalledWith({ id: 's0', reason: 'Cars still arriving' }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('shows the mapped banner and stays open when the server refuses', async () => {
    const user = userEvent.setup();
    reopenMock.mockRejectedValue(new ApiError(409, 'nope', undefined, 'SHIFT_NOT_NEWEST'));
    const { onClose } = renderDialog();

    await user.type(screen.getByLabelText('Reason'), 'Closed by mistake');
    await user.click(screen.getByRole('button', { name: 'Reopen' }));

    expect(
      await screen.findByText("Only the point's most recent shift can be reopened"),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

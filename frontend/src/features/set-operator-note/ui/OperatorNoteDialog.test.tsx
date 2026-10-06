import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/shared/api';
import { Toaster } from '@/shared/ui/sonner';
import { expectNoAxeViolations } from '../../../test-axe';
import { OperatorNoteDialog } from './OperatorNoteDialog';

const { noteMock } = vi.hoisted(() => ({ noteMock: vi.fn() }));

vi.mock('../api/useSetOperatorNote', () => ({
  useSetOperatorNoteMutation: () => ({ mutateAsync: noteMock }),
}));

function renderDialog(initialNote: string | null = null, onClose = vi.fn()) {
  return {
    onClose,
    ...render(
      <>
        <OperatorNoteDialog shiftId="s1" discrepancy="-100.00" initialNote={initialNote} open onClose={onClose} />
        <Toaster />
      </>,
    ),
  };
}

beforeEach(() => {
  noteMock.mockReset().mockResolvedValue({ id: 's1' });
});

describe('OperatorNoteDialog', () => {
  it('names the discrepancy and says the owner decides', async () => {
    const { container } = renderDialog();
    expect(screen.getByRole('heading', { name: 'What happened? Discrepancy −100.00 ₴' })).toBeInTheDocument();
    expect(screen.getByText(/The owner reads it next to the discrepancy/)).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('prefills the current note so it can be corrected', () => {
    renderDialog('перша версія');
    expect(screen.getByLabelText('Your explanation')).toHaveValue('перша версія');
  });

  it('refuses a blank note', async () => {
    const { onClose } = renderDialog();
    await userEvent.type(screen.getByLabelText('Your explanation'), '   ');
    await userEvent.click(screen.getByRole('button', { name: 'Send to the owner' }));
    expect(await screen.findByText('Write what happened')).toBeInTheDocument();
    expect(noteMock).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('sends the trimmed note and closes', async () => {
    const { onClose } = renderDialog();
    await userEvent.type(screen.getByLabelText('Your explanation'), '  віддав решту ');
    await userEvent.click(screen.getByRole('button', { name: 'Send to the owner' }));
    expect(noteMock).toHaveBeenCalledWith({ shiftId: 's1', operatorNote: 'віддав решту' });
    expect(await screen.findByText('Your explanation was sent to the owner')).toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a stale button: the window closed meanwhile — says so and stays open', async () => {
    noteMock.mockRejectedValue(new ApiError(409, 'late', undefined, 'OPERATOR_NOTE_WINDOW_CLOSED'));
    const { onClose } = renderDialog();
    await userEvent.type(screen.getByLabelText('Your explanation'), 'причина');
    await userEvent.click(screen.getByRole('button', { name: 'Send to the owner' }));
    expect(
      await screen.findByText('The next shift is already open — the owner decides from here'),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a reopened shift: SHIFT_NOT_CLOSED reads as an operator sentence, not the reopen one', async () => {
    noteMock.mockRejectedValue(new ApiError(409, 'open', undefined, 'SHIFT_NOT_CLOSED'));
    renderDialog();
    await userEvent.type(screen.getByLabelText('Your explanation'), 'причина');
    await userEvent.click(screen.getByRole('button', { name: 'Send to the owner' }));
    expect(
      await screen.findByText('The shift is open again — explain after it is closed'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Only a closed shift can be reopened')).toBeNull();
  });
});

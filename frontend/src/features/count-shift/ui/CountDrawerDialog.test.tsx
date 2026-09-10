import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/shared/api';
import { CountDrawerDialog } from './CountDrawerDialog';

// Matches the submit button whether i18n has resolved it yet (raw key), is
// showing the Ukrainian copy, or the English one this suite's locale renders.
const SUBMIT_COUNT = /day\.count\.submit|Записати|Record/i;

function setup(onConfirm = vi.fn().mockResolvedValue(undefined), mode: 'open' | 'close' = 'open') {
  render(<CountDrawerDialog mode={mode} open onClose={() => {}} onConfirm={onConfirm} />);
  return onConfirm;
}

describe('CountDrawerDialog', () => {
  it('sends the amount normalised — a comma is how the keyboard types it', async () => {
    const onConfirm = setup();
    await userEvent.type(screen.getByRole('textbox'), '1 500,50');
    await userEvent.click(screen.getByRole('button', { name: SUBMIT_COUNT }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('1500.50'));
  });

  it('refuses to submit an empty drawer count', async () => {
    const onConfirm = setup();
    await userEvent.click(screen.getByRole('button', { name: SUBMIT_COUNT }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('never shows an expected figure — the count is a control, not a form to match', () => {
    setup();
    expect(screen.queryByText(/очікув|expected/i)).toBeNull();
  });

  it('shows the close-specific copy in close mode', () => {
    setup(undefined, 'close');
    expect(screen.getByText('Count the drawer before closing')).toBeInTheDocument();
  });

  it('shows the refusal and stays open when onConfirm rejects', async () => {
    const onConfirm = vi
      .fn()
      .mockRejectedValue(new ApiError(409, 'nope', undefined, 'SHIFT_ALREADY_OPEN'));
    const onClose = vi.fn();
    render(<CountDrawerDialog mode="open" open onClose={onClose} onConfirm={onConfirm} />);

    await userEvent.type(screen.getByRole('textbox'), '1500.00');
    await userEvent.click(screen.getByRole('button', { name: SUBMIT_COUNT }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A shift is already open at this point',
    );
    // Stays open: the caller was never told to close it, and the typed
    // amount — the one thing worth not losing on a refusal — is still there.
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveValue('1500.00');
  });

  it('clears a stale server banner as soon as the next submit is attempted', async () => {
    const onConfirm = vi
      .fn()
      .mockRejectedValue(new ApiError(409, 'nope', undefined, 'SHIFT_ALREADY_OPEN'));
    render(<CountDrawerDialog mode="open" open onClose={() => {}} onConfirm={onConfirm} />);

    await userEvent.type(screen.getByRole('textbox'), '1500.00');
    await userEvent.click(screen.getByRole('button', { name: SUBMIT_COUNT }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A shift is already open at this point',
    );

    // A later submit that never reaches `onConfirm` — client validation
    // refuses it first — must not leave the stale server banner standing
    // alongside the new field error.
    await userEvent.clear(screen.getByRole('textbox'));
    await userEvent.type(screen.getByRole('textbox'), '1.234');
    await userEvent.click(screen.getByRole('button', { name: SUBMIT_COUNT }));

    await waitFor(() =>
      expect(screen.queryByText('A shift is already open at this point')).toBeNull(),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter an amount — at most two decimals',
    );
  });
});

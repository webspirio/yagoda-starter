import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CountDrawerDialog } from './CountDrawerDialog';

function setup(onConfirm = vi.fn().mockResolvedValue(undefined)) {
  render(
    <CountDrawerDialog mode="open" open onClose={() => {}} onConfirm={onConfirm} />,
  );
  return onConfirm;
}

describe('CountDrawerDialog', () => {
  it('sends the amount normalised — a comma is how the keyboard types it', async () => {
    const onConfirm = setup();
    await userEvent.type(screen.getByRole('textbox'), '1 500,50');
    await userEvent.click(screen.getByRole('button', { name: /day\.count\.submit|Записати|Record/i }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('1500.50'));
  });

  it('refuses to submit an empty drawer count', async () => {
    const onConfirm = setup();
    await userEvent.click(screen.getByRole('button', { name: /day\.count\.submit|Записати|Record/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('never shows an expected figure — the count is a control, not a form to match', () => {
    setup();
    expect(screen.queryByText(/очікув|expected/i)).toBeNull();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/shared/api';
import { Toaster } from '@/shared/ui/sonner';
import { expectNoAxeViolations } from '../../../test-axe';
import type { CashCount } from '@/entities/cash-count';
import { OperatorNoteDialog } from './OperatorNoteDialog';

const { noteMock } = vi.hoisted(() => ({ noteMock: vi.fn() }));

vi.mock('../api/useSetOperatorNote', () => ({
  useSetOperatorNoteMutation: () => ({ mutateAsync: noteMock }),
}));

const row = (over: Partial<CashCount> = {}): CashCount => ({
  id: 'c1',
  shift_id: 's1',
  collection_point_id: 'p1',
  business_date: '2026-10-08',
  book: 'berry',
  kind: 'closing',
  counted_amount: '900.00',
  expected_amount: '1000.00',
  discrepancy: '-100.00',
  is_open: true,
  counted_by_user_id: 'u1',
  counted_by_name: 'Olha',
  counted_at: '2026-10-08T17:00:00Z',
  explanation: null,
  operator_note: null,
  operator_note_editable: true,
  explainable: false,
  ...over,
});

function renderDialog(over: Partial<CashCount> = {}, onClose = vi.fn()) {
  return {
    onClose,
    ...render(
      <>
        <OperatorNoteDialog count={row(over)} open onClose={onClose} />
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
    expect(screen.getByRole('heading', { name: 'What happened? Closing discrepancy −100.00 ₴' })).toBeInTheDocument();
    expect(screen.getByText(/The owner reads it next to the discrepancy/)).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('prefills the current note so it can be corrected', () => {
    renderDialog({ operator_note: 'перша версія' });
    expect(screen.getByLabelText('Your explanation')).toHaveValue('перша версія');
  });

  it('refuses a blank note', async () => {
    const { onClose } = renderDialog();
    await userEvent.type(screen.getByLabelText('Your explanation'), '   ');
    await userEvent.click(screen.getByRole('button', { name: 'Save explanation' }));
    expect(await screen.findByText('Write what happened')).toBeInTheDocument();
    expect(noteMock).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('sends the trimmed note and closes', async () => {
    const { onClose } = renderDialog();
    await userEvent.type(screen.getByLabelText('Your explanation'), '  віддав решту ');
    await userEvent.click(screen.getByRole('button', { name: 'Save explanation' }));
    expect(noteMock).toHaveBeenCalledWith({ countId: 'c1', operatorNote: 'віддав решту' });
    expect(await screen.findByText('Saved — the owner will see it next to the discrepancy')).toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('an opening count is titled as the opening discrepancy', () => {
    renderDialog({ kind: 'opening' });
    expect(screen.getByRole('heading', { name: 'What happened? Opening discrepancy −100.00 ₴' })).toBeInTheDocument();
  });

  it('a count that no longer stands says so and stays open', async () => {
    noteMock.mockRejectedValue(new ApiError(409, 'stale', undefined, 'COUNT_NOT_EXPLAINABLE'));
    const { onClose } = renderDialog();
    await userEvent.type(screen.getByLabelText('Your explanation'), 'причина');
    await userEvent.click(screen.getByRole('button', { name: 'Save explanation' }));
    expect(
      await screen.findByText('This count no longer stands — explain the new one. Refresh the page.'),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('someone else’s drawer: NOT_COUNTER reads as its own sentence', async () => {
    noteMock.mockRejectedValue(new ApiError(403, 'no', undefined, 'NOT_COUNTER'));
    renderDialog();
    await userEvent.type(screen.getByLabelText('Your explanation'), 'причина');
    await userEvent.click(screen.getByRole('button', { name: 'Save explanation' }));
    expect(
      await screen.findByText('Only the person who counted this drawer can explain it.'),
    ).toBeInTheDocument();
  });
});

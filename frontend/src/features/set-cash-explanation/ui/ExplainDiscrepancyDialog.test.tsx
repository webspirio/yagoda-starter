import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/shared/api';
import { Toaster } from '@/shared/ui/sonner';
import { expectNoAxeViolations } from '../../../test-axe';
import type { CashCount } from '@/entities/cash-count';
import { ExplainDiscrepancyDialog } from './ExplainDiscrepancyDialog';

const { explainMock } = vi.hoisted(() => ({ explainMock: vi.fn() }));

vi.mock('../api/useSetCashExplanation', () => ({
  useSetCashExplanationMutation: () => ({ mutateAsync: explainMock }),
}));

const row = (over: Partial<CashCount> = {}): CashCount => ({
  id: 'c1',
  shift_id: 's1',
  collection_point_id: 'p1',
  business_date: '2026-10-08',
  book: 'berry',
  kind: 'closing',
  counted_amount: '1000.00',
  expected_amount: '1320.00',
  discrepancy: '-320.00',
  is_open: true,
  counted_by_user_id: 'u1',
  counted_by_name: 'Olha',
  counted_at: '2026-10-08T17:00:00Z',
  explanation: null,
  operator_note: null,
  operator_note_editable: false,
  explainable: true,
  ...over,
  explained: over.explained ?? over.explanation != null,
});

function renderDialog(onClose = vi.fn()) {
  return {
    onClose,
    ...render(
      <>
        <ExplainDiscrepancyDialog count={row()} open onClose={onClose} />
        <Toaster />
      </>,
    ),
  };
}

beforeEach(() => {
  explainMock.mockReset().mockResolvedValue({ id: 's1' });
});

describe('ExplainDiscrepancyDialog', () => {
  it('names the size of the discrepancy in the title, so the click is not blind', async () => {
    const { container } = renderDialog();
    expect(
      screen.getByRole('heading', { name: 'Explain the −320.00 ₴ discrepancy' }),
    ).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('does not claim the shift is closed — the owner may explain an opening while it is open', () => {
    render(<ExplainDiscrepancyDialog count={row({ kind: 'opening' })} open onClose={vi.fn()} />);
    expect(screen.getByRole('dialog')).not.toHaveTextContent(/closed it/);
  });

  it('refuses a blank explanation and does not call the mutation', async () => {
    const { onClose } = renderDialog();

    await userEvent.click(screen.getByRole('button', { name: 'Save explanation' }));

    expect(await screen.findByText('Enter an explanation')).toBeInTheDocument();
    expect(explainMock).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('saves the typed explanation for the shift and closes', async () => {
    const { onClose } = renderDialog();

    await userEvent.type(
      screen.getByLabelText('Explanation'),
      'здачу віддали з іншої шухляди',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save explanation' }));

    expect(explainMock).toHaveBeenCalledWith({
      countId: 'c1',
      explanation: 'здачу віддали з іншої шухляди',
    });
    expect(await screen.findByText('Explanation saved')).toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the mapped banner and stays open when the server refuses', async () => {
    explainMock.mockRejectedValue(new ApiError(403, 'nope', undefined, 'OWNER_ONLY'));
    const { onClose } = renderDialog();

    await userEvent.type(screen.getByLabelText('Explanation'), 'причина');
    await userEvent.click(screen.getByRole('button', { name: 'Save explanation' }));

    expect(
      await screen.findByText('Only the network owner can do this. Ask the network owner.'),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows the operator’s account above the owner’s field without prefilling it', () => {
    render(
      <ExplainDiscrepancyDialog count={row({ operator_note: 'віддав решту' })} open onClose={vi.fn()} />,
    );
    expect(screen.getByText('The operator wrote')).toBeInTheDocument();
    expect(screen.getByText('віддав решту')).toBeInTheDocument();
    expect(screen.getByLabelText('Explanation')).toHaveValue('');
  });
});

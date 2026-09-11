import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/shared/api';
import { Toaster } from '@/shared/ui/sonner';
import { expectNoAxeViolations } from '../../../test-axe';
import { ExplainDiscrepancyDialog } from './ExplainDiscrepancyDialog';

const { explainMock } = vi.hoisted(() => ({ explainMock: vi.fn() }));

vi.mock('../api/useSetCashExplanation', () => ({
  useSetCashExplanationMutation: () => ({ mutateAsync: explainMock }),
}));

function renderDialog(onClose = vi.fn()) {
  return {
    onClose,
    ...render(
      <>
        <ExplainDiscrepancyDialog
          shiftId="s1"
          discrepancy="-320.00"
          open
          onClose={onClose}
        />
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
      shiftId: 's1',
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
      await screen.findByText('Only the network owner can do this'),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

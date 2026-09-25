import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/shared/api';
import { Toaster } from '@/shared/ui/sonner';
import { expectNoAxeViolations } from '../../../test-axe';
import { VoidDocumentDialog } from './VoidDocumentDialog';

const { voidDocumentMock } = vi.hoisted(() => ({
  voidDocumentMock: vi.fn(),
}));

vi.mock('../api/useVoidDocument', () => ({
  useVoidDocumentMutation: () => ({ mutateAsync: voidDocumentMock }),
}));

function renderDialog(onClose = vi.fn(), onVoided = vi.fn()) {
  return {
    onClose,
    onVoided,
    ...render(
      <>
        <VoidDocumentDialog
          kind="intake"
          id="i1"
          code="ПР-0012"
          open
          onClose={onClose}
          onVoided={onVoided}
        />
        <Toaster />
      </>,
    ),
  };
}

function renderWithPayout({
  canConfirmReturn = false,
  otherCovered = null as string | null,
} = {}) {
  const onClose = vi.fn();
  render(
    <>
      <VoidDocumentDialog
        kind="intake"
        id="i1"
        code="ПР-0012"
        open
        onClose={onClose}
        linkedPayout={{ code: 'PO-7', amount: '1500.00', otherCovered }}
        canConfirmReturn={canConfirmReturn}
      />
      <Toaster />
    </>,
  );
  return { onClose };
}

beforeEach(() => {
  voidDocumentMock.mockReset().mockResolvedValue(undefined);
});

describe('VoidDocumentDialog', () => {
  it('renders the document code in the title', async () => {
    const { container } = renderDialog();
    expect(screen.getByRole('heading', { name: 'Void ПР-0012?' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('shows a required error and does not call the mutation when the reason is blank', async () => {
    const { onClose } = renderDialog();
    await userEvent.click(screen.getByRole('button', { name: 'Void' }));

    expect(await screen.findByText('Enter a reason')).toBeInTheDocument();
    expect(voidDocumentMock).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('voids with the typed reason, toasts, and closes', async () => {
    const { onClose, onVoided } = renderDialog();

    await userEvent.type(screen.getByLabelText('Reason'), 'помилка у вазі');
    await userEvent.click(screen.getByRole('button', { name: 'Void' }));

    await waitFor(() => expect(voidDocumentMock).toHaveBeenCalledTimes(1));
    expect(voidDocumentMock).toHaveBeenCalledWith({
      kind: 'intake',
      id: 'i1',
      reason: 'помилка у вазі',
    });
    expect(await screen.findByText('Document voided')).toBeInTheDocument();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onVoided).toHaveBeenCalledTimes(1);
  });

  it('shows the owner-only banner and stays open on NOT_YOUR_DOCUMENT', async () => {
    voidDocumentMock.mockRejectedValue(
      new ApiError(403, 'forbidden', undefined, 'NOT_YOUR_DOCUMENT'),
    );
    const { onClose } = renderDialog();

    await userEvent.type(screen.getByLabelText('Reason'), 'помилка у вазі');
    await userEvent.click(screen.getByRole('button', { name: 'Void' }));

    expect(
      await screen.findByText('Only the author or the owner can void a document'),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('VoidDocumentDialog with a bound payout (#125)', () => {
  it('offers two choices to an operator, none preselected', () => {
    renderWithPayout();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    radios.forEach((r) => expect(r).not.toBeChecked());
    expect(screen.queryByLabelText(/already back in the drawer/)).not.toBeInTheDocument();
  });

  it('offers the third choice to the owner', () => {
    renderWithPayout({ canConfirmReturn: true });
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('refuses to submit without a choice', async () => {
    renderWithPayout();
    await userEvent.type(screen.getByLabelText('Reason'), 'помилка');
    await userEvent.click(screen.getByRole('button', { name: 'Void' }));

    expect(await screen.findByText('Choose what to do with the payout')).toBeInTheDocument();
    expect(voidDocumentMock).not.toHaveBeenCalled();
  });

  it('warns about the drawer only for void, and sends the decision', async () => {
    renderWithPayout();
    await userEvent.click(screen.getByLabelText('Keep the payout'));
    expect(screen.queryByText(/drawer will be/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByLabelText(/supplier will return the money/));
    expect(screen.getByText(/drawer will be/)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Reason'), 'помилка');
    await userEvent.click(screen.getByRole('button', { name: 'Void' }));
    await waitFor(() =>
      expect(voidDocumentMock).toHaveBeenCalledWith({
        kind: 'intake',
        id: 'i1',
        reason: 'помилка',
        payout: 'void',
      }),
    );
  });

  it('says which other receipts reopen, only when there are some', () => {
    renderWithPayout({ otherCovered: '1000.00' });
    expect(screen.getByText(/covered other receipts/)).toBeInTheDocument();
  });

  it('hides that line when the payout covered only this receipt', () => {
    renderWithPayout({ otherCovered: '0.00' });
    expect(screen.queryByText(/covered other receipts/)).not.toBeInTheDocument();
  });

  it('shows the stale-dialog banner on PAYOUT_DECISION_NOT_APPLICABLE', async () => {
    voidDocumentMock.mockRejectedValue(
      new ApiError(400, 'bad', undefined, 'PAYOUT_DECISION_NOT_APPLICABLE'),
    );
    renderWithPayout();
    await userEvent.click(screen.getByLabelText('Keep the payout'));
    await userEvent.type(screen.getByLabelText('Reason'), 'помилка');
    await userEvent.click(screen.getByRole('button', { name: 'Void' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('just changed');
  });
});

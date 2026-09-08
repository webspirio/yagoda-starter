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

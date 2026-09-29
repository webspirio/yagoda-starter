import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/shared/api';
import { Toaster } from '@/shared/ui/sonner';
import { expectNoAxeViolations } from '../../../test-axe';
import { VoidDocumentDialog } from './VoidDocumentDialog';
import type { LinkedPayout } from './PayoutDecisionField';

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
          shiftClosed
        />
        <Toaster />
      </>,
    ),
  };
}

function renderWithPayout({ otherCovered = null as string | null } = {}) {
  const onClose = vi.fn();
  render(
    <>
      <VoidDocumentDialog
        kind="intake"
        id="i1"
        code="ПР-0012"
        open
        onClose={onClose}
        linkedPayout={{
          code: 'PO-7', amount: '1500.00', otherCovered,
          paidAt: '2026-09-28T11:32:00.000Z', paidBy: 'Оксана Т.', reopens: null,
        }}
        shiftClosed
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
  it('a closed shift offers the three #125 choices, none preselected, and no checkboxes', () => {
    renderWithPayout();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    radios.forEach((r) => expect(r).not.toBeChecked());
    expect(screen.getByLabelText(/already back in the drawer/)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('refuses to submit without a choice', async () => {
    renderWithPayout();
    await userEvent.type(screen.getByLabelText('Reason'), 'помилка');
    await userEvent.click(screen.getByRole('button', { name: 'Void' }));

    expect(await screen.findByText('Choose what to do with the payout')).toBeInTheDocument();
    expect(voidDocumentMock).not.toHaveBeenCalled();
  });

  it('focuses the first radio when submitted without a choice', async () => {
    renderWithPayout();
    await userEvent.type(screen.getByLabelText('Reason'), 'помилка');
    await userEvent.click(screen.getByRole('button', { name: 'Void' }));

    await waitFor(() => expect(screen.getAllByRole('radio')[0]).toHaveFocus());
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

function renderOpenShiftIntake(linkedPayout?: Partial<LinkedPayout> | null) {
  render(
    <>
      <VoidDocumentDialog
        kind="intake" id="i1" code="ПР-0012" open onClose={vi.fn()} shiftClosed={false}
        intakeAmount="500.00"
        linkedPayout={linkedPayout === null ? undefined : {
          code: 'PO-7', amount: '1500.00', otherCovered: '1000.00',
          paidAt: '2026-09-28T11:32:00.000Z', paidBy: 'Оксана Т.', reopens: ['ПР-0009'],
          ...linkedPayout,
        }}
      />
      <Toaster />
    </>,
  );
}

describe('VoidDocumentDialog — open shift', () => {
  it('shows the payout card and three consequences, and no decision radios', () => {
    renderOpenShiftIntake();
    // Scoped to the card: «Payout PO-7 will be voided» names the code too.
    const card = screen.getByText('This payout will be voided').parentElement!;
    expect(within(card).getByText('PO-7', { exact: false })).toBeInTheDocument();
    expect(within(card).getByText('Оксана Т.', { exact: false })).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('omits the reopen line when the payout covered only this receipt', () => {
    renderOpenShiftIntake({ reopens: [] });
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  });

  it('refuses to submit until every box is ticked, then sends no payout field', async () => {
    renderOpenShiftIntake();
    await userEvent.type(screen.getByLabelText(/Reason/), 'клієнт повернув');
    await userEvent.click(screen.getByRole('button', { name: 'Void' }));
    expect(await screen.findByText('Tick every item')).toBeInTheDocument();
    expect(voidDocumentMock).not.toHaveBeenCalled();

    for (const box of screen.getAllByRole('checkbox')) await userEvent.click(box);
    await userEvent.click(screen.getByRole('button', { name: 'Void' }));
    await waitFor(() =>
      expect(voidDocumentMock).toHaveBeenCalledWith({ kind: 'intake', id: 'i1', reason: 'клієнт повернув' }),
    );
  });

  it('refuses to submit while the reopened receipts are still loading', async () => {
    renderOpenShiftIntake({ reopens: null });
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Reason/), 'клієнт повернув');
    for (const box of screen.getAllByRole('checkbox')) await userEvent.click(box);
    expect(screen.getByRole('button', { name: 'Void' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Void' }));
    expect(voidDocumentMock).not.toHaveBeenCalled();
  });

  it('once the reopened receipts arrive, their box appears and must be ticked', async () => {
    const payout: LinkedPayout = {
      code: 'PO-7', amount: '1500.00', otherCovered: null,
      paidAt: '2026-09-28T11:32:00.000Z', paidBy: null, reopens: null,
    };
    const dialog = (p: LinkedPayout) => (
      <VoidDocumentDialog kind="intake" id="i1" code="ПР-0012" open onClose={vi.fn()} linkedPayout={p} shiftClosed={false} />
    );
    const { rerender } = render(dialog(payout));
    await userEvent.type(screen.getByLabelText(/Reason/), 'клієнт повернув');
    for (const box of screen.getAllByRole('checkbox')) await userEvent.click(box);

    rerender(dialog({ ...payout, reopens: ['ПР-0009'] }));
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.getByRole('checkbox', { name: 'Receipts ПР-0009 will reopen' })).not.toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Void' }));
    expect(await screen.findByText('Tick every item')).toBeInTheDocument();
    expect(voidDocumentMock).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Receipts ПР-0009 will reopen' }));
    await userEvent.click(screen.getByRole('button', { name: 'Void' }));
    await waitFor(() => expect(voidDocumentMock).toHaveBeenCalledTimes(1));
  });

  // #173 review: a failed read must not lock the void out — the backend never needed `reopens`.
  it('when the settlement read fails, offers a retry and lets the void go through behind its own box', async () => {
    const retryReopens = vi.fn();
    renderOpenShiftIntake({ reopens: null, reopensFailed: true, retryReopens });
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load the receipts that will reopen");
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retryReopens).toHaveBeenCalledTimes(1);

    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    await userEvent.type(screen.getByLabelText(/Reason/), 'клієнт повернув');
    for (const box of screen.getAllByRole('checkbox')) await userEvent.click(box);
    await userEvent.click(screen.getByRole('button', { name: 'Void' }));
    await waitFor(() =>
      expect(voidDocumentMock).toHaveBeenCalledWith({ kind: 'intake', id: 'i1', reason: 'клієнт повернув' }),
    );
  });

  it('a retry that succeeds swaps in the reopen box, unticked', async () => {
    const payout: LinkedPayout = {
      code: 'PO-7', amount: '1500.00', otherCovered: null,
      paidAt: '2026-09-28T11:32:00.000Z', paidBy: null, reopens: null, reopensFailed: true,
    };
    const dialog = (p: LinkedPayout) => (
      <VoidDocumentDialog kind="intake" id="i1" code="ПР-0012" open onClose={vi.fn()} linkedPayout={p} shiftClosed={false} />
    );
    const { rerender } = render(dialog(payout));
    await userEvent.type(screen.getByLabelText(/Reason/), 'клієнт повернув');
    for (const box of screen.getAllByRole('checkbox')) await userEvent.click(box);

    rerender(dialog({ ...payout, reopens: ['ПР-0009'], reopensFailed: false }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Receipts ПР-0009 will reopen' })).not.toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Void' }));
    expect(await screen.findByText('Tick every item')).toBeInTheDocument();
    expect(voidDocumentMock).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Receipts ПР-0009 will reopen' }));
    await userEvent.click(screen.getByRole('button', { name: 'Void' }));
    await waitFor(() => expect(voidDocumentMock).toHaveBeenCalledTimes(1));
  });

  it('with no bound payout, asks for the one debt checkbox', () => {
    renderOpenShiftIntake(null);
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.getByText(/debt drops by/)).toBeInTheDocument();
  });

  it('a payout void asks for cash-back and reopen', () => {
    render(
      <VoidDocumentDialog kind="payout" id="p1" code="PO-7" open onClose={vi.fn()}
        payoutAmount="1500.00" reopens={['ПР-0009', 'ПР-0012']} />,
    );
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  });
});

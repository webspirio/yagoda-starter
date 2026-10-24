import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/shared/api';
import { Toaster } from '@/shared/ui/sonner';
import { expectNoAxeViolations } from '../../../test-axe';
import { VoidDocumentDialog } from './VoidDocumentDialog';
import type { LinkedPayout } from './VoidDocumentDialog';

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

function renderOpenShiftIntake(linkedPayout?: Partial<LinkedPayout> | null) {
  render(
    <>
      <VoidDocumentDialog
        kind="intake" id="i1" code="ПР-0012" open onClose={vi.fn()}
        intakeAmount="500.00"
        linkedPayout={linkedPayout === null ? undefined : {
          code: 'PO-7', amount: '1500.00',
          paidAt: '2026-09-28T11:32:00.000Z', paidBy: 'Оксана Т.', reopens: ['ПР-0009'],
          ...linkedPayout,
        }}
      />
      <Toaster />
    </>,
  );
}

describe('VoidDocumentDialog — open shift', () => {
  it('shows the payout card and three consequences', () => {
    renderOpenShiftIntake();
    // Scoped to the card: «Payout PO-7 will be voided» names the code too.
    const card = screen.getByText('This payout will be voided').parentElement!;
    expect(within(card).getByText('PO-7', { exact: false })).toBeInTheDocument();
    expect(within(card).getByText('Оксана Т.', { exact: false })).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
  });

  it('omits the reopen line when the payout covered only this receipt', () => {
    renderOpenShiftIntake({ reopens: [] });
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  });

  it('refuses to submit until every box is ticked, then sends the reason', async () => {
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
      code: 'PO-7', amount: '1500.00',
      paidAt: '2026-09-28T11:32:00.000Z', paidBy: null, reopens: null,
    };
    const dialog = (p: LinkedPayout) => (
      <VoidDocumentDialog kind="intake" id="i1" code="ПР-0012" open onClose={vi.fn()} linkedPayout={p} />
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
      code: 'PO-7', amount: '1500.00',
      paidAt: '2026-09-28T11:32:00.000Z', paidBy: null, reopens: null, reopensFailed: true,
    };
    const dialog = (p: LinkedPayout) => (
      <VoidDocumentDialog kind="intake" id="i1" code="ПР-0012" open onClose={vi.fn()} linkedPayout={p} />
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
    expect(screen.getByText(/the balance drops by/)).toBeInTheDocument();
  });

  it('a payout void asks for cash-back and reopen', () => {
    render(
      <VoidDocumentDialog kind="payout" id="p1" code="PO-7" open onClose={vi.fn()}
        payoutAmount="1500.00" reopens={['ПР-0009', 'ПР-0012']} />,
    );
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  });

  describe('a payout void while the reopened receipts are unknown', () => {
    const payoutDialog = (extra: object) => (
      <VoidDocumentDialog kind="payout" id="p1" code="PO-7" open onClose={vi.fn()}
        payoutAmount="1500.00" {...extra} />
    );

    it('refuses to submit while the settlement is still loading', async () => {
      render(payoutDialog({ reopens: null }));
      expect(screen.getByText('Loading…')).toBeInTheDocument();
      await userEvent.type(screen.getByLabelText(/Reason/), 'клієнт повернув');
      for (const box of screen.getAllByRole('checkbox')) await userEvent.click(box);
      expect(screen.getByRole('button', { name: 'Void' })).toBeDisabled();
      expect(voidDocumentMock).not.toHaveBeenCalled();
    });

    it('a closed shift has no box, so nothing waits on the list', () => {
      render(payoutDialog({ reopens: null, shiftClosed: true }));
      expect(screen.queryByText('Loading…')).toBeNull();
      expect(screen.getByRole('button', { name: 'Void' })).toBeEnabled();
    });

    it('after a failed read offers a retry and lets the void go on behind a «list unknown» box', async () => {
      const retryReopens = vi.fn();
      render(payoutDialog({ reopens: null, reopensFailed: true, retryReopens }));
      expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load the receipts that will reopen");
      await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(retryReopens).toHaveBeenCalledTimes(1);

      expect(screen.getAllByRole('checkbox')).toHaveLength(2);
      await userEvent.type(screen.getByLabelText(/Reason/), 'клієнт повернув');
      for (const box of screen.getAllByRole('checkbox')) await userEvent.click(box);
      await userEvent.click(screen.getByRole('button', { name: 'Void' }));
      await waitFor(() =>
        expect(voidDocumentMock).toHaveBeenCalledWith({ kind: 'payout', id: 'p1', reason: 'клієнт повернув' }),
      );
    });
  });
});

describe('VoidDocumentDialog — top-ups (review 2026-10-24)', () => {
  const topUpDialog = (countsTowardBalance = true) => (
    <>
      <VoidDocumentDialog
        kind="topUp"
        id="t1"
        code="SHP-IN-20261023-001"
        open
        onClose={vi.fn()}
        topUp={{ amount: '750.00', supplierName: 'Марія Бондар', countsTowardBalance }}
      />
      <Toaster />
    </>
  );

  it('names the top-up, its amount and its receipt, and says what does not move', () => {
    render(topUpDialog());
    expect(
      screen.getByRole('heading', { name: 'Void the 750.00 ₴ top-up on SHP-IN-20261023-001?' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Receipt SHP-IN-20261023-001 stays as it is. No cash moves.'),
    ).toBeInTheDocument();
  });

  it('requires the balance box before voiding, then toasts «Top-up voided»', async () => {
    render(topUpDialog());
    await userEvent.type(screen.getByLabelText(/Reason/), 'помилка суми');
    await userEvent.click(screen.getByRole('button', { name: 'Void' }));
    expect(voidDocumentMock).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole('checkbox', { name: "Марія Бондар's balance drops by 750.00 ₴" }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Void' }));
    await waitFor(() =>
      expect(voidDocumentMock).toHaveBeenCalledWith({
        kind: 'topUp',
        id: 't1',
        reason: 'помилка суми',
      }),
    );
    expect(await screen.findByText('Top-up voided')).toBeInTheDocument();
  });

  it('asks for no balance box when the parent receipt is already voided', () => {
    render(topUpDialog(false));
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it("a receipt void with live top-ups: the full drop, and the owner's own box for them", () => {
    render(
      <VoidDocumentDialog
        kind="intake"
        id="i1"
        code="ПР-0012"
        open
        onClose={vi.fn()}
        intakeAmount="1250.00"
        intakeTopUps="750.00"
      />,
    );
    expect(
      screen.getByRole('checkbox', { name: 'Receipt voided, the balance drops by 1,250.00 ₴' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', {
        name: 'The 750.00 ₴ top-up goes too — after the new receipt it has to be added again',
      }),
    ).toBeInTheDocument();
  });

  it('a receipt void with a linked payout still names the top-ups that go with it', () => {
    render(
      <VoidDocumentDialog
        kind="intake"
        id="i1"
        code="ПР-0012"
        open
        onClose={vi.fn()}
        intakeAmount="1250.00"
        intakeTopUps="750.00"
        linkedPayout={{
          code: 'PO-7',
          amount: '1500.00',
          paidAt: '2026-09-28T11:32:00.000Z',
          paidBy: null,
          reopens: [],
        }}
      />,
    );
    expect(screen.getByText(/The 750.00 ₴ top-up goes too/)).toBeInTheDocument();
  });
});

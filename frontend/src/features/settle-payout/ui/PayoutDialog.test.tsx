import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../../test-axe';
import { PayoutDialog } from './PayoutDialog';

const { createPayoutMock } = vi.hoisted(() => ({
  createPayoutMock: vi.fn(),
}));

vi.mock('../api/useCreatePayout', () => ({
  useCreatePayoutMutation: () => ({ mutateAsync: createPayoutMock }),
}));

const { toastSuccessMock } = vi.hoisted(() => ({ toastSuccessMock: vi.fn() }));
vi.mock('@/shared/ui/toast', () => ({
  toast: { success: toastSuccessMock, error: vi.fn() },
}));

const supplier = { id: 's1', first_name: 'Ivan', last_name: 'Petrenko' };

beforeEach(() => {
  createPayoutMock.mockReset().mockResolvedValue({
    id: 'po1',
    code: 'SHP-PO-20260908-00091',
    amount: '4000.00',
  });
  toastSuccessMock.mockReset();
});

describe('PayoutDialog', () => {
  it('names the supplier, prefills the amount with the debt, and is axe-clean', async () => {
    const { container } = render(
      <PayoutDialog supplier={supplier} pointId="p1" debt="10944.00" open onClose={vi.fn()} />,
    );

    expect(
      screen.getByRole('heading', { name: 'Pay out the balance — Ivan Petrenko' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Amount')).toHaveValue('10944.00');

    await expectNoAxeViolations(container);
  });

  it('refuses an amount above the debt, without calling the mutation', async () => {
    render(
      <PayoutDialog supplier={supplier} pointId="p1" debt="10944.00" open onClose={vi.fn()} />,
    );

    const amountField = screen.getByLabelText('Amount');
    await userEvent.clear(amountField);
    await userEvent.type(amountField, '20000');

    await userEvent.click(screen.getByRole('button', { name: /Pay out/ }));

    expect(
      await screen.findByText('Cannot pay more than the balance — balance 10,944.00 ₴'),
    ).toBeInTheDocument();
    expect(createPayoutMock).not.toHaveBeenCalled();
  });

  it('submits a valid payout, toasts, and closes', async () => {
    const onClose = vi.fn();
    const onPaid = vi.fn();
    render(
      <PayoutDialog
        supplier={supplier}
        pointId="p1"
        debt="10944.00"
        open
        onClose={onClose}
        onPaid={onPaid}
      />,
    );

    const amountField = screen.getByLabelText('Amount');
    await userEvent.clear(amountField);
    await userEvent.type(amountField, '4000');

    await userEvent.click(screen.getByRole('button', { name: /Pay out/ }));

    await waitFor(() => expect(createPayoutMock).toHaveBeenCalledTimes(1));
    expect(createPayoutMock).toHaveBeenCalledWith({
      supplier_id: 's1',
      amount: '4000',
      collection_point_id: 'p1',
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onPaid).toHaveBeenCalledWith({
      id: 'po1',
      code: 'SHP-PO-20260908-00091',
      amount: '4000.00',
    });
    expect(toastSuccessMock).toHaveBeenCalledWith('Paid out 4,000.00 ₴');
  });

  it('asks for no receipt number — the server numbers the payout', async () => {
    render(<PayoutDialog supplier={supplier} debt="10944.00" open onClose={vi.fn()} />);

    expect(screen.queryByLabelText('Receipt no.')).not.toBeInTheDocument();
  });

  it('puts the cursor in the amount, the only thing left to type', async () => {
    render(<PayoutDialog supplier={supplier} debt="10944.00" open onClose={vi.fn()} />);

    expect(screen.getByLabelText('Amount')).toHaveFocus();
  });

  it('does not send collection_point_id when no point is given (operator flow)', async () => {
    render(<PayoutDialog supplier={supplier} debt="10944.00" open onClose={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /Pay out/ }));

    await waitFor(() => expect(createPayoutMock).toHaveBeenCalledTimes(1));
    expect(createPayoutMock).toHaveBeenCalledWith({
      supplier_id: 's1',
      amount: '10944.00',
    });
  });

  it('sets the amount to the full debt from the "All" button', async () => {
    render(
      <PayoutDialog
        supplier={supplier}
        pointId="p1"
        debt="10944.00"
        defaultAmount="500.00"
        open
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Amount')).toHaveValue('500.00');
    await userEvent.click(screen.getByRole('button', { name: 'All — 10,944.00 ₴' }));
    expect(screen.getByLabelText('Amount')).toHaveValue('10944.00');
  });

  it('renders the exact submit-label with formatted amount', async () => {
    render(
      <PayoutDialog supplier={supplier} pointId="p1" debt="10944.00" open onClose={vi.fn()} />,
    );

    const amountField = screen.getByLabelText('Amount');
    await userEvent.clear(amountField);
    await userEvent.type(amountField, '4000');

    expect(screen.getByRole('button', { name: 'Pay out 4,000.00 ₴' })).toBeInTheDocument();
  });

  it('shows a banner for a shift-level server refusal', async () => {
    const { ApiError } = await import('@/shared/api');
    createPayoutMock.mockRejectedValueOnce(
      new ApiError(409, 'No open shift', undefined, 'NO_OPEN_SHIFT'),
    );
    render(
      <PayoutDialog supplier={supplier} pointId="p1" debt="10944.00" open onClose={vi.fn()} />,
    );

    await userEvent.click(screen.getByRole('button', { name: /Pay out/ }));

    expect(
      await screen.findByText('No open shift — open one in Cash for the day'),
    ).toBeInTheDocument();
  });
});

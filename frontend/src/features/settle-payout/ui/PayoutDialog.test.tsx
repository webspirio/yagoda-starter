import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { i18n } from '@/shared/lib/i18n';
import uk from '@/shared/lib/i18n/locales/uk.json';
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

// §3.6: the dialog reads the point's berry cash and its open shift — both
// mocked as plain state so each test names the drawer it pays from.
const { cashState, shiftState } = vi.hoisted(() => ({
  cashState: {
    current: {
      isPending: false,
      isError: false,
      data: { cash: '50000.00' } as { cash: string } | undefined,
    },
  },
  shiftState: {
    current: {
      isPending: false,
      isError: false,
      data: { id: 'sh1' } as { id: string } | null | undefined,
    },
  },
}));
vi.mock('@/entities/point-cash', () => ({
  usePointCashForPointQuery: () => cashState.current,
}));
vi.mock('@/entities/shift', () => ({
  useCurrentShiftQuery: () => shiftState.current,
}));

const supplier = { id: 's1', first_name: 'Ivan', last_name: 'Petrenko' };

beforeEach(() => {
  cashState.current = { isPending: false, isError: false, data: { cash: '50000.00' } };
  shiftState.current = { isPending: false, isError: false, data: { id: 'sh1' } };
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

  it('refuses an amount above the debt before submit, without calling the mutation', async () => {
    render(
      <PayoutDialog supplier={supplier} pointId="p1" debt="10944.00" open onClose={vi.fn()} />,
    );

    const amountField = screen.getByLabelText('Amount');
    await userEvent.clear(amountField);
    await userEvent.type(amountField, '20000');

    expect(
      await screen.findByText('Cannot pay more than the balance — balance 10,944.00 ₴'),
    ).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: /Pay out/ });
    expect(submit).toBeDisabled();
    await userEvent.click(submit);
    expect(createPayoutMock).not.toHaveBeenCalled();
  });

  it('re-translates the above-the-balance error when the language switches', async () => {
    render(<PayoutDialog supplier={supplier} pointId="p1" debt="100.00" open onClose={vi.fn()} />);
    try {
      const amountField = screen.getByLabelText('Amount');
      await userEvent.clear(amountField);
      await userEvent.type(amountField, '150');
      expect(
        await screen.findByText('Cannot pay more than the balance — balance 100.00 ₴'),
      ).toBeInTheDocument();

      await act(() => i18n.changeLanguage('uk'));
      const ukText = uk.payout.errors.exceedsDebt.replace('{{debt}}', '100,00 ₴');
      expect(screen.getByText(ukText)).toBeInTheDocument();
    } finally {
      await act(() => i18n.changeLanguage('en'));
    }
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
    render(<PayoutDialog supplier={supplier} pointId="p1" debt="10944.00" open onClose={vi.fn()} />);

    expect(screen.queryByLabelText('Receipt no.')).not.toBeInTheDocument();
  });

  it('puts the cursor in the amount, the only thing left to type', async () => {
    render(<PayoutDialog supplier={supplier} pointId="p1" debt="10944.00" open onClose={vi.fn()} />);

    expect(screen.getByLabelText('Amount')).toHaveFocus();
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
      await screen.findByText('No open shift — open one in Point cash'),
    ).toBeInTheDocument();
  });
});

describe('the berry-cash ceiling (§3.6)', () => {
  it('prefills min(debt, cash), names the drawer, and offers «All» up to it', async () => {
    cashState.current = { isPending: false, isError: false, data: { cash: '1616.10' } };
    render(
      <PayoutDialog supplier={supplier} pointId="p1" debt="5497.37" open onClose={vi.fn()} />,
    );

    expect(screen.getByLabelText('Amount')).toHaveValue('1616.10');
    expect(
      screen.getByText(
        'There is 1,616.10 ₴ of berry cash at the till — nothing more to pay out right now. The rest stays on the balance.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All — 1,616.10 ₴' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay out 1,616.10 ₴' })).toBeEnabled();
  });

  it('caps a typed sum at the drawer: submit disabled, the reason on the field', async () => {
    cashState.current = { isPending: false, isError: false, data: { cash: '1616.10' } };
    render(
      <PayoutDialog supplier={supplier} pointId="p1" debt="5497.37" open onClose={vi.fn()} />,
    );

    const amountField = screen.getByLabelText('Amount');
    await userEvent.clear(amountField);
    await userEvent.type(amountField, '2000');

    expect(
      screen.getByText('Only 1,616.10 ₴ of berry cash at the till — cannot pay out more'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay out 2,000.00 ₴' })).toBeDisabled();
    expect(createPayoutMock).not.toHaveBeenCalled();
  });

  it('an empty or negative drawer pays nothing and says why', async () => {
    cashState.current = { isPending: false, isError: false, data: { cash: '-90.00' } };
    render(
      <PayoutDialog supplier={supplier} pointId="p1" debt="5497.37" open onClose={vi.fn()} />,
    );

    expect(
      screen.getByText(
        "Berry cash at the till is −90.00 ₴ — there is nothing to pay out right now. The balance of 5,497.37 ₴ stays owed; an owner's transfer refills the till.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay out' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /All/ })).toBeDisabled();
  });

  it('a drawer that holds more than the debt changes nothing', async () => {
    render(
      <PayoutDialog supplier={supplier} pointId="p1" debt="10944.00" open onClose={vi.fn()} />,
    );

    expect(screen.getByLabelText('Amount')).toHaveValue('10944.00');
    expect(screen.queryByText(/berry cash at the till/)).not.toBeInTheDocument();
  });

  it('a failed cash read is said aloud — never a zero drawer — and the debt alone caps', async () => {
    cashState.current = { isPending: false, isError: true, data: undefined };
    render(
      <PayoutDialog supplier={supplier} pointId="p1" debt="10944.00" open onClose={vi.fn()} />,
    );

    expect(screen.getByLabelText('Amount')).toHaveValue('10944.00');
    expect(
      screen.getByText("Couldn't read the point's cash — if it holds less, the payout will be refused."),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay out 10,944.00 ₴' })).toBeEnabled();
  });

  it('waits for the drawer before offering a sum', () => {
    cashState.current = { isPending: true, isError: false, data: undefined };
    render(
      <PayoutDialog supplier={supplier} pointId="p1" debt="10944.00" open onClose={vi.fn()} />,
    );

    expect(screen.queryByLabelText('Amount')).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('no open shift: explained up front, no amount to type, nothing to submit', async () => {
    shiftState.current = { isPending: false, isError: false, data: null };
    const { container } = render(
      <PayoutDialog supplier={supplier} pointId="p1" debt="10944.00" open onClose={vi.fn()} />,
    );

    expect(
      screen.getByText(
        'No shift is open at this point — cash is paid out only from an open shift. The point operator opens it in Point cash.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Amount')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Pay out/ })).not.toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
});

describe('the shared money field (#72)', () => {
  it('never holds a space and refuses a half-typed sum with the shared message', async () => {
    render(<PayoutDialog supplier={supplier} pointId="p1" debt="10944.00" open onClose={vi.fn()} />);
    const input = screen.getByLabelText('Amount');
    await userEvent.clear(input);
    await userEvent.type(input, '980 40');
    expect(input).toHaveValue('98040');
    await userEvent.clear(input);
    await userEvent.type(input, '12.');
    await userEvent.click(screen.getByRole('button', { name: /Pay out/ }));
    expect(await screen.findByText('Enter a number, e.g. 12000 or 980.40')).toBeInTheDocument();
  });

  it('never names the full balance on the button under a value it will refuse (#72 review)', async () => {
    render(<PayoutDialog supplier={supplier} pointId="p1" debt="10944.00" open onClose={vi.fn()} />);
    const input = screen.getByLabelText('Amount');
    await userEvent.clear(input);
    await userEvent.type(input, '1.2.3');
    // Exact name: the submit no longer offers «Pay out 10,944.00 ₴» (the full
    // balance) under a value it is about to refuse.
    expect(screen.getByRole('button', { name: 'Pay out' })).toHaveAttribute('type', 'submit');
  });

  it('submits the server-canonical prefill untouched', async () => {
    render(<PayoutDialog supplier={supplier} pointId="p1" debt="10944.00" open onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /Pay out/ }));
    await waitFor(() =>
      expect(createPayoutMock).toHaveBeenCalledWith({
        supplier_id: 's1',
        amount: '10944.00',
        collection_point_id: 'p1',
      }),
    );
  });
});

describe('the prefill reads in the locale, the API gets the canonical form', () => {
  beforeEach(async () => {
    await act(() => i18n.changeLanguage('uk'));
  });
  afterEach(async () => {
    await act(() => i18n.changeLanguage('en'));
  });

  it('shows min(debt, cash) with the decimal comma and sends it untouched as «500.00»', async () => {
    cashState.current = { isPending: false, isError: false, data: { cash: '500.00' } };
    render(<PayoutDialog supplier={supplier} pointId="p1" debt="10944.00" open onClose={vi.fn()} />);

    expect(screen.getByLabelText(uk.payout.form.amount)).toHaveValue('500,00');
    await userEvent.click(screen.getByRole('button', { name: 'Видати 500,00 ₴' }));
    await waitFor(() =>
      expect(createPayoutMock).toHaveBeenCalledWith({
        supplier_id: 's1',
        amount: '500.00',
        collection_point_id: 'p1',
      }),
    );
  });

  it('«Усе» puts the ceiling in with the decimal comma and submits it canonical', async () => {
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

    const input = screen.getByLabelText(uk.payout.form.amount);
    expect(input).toHaveValue('500,00');
    await userEvent.click(screen.getByRole('button', { name: /^Усе — 10.944,00 ₴$/ }));
    expect(input).toHaveValue('10944,00');
    await userEvent.click(screen.getByRole('button', { name: /^Видати 10.944,00 ₴$/ }));
    await waitFor(() =>
      expect(createPayoutMock).toHaveBeenCalledWith({
        supplier_id: 's1',
        amount: '10944.00',
        collection_point_id: 'p1',
      }),
    );
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/shared/api';
import { TopUpDialog } from './TopUpDialog';

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock('../api/useCreateTopUp', () => ({
  useCreateTopUpMutation: () => ({ mutateAsync: createMock }),
}));

const INTAKE = { id: 'i1', code: 'KV-0001' };

function open() {
  return render(
    <TopUpDialog intake={INTAKE} supplierName="Ivan Koval" open onClose={() => {}} />,
  );
}

const fill = async (user: ReturnType<typeof userEvent.setup>, amount: string, reason: string) => {
  await user.type(screen.getByLabelText(/amount/i), amount);
  await user.type(screen.getByLabelText(/why/i), reason);
  await user.click(screen.getByRole('button', { name: /^add$/i }));
};

beforeEach(() => {
  createMock.mockReset().mockResolvedValue({});
});

describe('TopUpDialog', () => {
  it('names the receipt and the supplier the debt is being raised against', () => {
    open();
    expect(screen.getByText(/KV-0001/)).toBeInTheDocument();
    expect(screen.getByText(/Ivan Koval/)).toBeInTheDocument();
  });

  it('sends the parent intake id, the amount and a trimmed reason', async () => {
    const user = userEvent.setup();
    open();

    await fill(user, '750', '  Домовились про 48 замість 45  ');

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock).toHaveBeenCalledWith({
      intake_id: 'i1',
      amount: '750',
      reason: 'Домовились про 48 замість 45',
    });
  });

  /**
   * #61's whole point: «щоб при перегляді історії було ясно зрозуміло, чому ми
   * маємо викладати дві тисячі цьому постачальнику». A reason of three spaces
   * passes a LENGTH check and leaves whitespace standing as the explanation for
   * a 2 000 ₴ debt, which is why the server tests `\S` and so does this form.
   */
  it('refuses a blank reason before it ever reaches the server', async () => {
    const user = userEvent.setup();
    open();

    await fill(user, '750', '    ');

    await waitFor(() => expect(screen.getByText(/say why/i)).toBeInTheDocument());
    expect(createMock).not.toHaveBeenCalled();
  });

  it('refuses a missing reason', async () => {
    const user = userEvent.setup();
    open();

    await user.type(screen.getByLabelText(/amount/i), '750');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => expect(screen.getByText(/say why/i)).toBeInTheDocument());
    expect(createMock).not.toHaveBeenCalled();
  });

  /**
   * `amount > 0` is a CHECK on the table. A zero row would change no debt, and
   * a NEGATIVE one would reduce a debt with no cash leaving the drawer — which
   * §3.2 forbids «для ЖОДНОЇ ролі». The downward path is §9.3: void the receipt
   * and reissue it.
   */
  it('refuses a zero amount', async () => {
    const user = userEvent.setup();
    open();

    await fill(user, '0', 'Доплата');

    await waitFor(() => expect(screen.getByText(/above zero/i)).toBeInTheDocument());
    expect(createMock).not.toHaveBeenCalled();
  });

  it('refuses an amount that is not a decimal string', async () => {
    const user = userEvent.setup();
    open();

    await fill(user, 'abc', 'Доплата');

    await waitFor(() => expect(screen.getByText(/enter an amount/i)).toBeInTheDocument());
    expect(createMock).not.toHaveBeenCalled();
  });

  /**
   * The backend refuses a top-up against a deactivated supplier AT THE SOURCE,
   * because it would otherwise raise a debt `POST /payouts` then refuses to
   * settle — money owed that nobody can hand over. The screen says that, rather
   * than «something went wrong».
   */
  it('names SUPPLIER_INACTIVE rather than showing a generic failure', async () => {
    const user = userEvent.setup();
    createMock.mockRejectedValue(
      new ApiError(400, 'Supplier is inactive', undefined, 'SUPPLIER_INACTIVE'),
    );
    open();

    await fill(user, '750', 'Доплата');

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/deactivated/i),
    );
  });

  it('falls back to a generic banner for an unmapped failure', async () => {
    const user = userEvent.setup();
    createMock.mockRejectedValue(new ApiError(500, 'boom'));
    open();

    await fill(user, '750', 'Доплата');

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/could not add/i),
    );
  });
});

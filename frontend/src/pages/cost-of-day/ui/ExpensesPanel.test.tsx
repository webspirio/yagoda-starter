import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { i18n } from '@/shared/lib/i18n';
import type { CostOfDay } from '@/entities/cost-of-day';
import type { DayExpense } from '@/entities/day-expense';
import { ExpensesPanel } from './ExpensesPanel';

const { createMock, updateMock, removeMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  updateMock: vi.fn(),
  removeMock: vi.fn(),
}));

vi.mock('@/entities/day-expense', () => ({
  useCreateDayExpenseMutation: () => ({ mutateAsync: createMock, isPending: false }),
  useUpdateDayExpenseMutation: () => ({ mutateAsync: updateMock, isPending: false }),
  useDeleteDayExpenseMutation: () => ({ mutateAsync: removeMock, isPending: false }),
}));

// Every assertion below is the Ukrainian copy the component's own t() calls
// produce, but `test-setup.ts` defaults the active i18n language to 'en' for
// the whole suite (see `BerryTable.test.tsx` for the same convention). Set it
// here for this file only, and reset it afterwards so it never leaks into a
// later file's "runs in ENGLISH" assumption.
beforeAll(async () => {
  await i18n.changeLanguage('uk');
});

afterAll(async () => {
  await i18n.changeLanguage('en');
});

const day: CostOfDay = {
  shift_id: 's1',
  closed_at: '2026-09-22T18:00:00.000Z',
  provisional: false,
  accrued: '131900.00',
  reweighed_kg: '854.00',
  shortfall_amount: '1660.00',
  expenses_amount: '3800.00',
  basket: '5460.00',
  per_kg: '6.39',
  shortfall_per_kg: '1.94',
  expenses_per_kg: '4.45',
  total_check: '135700.00',
  top_ups_included: true,
  top_ups_latest_at: null,
  products: [],
};

const lines: DayExpense[] = [
  {
    id: 'e1',
    shift_id: 's1',
    label: 'пальне',
    amount: '1000.00',
    created_by_user_id: 'u1',
    created_at: '2026-09-22T08:00:00.000Z',
    updated_at: '2026-09-22T08:00:00.000Z',
  },
];

const renderPanel = (over: Partial<CostOfDay> = {}, rows = lines) =>
  render(<ExpensesPanel day={{ ...day, ...over }} expenses={rows} shiftId="s1" locale="uk" />);

beforeEach(() => {
  createMock.mockReset().mockResolvedValue(undefined);
  updateMock.mockReset().mockResolvedValue(undefined);
  removeMock.mockReset().mockResolvedValue(undefined);
});

describe('ExpensesPanel', () => {
  it('prints the basket and §8.4 «з них» split', () => {
    renderPanel();

    expect(screen.getByText('5 460,00 ₴')).toBeInTheDocument();
    expect(screen.getByText(/з них недостача 1,94/)).toBeInTheDocument();
    expect(screen.getByText(/з них витрати 4,45/)).toBeInTheDocument();
  });

  it('adds a line and clears the form only after the write succeeds', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(screen.getByPlaceholderText('Підпис витрати'), 'водій');
    await user.type(screen.getByPlaceholderText('₴'), '500');
    await user.click(screen.getByRole('button', { name: 'ще рядок' }));

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({ shiftId: 's1', label: 'водій', amount: '500' }),
    );
    expect(screen.getByPlaceholderText('Підпис витрати')).toHaveValue('');
  });

  it('keeps what was typed when the write is refused', async () => {
    createMock.mockRejectedValue(new Error('nope'));
    const user = userEvent.setup();
    renderPanel();

    await user.type(screen.getByPlaceholderText('Підпис витрати'), 'водій');
    await user.type(screen.getByPlaceholderText('₴'), '500');
    await user.click(screen.getByRole('button', { name: 'ще рядок' }));

    // A line that vanishes without a word is worse than one that refuses out
    // loud: the собівартість would then be computed without it, silently.
    // Both fields are cleared by the same `try` block, so pin BOTH — an
    // amount-only clearing regression would still pass if only `label` were
    // checked here.
    await waitFor(() => expect(createMock).toHaveBeenCalled());
    expect(screen.getByPlaceholderText('Підпис витрати')).toHaveValue('водій');
    expect(screen.getByPlaceholderText('₴')).toHaveValue('500');
  });

  it('patches only the field that actually moved', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: 'Змінити «пальне»' }));
    const amount = screen.getByDisplayValue('1000.00');
    await user.clear(amount);
    await user.type(amount, '1300');
    await user.click(screen.getByRole('button', { name: 'Зберегти' }));

    // The server writes an audit entry only when a value really changed, so
    // sending an unchanged `label` would put a no-op in the one trail this
    // mutable table has.
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith({ id: 'e1', amount: '1300' }));
  });

  it('patches only the label when only the label moved', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: 'Змінити «пальне»' }));
    // Leave the amount input untouched at '1000.00' — only the label field
    // is edited below.
    const labelInput = screen.getByDisplayValue('пальне');
    await user.clear(labelInput);
    await user.type(labelInput, 'дизель');
    await user.click(screen.getByRole('button', { name: 'Зберегти' }));

    // Exact body (not `objectContaining`) on purpose: the audit trail is the
    // ONLY compensating control on this one mutable money table, so an
    // unchanged `amount` tagging along here would record a transition that
    // never happened.
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith({ id: 'e1', label: 'дизель' }));
  });

  it('calls no mutation and closes the editor when nothing moved', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: 'Змінити «пальне»' }));
    // Neither field is touched — save as-is.
    await user.click(screen.getByRole('button', { name: 'Зберегти' }));

    // Same reasoning as the two tests above: a no-op save must never reach
    // the mutation, since the server records an audit entry on every write —
    // a call here would be a phantom entry, not a missing one. Assert the
    // editor closed too (the edit button is back), so this pins the whole
    // no-op path rather than only the mutation's silence.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Змінити «пальне»' })).toBeInTheDocument(),
    );
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('refuses an in-progress amount instead of letting the server 400', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(screen.getByLabelText('Підпис витрати'), 'водій');
    // `maskDecimalInput` is a TYPING mask, not a validator: it lets '12.'
    // stand mid-keystroke, and `CreateDayExpenseDto`'s `@Matches` refuses it.
    // The refusal belongs on this side as a disabled button — a round trip
    // that comes back «щось пішло не так» says nothing about the field.
    await user.type(screen.getByLabelText('₴'), '12.');

    expect(screen.getByRole('button', { name: 'ще рядок' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'ще рядок' }));
    expect(createMock).not.toHaveBeenCalled();
  });

  it('refuses an in-progress amount in the inline editor too', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: 'Змінити «пальне»' }));
    const amount = screen.getByDisplayValue('1000.00');
    await user.clear(amount);
    await user.type(amount, '13.');

    // Without the gate this took the `draftAmount !== '' ` branch and sent
    // '13.' — or, worse, dropped it silently and closed the editor on a value
    // the person had every reason to think was saved.
    expect(screen.getByRole('button', { name: 'Зберегти' })).toBeDisabled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('removes a line', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: 'Прибрати «пальне»' }));
    await waitFor(() => expect(removeMock).toHaveBeenCalledWith({ id: 'e1' }));
  });

  it('names only the manual expenses when nothing has been weighed', () => {
    renderPanel({ per_kg: null, shortfall_per_kg: null, expenses_per_kg: null });

    // The engine would read the whole day's weight as a shortfall here; saying
    // «недостача 17 419,07 ₴» on a day nobody weighed anything would be an
    // invented number. Name the manual expenses and nothing else.
    expect(screen.getByText('Очікує переважування')).toBeInTheDocument();
    expect(screen.getByText('3 800,00 ₴ не розподілено')).toBeInTheDocument();
    expect(screen.queryByText(/Спільний кошик/i)).not.toBeInTheDocument();
  });

  it('says so when no expenses have been entered', () => {
    renderPanel({}, []);
    expect(screen.getByText('Витрат за цей день ще не заводили.')).toBeInTheDocument();
  });
});

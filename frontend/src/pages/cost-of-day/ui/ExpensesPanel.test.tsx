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
  render(
    <ExpensesPanel day={{ ...day, ...over }} expenses={rows} shiftId="s1" locale="uk" />,
  );

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
    await waitFor(() => expect(createMock).toHaveBeenCalled());
    expect(screen.getByPlaceholderText('Підпис витрати')).toHaveValue('водій');
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

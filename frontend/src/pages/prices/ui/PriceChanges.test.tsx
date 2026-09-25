import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { expectNoAxeViolations } from '../../../test-axe';
import { addDaysIso, todayIso } from '@/shared/lib/date';
import { PriceChanges } from './PriceChanges';
import type { PriceChange } from '../model/gradePrice';

const { changesMock } = vi.hoisted(() => ({ changesMock: vi.fn() }));

vi.mock('../api/priceChanges', () => ({
  usePriceChangesQuery: (period: unknown) => changesMock(period),
}));

/** Mounted in a real data router at `entry`, so the URL-held period is
 *  exercised for real; `search()` reads the live query string. */
function renderAt(entry = '/prices') {
  const router = createMemoryRouter([{ path: '*', element: <PriceChanges /> }], {
    initialEntries: [entry],
  });
  const view = render(<RouterProvider router={router} />);
  return { ...view, search: () => new URLSearchParams(router.state.location.search) };
}

const change = (over: Partial<PriceChange>): PriceChange => ({
  id: 'c1',
  created_at: '2026-09-23T07:54:00.000Z',
  collection_point_id: 'p1',
  point_name: 'Шипинки',
  product_grade_id: 'g1',
  product_name: 'Малина',
  grade_name: '2 сорт',
  previous_base_price: '115.00',
  base_price: '184.00',
  reason: null,
  author_name: 'Керівник',
  ...over,
});

/** The expected clock reading, computed the way the component computes it —
 *  so the assertion holds in whatever zone the suite runs. */
const clock = (iso: string) =>
  new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

const loaded = (changes: PriceChange[], from = '2026-09-23', to = from) => ({
  data: { from, to, changes },
  isPending: false,
  isError: false,
});

describe('PriceChanges', () => {
  beforeEach(() => changesMock.mockReset());

  it('lists each move as time, point, grade, was → became and author', () => {
    changesMock.mockReturnValue(loaded([change({})]));
    renderAt();

    const [item] = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(item).toHaveTextContent(clock('2026-09-23T07:54:00.000Z'));
    expect(item).toHaveTextContent('Шипинки');
    expect(item).toHaveTextContent('Малина · 2 сорт');
    expect(item).toHaveTextContent('115.00 → 184.00 ₴');
    expect(item).toHaveTextContent('Керівник');
  });

  it('shows a first-ever price without a «was»', () => {
    changesMock.mockReturnValue(loaded([change({ previous_base_price: null })]));
    renderAt();

    const item = screen.getByRole('listitem');
    expect(item).toHaveTextContent('184.00 ₴');
    expect(item).not.toHaveTextContent('→');
  });

  it('quotes the reason when there is one', () => {
    changesMock.mockReturnValue(loaded([change({ reason: 'конкуренти підняли' })]));
    renderAt();
    expect(screen.getByRole('listitem')).toHaveTextContent('«конкуренти підняли»');
  });

  it('keeps the server order — newest first — rather than re-sorting', () => {
    changesMock.mockReturnValue(
      loaded([
        change({ id: 'a', point_name: 'Конищів' }),
        change({ id: 'b', point_name: 'Гайове' }),
      ]),
    );
    renderAt();
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Конищів');
    expect(items[1]).toHaveTextContent('Гайове');
  });

  it('says so when nothing moved today', () => {
    changesMock.mockReturnValue(loaded([]));
    renderAt();
    expect(screen.getByText(/No price has changed today/)).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('reports a failed read instead of an empty day', () => {
    changesMock.mockReturnValue({ data: undefined, isPending: false, isError: true });
    renderAt();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText(/No price has changed today/)).not.toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    changesMock.mockReturnValue(loaded([change({ reason: 'конкуренти підняли' })]));
    const { container } = renderAt();
    await expectNoAxeViolations(container);
  });
  describe('over a period', () => {
    it('asks the server for today when the URL names no period', () => {
      changesMock.mockReturnValue(loaded([]));
      renderAt();
      expect(changesMock).toHaveBeenCalledWith({ from: null, to: null });
      expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('reads the period from the URL and heads each day with its date', () => {
      const day = (d: number, h: number) => new Date(2026, 8, d, h).toISOString();
      changesMock.mockReturnValue(
        loaded(
          [
            change({ id: 'a', created_at: day(24, 10), point_name: 'Конищів' }),
            change({ id: 'b', created_at: day(22, 9), point_name: 'Гайове' }),
          ],
          '2026-09-20',
          '2026-09-24',
        ),
      );
      renderAt('/prices?changes_from=2026-09-20&changes_to=2026-09-24');

      expect(changesMock).toHaveBeenCalledWith({ from: '2026-09-20', to: '2026-09-24' });
      expect(screen.getByText('Price changes')).toBeInTheDocument();
      expect(
        within(screen.getByRole('region', { name: /24/ })).getByRole('listitem'),
      ).toHaveTextContent('Конищів');
      expect(
        within(screen.getByRole('region', { name: /22/ })).getByRole('listitem'),
      ).toHaveTextContent('Гайове');
    });

    it('puts a preset into the URL, and «Today» takes it back out', async () => {
      changesMock.mockReturnValue(loaded([]));
      const user = userEvent.setup();
      const { search } = renderAt();

      await user.click(screen.getByRole('button', { name: 'Yesterday' }));
      const yesterday = search().get('changes_from');
      expect(yesterday).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(search().get('changes_to')).toBe(yesterday);
      expect(screen.getByRole('button', { name: 'Yesterday' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );

      await user.click(screen.getByRole('button', { name: 'Today' }));
      expect(search().has('changes_from')).toBe(false);
      expect(search().has('changes_to')).toBe(false);
    });

    it('never commits a typed date mid-edit, however long the pause', () => {
      vi.useFakeTimers();
      try {
        changesMock.mockReturnValue(loaded([], '2026-09-20', '2026-09-24'));
        const { search } = renderAt('/prices?changes_from=2026-09-20&changes_to=2026-09-24');
        const to = screen.getByLabelText('To');
        to.focus();

        // «По» → the 10th: the first digit alone is the complete date 2026-09-01,
        // which would drag «З» down to it if it were committed.
        fireEvent.keyDown(to, { key: '1' });
        fireEvent.change(to, { target: { value: '2026-09-01' } });
        act(() => vi.advanceTimersByTime(5_000));
        expect(search().get('changes_from')).toBe('2026-09-20');
        expect(search().get('changes_to')).toBe('2026-09-24');

        fireEvent.keyDown(to, { key: '0' });
        fireEvent.change(to, { target: { value: '2026-09-10' } });
        fireEvent.blur(to);
        // Reversed against «З», so «З» follows — but to the FINISHED date.
        expect(search().get('changes_from')).toBe('2026-09-10');
        expect(search().get('changes_to')).toBe('2026-09-10');
      } finally {
        vi.useRealTimers();
      }
    });

    it('commits a typed date on blur', () => {
      changesMock.mockReturnValue(loaded([], '2026-09-20', '2026-09-24'));
      const { search } = renderAt('/prices?changes_from=2026-09-20&changes_to=2026-09-24');
      const from = screen.getByLabelText('From');

      fireEvent.keyDown(from, { key: '8' });
      fireEvent.change(from, { target: { value: '2026-09-18' } });
      expect(search().get('changes_from')).toBe('2026-09-20');
      fireEvent.blur(from);
      expect(search().get('changes_from')).toBe('2026-09-18');
      expect(search().get('changes_to')).toBe('2026-09-24');
    });

    /* The native picker fires `change` with no keystroke and keeps focus. */
    it('commits a date picked from the calendar at once, keeping focus', () => {
      changesMock.mockReturnValue(loaded([], '2026-09-20', '2026-09-24'));
      const { search } = renderAt('/prices?changes_from=2026-09-20&changes_to=2026-09-24');
      const from = screen.getByLabelText('From');
      from.focus();

      fireEvent.change(from, { target: { value: '2026-09-18' } });
      expect(search().get('changes_from')).toBe('2026-09-18');
      expect(search().get('changes_to')).toBe('2026-09-24');
      expect(screen.getByLabelText('From')).toHaveFocus();
    });

    it('lets the picker commit at once even after a keystroke earlier', () => {
      changesMock.mockReturnValue(loaded([], '2026-09-20', '2026-09-24'));
      const { search } = renderAt('/prices?changes_from=2026-09-20&changes_to=2026-09-24');
      const from = screen.getByLabelText('From');

      // An arrow steps the day segment — a typed edit, held back…
      fireEvent.keyDown(from, { key: 'ArrowUp' });
      fireEvent.change(from, { target: { value: '2026-09-21' } });
      expect(search().get('changes_from')).toBe('2026-09-20');
      // …then the mouse opens the picker and chooses: committed at once.
      fireEvent.pointerDown(from);
      fireEvent.change(from, { target: { value: '2026-09-18' } });
      expect(search().get('changes_from')).toBe('2026-09-18');
    });

    it('treats a calendar opened with Alt+↓ as a pick, and segment moves as no edit', () => {
      changesMock.mockReturnValue(loaded([], '2026-09-20', '2026-09-24'));
      const { search } = renderAt('/prices?changes_from=2026-09-20&changes_to=2026-09-24');
      const from = screen.getByLabelText('From');

      // A digit typed first, then a change of mind: the calendar from the keyboard.
      fireEvent.keyDown(from, { key: '1' });
      fireEvent.change(from, { target: { value: '2026-09-01' } });
      expect(search().get('changes_from')).toBe('2026-09-20');
      fireEvent.keyDown(from, { key: 'ArrowRight' });
      fireEvent.keyDown(from, { key: 'ArrowDown', altKey: true });
      fireEvent.change(from, { target: { value: '2026-09-18' } });
      expect(search().get('changes_from')).toBe('2026-09-18');
    });

    it('commits on Enter and keeps focus in the field', () => {
      changesMock.mockReturnValue(loaded([], '2026-09-20', '2026-09-24'));
      const { search } = renderAt('/prices?changes_from=2026-09-20&changes_to=2026-09-24');
      const to = screen.getByLabelText('To');
      to.focus();

      fireEvent.keyDown(to, { key: '2' });
      fireEvent.change(to, { target: { value: '2026-09-22' } });
      expect(search().get('changes_to')).toBe('2026-09-24');
      fireEvent.keyDown(to, { key: 'Enter' });
      expect(search().get('changes_to')).toBe('2026-09-22');
      expect(screen.getByLabelText('To')).toHaveFocus();
    });

    it('snaps an unfinished year back on blur', () => {
      changesMock.mockReturnValue(loaded([], '2026-09-20', '2026-09-24'));
      const { search } = renderAt('/prices?changes_from=2026-09-20&changes_to=2026-09-24');
      const from = screen.getByLabelText('From');

      fireEvent.keyDown(from, { key: '2' });
      fireEvent.change(from, { target: { value: '0202-09-18' } });
      fireEvent.blur(from);
      expect(search().get('changes_from')).toBe('2026-09-20');
      expect(from).toHaveValue('2026-09-20');
    });

    it('follows a preset into the fields', async () => {
      changesMock.mockReturnValue(loaded([]));
      renderAt('/prices?changes_from=2026-09-20&changes_to=2026-09-24');
      await userEvent.setup().click(screen.getByRole('button', { name: 'Yesterday' }));
      const yesterday = addDaysIso(todayIso(), -1);
      expect(screen.getByLabelText('From')).toHaveValue(yesterday);
      expect(screen.getByLabelText('To')).toHaveValue(yesterday);
    });

    it('heads each day with a level-2 heading that names its section', () => {
      changesMock.mockReturnValue(loaded([change({})], '2026-09-20', '2026-09-24'));
      renderAt('/prices?changes_from=2026-09-20&changes_to=2026-09-24');
      const heading = screen.getByRole('heading', { level: 2 });
      expect(screen.getByRole('region')).toHaveAccessibleName(heading.textContent!);
    });

    it('turns a link the server would refuse into today, and clears it from the URL', () => {
      changesMock.mockReturnValue(loaded([]));
      const { search } = renderAt('/prices?changes_from=2026-09-24&changes_to=2026-09-01');
      expect(changesMock).toHaveBeenCalledWith({ from: null, to: null });
      expect(search().has('changes_from')).toBe(false);
      expect(search().has('changes_to')).toBe(false);
    });

    it('says the PERIOD had no changes, not «today»', () => {
      changesMock.mockReturnValue(loaded([], '2026-09-24'));
      renderAt('/prices?changes_from=2026-09-24&changes_to=2026-09-24');
      expect(screen.getByText('No price changed in this period.')).toBeInTheDocument();
    });

    it('has no axe violations with day headings', async () => {
      changesMock.mockReturnValue(loaded([change({})], '2026-09-20', '2026-09-24'));
      const { container } = renderAt('/prices?changes_from=2026-09-20&changes_to=2026-09-24');
      await expectNoAxeViolations(container);
    });
  });
});

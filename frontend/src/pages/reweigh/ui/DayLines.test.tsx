import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/shared/api';
import { DayLines } from './DayLines';
import type { DayLine } from '../api/useDayReweighs';

const { voidMock, staffMock } = vi.hoisted(() => ({
  voidMock: vi.fn(),
  staffMock: vi.fn(),
}));

vi.mock('@/entities/reweigh', () => ({
  useVoidReweighItemMutation: () => ({ mutateAsync: voidMock, isPending: false }),
}));

vi.mock('@/entities/user', () => ({
  useStaffQuery: () => staffMock(),
}));

/** Once the reason row opens, two buttons share the void/сторнувати accessible
 *  name (the row's own opener, still on screen, and the reason row's confirm
 *  button, rendered after it in DOM order) — this grabs the LAST one, i.e.
 *  the confirm button, without relying on `Array.prototype.at` (unavailable
 *  under this project's ES2020 `lib` target). */
function lastButton(name: RegExp): HTMLElement {
  const matches = screen.getAllByRole('button', { name });
  return matches[matches.length - 1];
}

const line = (over = {}): DayLine => ({
  pointId: 'p1',
  pointName: 'Шипинки',
  item: {
    id: 'ri1',
    reweigh_id: 'rw1',
    item_order: 1,
    product_grade_id: 'g1',
    product_grade_name: 'Малина 1',
    product_id: 'pr1',
    product_name: 'Малина',
    gross_kg: '120.50',
    pallet_kg: '0.00',
    tare_weight_kg: '12.00',
    net_kg: '108.50',
    tare: [{ tare_type_id: 't1', tare_type_name: 'Ящик', units: 10 }],
    weighed_by_user_id: 'u1',
    voided_at: null,
    voided_by_user_id: null,
    void_reason: null,
    created_at: '2026-09-21T10:00:00.000Z',
    ...over,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  voidMock.mockReset();
  staffMock.mockReturnValue({ data: new Map() });
});

describe('DayLines', () => {
  it('lists a line with its point, time and net weight', () => {
    render(<DayLines lines={[line()]} isPending={false} isError={false} date="2026-09-21" />);
    const row = screen.getByRole('row', { name: /Шипинки/ });
    expect(within(row).getByText('108.50 kg')).toBeInTheDocument();
  });

  /**
   * «Товар» has to name the product, not only the grade — «Стандарт» alone
   * is the grade of eight different products in the seed catalogue (see
   * `dev-seed.data.ts`), so a bare grade name leaves the owner unable to
   * tell which berry was on the scale.
   */
  it('renders product and grade together', () => {
    render(<DayLines lines={[line()]} isPending={false} isError={false} date="2026-09-21" />);
    const row = screen.getByRole('row', { name: /Шипинки/ });
    expect(within(row).getByText('Малина — Малина 1')).toBeInTheDocument();
  });

  it('renders the grade alone when the product relation is missing — no dangling separator', () => {
    render(
      <DayLines lines={[line({ product_name: undefined })]} isPending={false} isError={false} date="2026-09-21" />,
    );
    const row = screen.getByRole('row', { name: /Шипинки/ });
    expect(within(row).getByText('Малина 1')).toBeInTheDocument();
    expect(within(row).queryByText(/—/)).not.toBeInTheDocument();
  });

  it('renders the product alone when the grade relation is missing — no dangling separator', () => {
    render(
      <DayLines lines={[line({ product_grade_name: undefined })]} isPending={false} isError={false} date="2026-09-21" />,
    );
    const row = screen.getByRole('row', { name: /Шипинки/ });
    expect(within(row).getByText('Малина')).toBeInTheDocument();
    expect(within(row).queryByText(/—/)).not.toBeInTheDocument();
  });

  it('renders nothing in the cell when both product and grade are missing', () => {
    render(
      <DayLines
        lines={[line({ product_name: undefined, product_grade_name: undefined })]}
        isPending={false} isError={false}
        date="2026-09-21"
      />,
    );
    const row = screen.getByRole('row', { name: /Шипинки/ });
    const whatCell = within(row).getAllByRole('cell')[2];
    expect(whatCell.textContent).toBe('');
  });

  /**
   * The finding in one assertion: two rows from DIFFERENT products that
   * happen to share the grade name «Стандарт» must read differently in the
   * «Товар» column. Before the fix both cells print «Стандарт» and this
   * assertion fails.
   */
  it('tells apart two products that share the same grade name', () => {
    const strawberry = line({ product_id: 'p1', product_name: 'Полуниця', product_grade_name: 'Стандарт' });
    const currant = {
      ...line({ id: 'ri2', product_id: 'p2', product_name: 'Порічка', product_grade_name: 'Стандарт' }),
      pointId: 'p2',
      pointName: 'Гайове',
    };
    render(<DayLines lines={[strawberry, currant]} isPending={false} isError={false} date="2026-09-21" />);

    const row1 = screen.getByRole('row', { name: /Шипинки/ });
    const row2 = screen.getByRole('row', { name: /Гайове/ });
    const whatCell1 = within(row1).getAllByRole('cell')[2];
    const whatCell2 = within(row2).getAllByRole('cell')[2];

    expect(whatCell1.textContent).not.toBe(whatCell2.textContent);
    expect(whatCell1.textContent).toBe('Полуниця — Стандарт');
    expect(whatCell2.textContent).toBe('Порічка — Стандарт');
  });

  it('asks for a reason and keeps the button inactive until one is typed', async () => {
    render(<DayLines lines={[line()]} isPending={false} isError={false} date="2026-09-21" />);
    await userEvent.click(screen.getByRole('button', { name: /void|сторнувати/i }));

    const confirm = lastButton(/void|сторнувати/i);
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/reason|причина/i), 'двічі ввели ту саму машину');
    expect(confirm).toBeEnabled();
  });

  it('voids by LINE id with the typed reason', async () => {
    voidMock.mockResolvedValue({});
    render(<DayLines lines={[line()]} isPending={false} isError={false} date="2026-09-21" />);
    await userEvent.click(screen.getByRole('button', { name: /void|сторнувати/i }));
    await userEvent.type(screen.getByLabelText(/reason|причина/i), 'двічі ввели ту саму машину');
    await userEvent.click(lastButton(/void|сторнувати/i));

    expect(voidMock).toHaveBeenCalledWith({ id: 'ri1', reason: 'двічі ввели ту саму машину' });
  });

  it('keeps a voided line on screen with its time, author and reason', () => {
    staffMock.mockReturnValue({ data: new Map([['u9', 'Керівник']]) });
    render(
      <DayLines
        lines={[line({ voided_at: '2026-09-21T12:00:00.000Z', voided_by_user_id: 'u9', void_reason: 'двічі ввели' })]}
        isPending={false} isError={false}
        date="2026-09-21"
      />,
    );
    const row = screen.getByRole('row', { name: /Шипинки/ });
    expect(within(row).getByText(/voided|сторновано/i)).toBeInTheDocument();
    expect(within(row).getByText(/Керівник/)).toBeInTheDocument();
    expect(within(row).getByText(/двічі ввели/)).toBeInTheDocument();
  });

  it('offers no storno on an already-voided line', () => {
    render(
      <DayLines lines={[line({ voided_at: '2026-09-21T12:00:00.000Z', voided_by_user_id: 'u9', void_reason: 'x' })]} isPending={false} isError={false} date="2026-09-21" />,
    );
    const row = screen.getByRole('row', { name: /Шипинки/ });
    expect(within(row).queryByRole('button', { name: /void|сторнувати/i })).not.toBeInTheDocument();
  });

  /**
   * This table can carry every weighing recorded NETWORK-WIDE for the day —
   * far more than a handful of rows — and the action column's header carries
   * no visible text (Finding 2), so a screen-reader user has only the
   * button's OWN accessible name to tell one row's storno button from
   * another's. The visible label stays the shared "Void"/«Сторнувати» text;
   * only the accessible name is per-row.
   */
  it("gives each row's storno button its own accessible name — point and time, not a repeated \"Void\"", () => {
    const shypynky = line();
    const haiove = {
      ...line({ id: 'ri2', created_at: '2026-09-21T11:30:00.000Z' }),
      pointId: 'p2',
      pointName: 'Гайове',
    };
    render(<DayLines lines={[shypynky, haiove]} isPending={false} isError={false} date="2026-09-21" />);

    const buttons = screen.getAllByRole('button', { name: /void/i });
    expect(buttons).toHaveLength(2);
    const [firstName, secondName] = buttons.map((b) => b.getAttribute('aria-label'));
    expect(firstName).not.toBe(secondName);
    expect(firstName).toMatch(/Шипинки/);
    expect(secondName).toMatch(/Гайове/);
  });

  it('says nothing happened that day rather than showing an empty frame', () => {
    render(<DayLines lines={[]} isPending={false} isError={false} date="2026-09-21" />);
    expect(screen.getByText(/no reweighing|переважувань ще немає/i)).toBeInTheDocument();
  });

  /**
   * A fan-out that lost a point renders SHORT, not empty — `useDayReweighs`
   * drops a failed point's lines and carries on. Captioned «по всіх пунктах»,
   * a short table is a weighing that reads as a weighing nobody recorded, and
   * this is the only surface a storno reaches from. So a failed read must say
   * so rather than borrow the empty state's sentence.
   */
  it('reports a failed read instead of an empty day', () => {
    render(<DayLines lines={[]} isPending={false} isError date="2026-09-21" />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText(/ще немає|no reweighs/i)).not.toBeInTheDocument();
  });

  it("surfaces the server's own refusal", async () => {
    voidMock.mockRejectedValue(new ApiError(409, 'Already voided', undefined, 'ALREADY_VOIDED'));
    render(<DayLines lines={[line()]} isPending={false} isError={false} date="2026-09-21" />);
    await userEvent.click(screen.getByRole('button', { name: /void|сторнувати/i }));
    await userEvent.type(screen.getByLabelText(/reason|причина/i), 'x');
    await userEvent.click(lastButton(/void|сторнувати/i));

    await waitFor(() => expect(screen.getByText(/already voided|вже сторновано/i)).toBeInTheDocument());
  });
});

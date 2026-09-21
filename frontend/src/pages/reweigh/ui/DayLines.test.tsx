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
    render(<DayLines lines={[line()]} isPending={false} date="2026-09-21" />);
    const row = screen.getByRole('row', { name: /Шипинки/ });
    expect(within(row).getByText('108.50 kg')).toBeInTheDocument();
  });

  it('asks for a reason and keeps the button inactive until one is typed', async () => {
    render(<DayLines lines={[line()]} isPending={false} date="2026-09-21" />);
    await userEvent.click(screen.getByRole('button', { name: /void|сторнувати/i }));

    const confirm = screen.getAllByRole('button', { name: /void|сторнувати/i }).at(-1)!;
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/reason|причина/i), 'двічі ввели ту саму машину');
    expect(confirm).toBeEnabled();
  });

  it('voids by LINE id with the typed reason', async () => {
    voidMock.mockResolvedValue({});
    render(<DayLines lines={[line()]} isPending={false} date="2026-09-21" />);
    await userEvent.click(screen.getByRole('button', { name: /void|сторнувати/i }));
    await userEvent.type(screen.getByLabelText(/reason|причина/i), 'двічі ввели ту саму машину');
    await userEvent.click(screen.getAllByRole('button', { name: /void|сторнувати/i }).at(-1)!);

    expect(voidMock).toHaveBeenCalledWith({ id: 'ri1', reason: 'двічі ввели ту саму машину' });
  });

  it('keeps a voided line on screen with its time, author and reason', () => {
    staffMock.mockReturnValue({ data: new Map([['u9', 'Керівник']]) });
    render(
      <DayLines
        lines={[line({ voided_at: '2026-09-21T12:00:00.000Z', voided_by_user_id: 'u9', void_reason: 'двічі ввели' })]}
        isPending={false}
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
      <DayLines lines={[line({ voided_at: '2026-09-21T12:00:00.000Z', voided_by_user_id: 'u9', void_reason: 'x' })]} isPending={false} date="2026-09-21" />,
    );
    const row = screen.getByRole('row', { name: /Шипинки/ });
    expect(within(row).queryByRole('button', { name: /void|сторнувати/i })).not.toBeInTheDocument();
  });

  it('says nothing happened that day rather than showing an empty frame', () => {
    render(<DayLines lines={[]} isPending={false} date="2026-09-21" />);
    expect(screen.getByText(/no reweighing|переважувань ще немає/i)).toBeInTheDocument();
  });

  it("surfaces the server's own refusal", async () => {
    voidMock.mockRejectedValue(new ApiError(409, 'Already voided', undefined, 'ALREADY_VOIDED'));
    render(<DayLines lines={[line()]} isPending={false} date="2026-09-21" />);
    await userEvent.click(screen.getByRole('button', { name: /void|сторнувати/i }));
    await userEvent.type(screen.getByLabelText(/reason|причина/i), 'x');
    await userEvent.click(screen.getAllByRole('button', { name: /void|сторнувати/i }).at(-1)!);

    await waitFor(() => expect(screen.getByText(/already voided|вже сторновано/i)).toBeInTheDocument());
  });
});

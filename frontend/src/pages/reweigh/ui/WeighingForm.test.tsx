import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WeighingForm } from './WeighingForm';

const { tareMock } = vi.hoisted(() => ({
  tareMock: vi.fn(),
}));

vi.mock('@/entities/tare-type', () => ({
  useTareTypeOptionsQuery: () => tareMock(),
}));

const GRADES = [
  {
    product_grade_id: 'g1',
    product_grade_name: 'Малина 1',
    product_id: 'p1',
    product_name: 'Малина',
    intake_net_kg: '200.00',
    reweigh_net_kg: '0.00',
  },
  {
    product_grade_id: 'g2',
    product_grade_name: 'Малина 3',
    product_id: 'p1',
    product_name: 'Малина',
    intake_net_kg: '100.00',
    reweigh_net_kg: '0.00',
  },
];

const base = {
  grades: GRADES,
  hasShift: true,
  acceptedAnything: true,
  pointName: 'Шипинки',
  date: '2026-09-21',
  onAdd: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  tareMock.mockReturnValue({
    data: [{ id: 't1', name: 'Ящик', weight_kg: '1.20' }],
    isPending: false,
  });
});

describe('WeighingForm', () => {
  it('computes чиста вага as gross − pallet − tare, live', async () => {
    render(<WeighingForm {...base} />);
    await userEvent.type(screen.getByLabelText(/gross|вага з ягодою/i), '120.50');
    await userEvent.type(screen.getByLabelText(/pallet|піддон/i), '20');
    await userEvent.clear(screen.getByLabelText(/crates|кількість ящиків/i));
    await userEvent.type(screen.getByLabelText(/crates|кількість ящиків/i), '10');

    // 120.50 − 20.00 − (10 × 1.20) = 88.50
    expect(screen.getByTestId('net-kg')).toHaveTextContent('88.50');
  });

  it("groups the picker by product and offers only the day's grades", () => {
    render(<WeighingForm {...base} />);
    const group = screen.getByRole('group', { name: 'Малина' });
    expect(within(group).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Малина 1',
      'Малина 3',
    ]);
  });

  it('keeps «+ ще позиція» inactive and says why, in order', async () => {
    render(<WeighingForm {...base} acceptedAnything={false} />);
    expect(screen.getByRole('button', { name: /another position|ще позиція/i })).toBeDisabled();
    expect(screen.getByText(/nothing was accepted|нічого не приймали/i)).toBeInTheDocument();
  });

  it('warns above the season record without blocking', async () => {
    render(<WeighingForm {...base} />);
    await userEvent.type(screen.getByLabelText(/gross|вага з ягодою/i), '900');
    expect(screen.getByText(/801|800|check the weight|перевірте вагу/i)).toBeInTheDocument();
    // a warning, never a block: with a grade chosen the button still works
    await userEvent.selectOptions(screen.getByLabelText(/grade|сорт/i), 'g1');
    expect(screen.getByRole('button', { name: /another position|ще позиція/i })).toBeEnabled();
  });

  it('hands up a complete draft and clears itself', async () => {
    const onAdd = vi.fn();
    render(<WeighingForm {...base} onAdd={onAdd} />);
    await userEvent.type(screen.getByLabelText(/gross|вага з ягодою/i), '120.50');
    await userEvent.selectOptions(screen.getByLabelText(/grade|сорт/i), 'g1');
    await userEvent.click(screen.getByRole('button', { name: /another position|ще позиція/i }));

    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        product_grade_id: 'g1',
        product_grade_name: 'Малина 1',
        product_id: 'p1',
        gross_kg: '120.50',
        pallet_kg: '0.00',
        net_kg: '120.50',
      }),
    );
    expect(screen.getByLabelText(/gross|вага з ягодою/i)).toHaveValue('');
  });

  it('never sends a computed tare weight as if it were typed', async () => {
    // tare_weight_kg is on the draft for DISPLAY; the POST body (Task 10) omits it.
    const onAdd = vi.fn();
    render(<WeighingForm {...base} onAdd={onAdd} />);
    await userEvent.type(screen.getByLabelText(/gross|вага з ягодою/i), '50');
    await userEvent.selectOptions(screen.getByLabelText(/grade|сорт/i), 'g1');
    await userEvent.click(screen.getByRole('button', { name: /another position|ще позиція/i }));
    expect(onAdd.mock.calls[0][0].tare).toEqual([]);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { i18n } from '@/shared/lib/i18n';
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
  // TWO tare types, `t1` first (the default `effectiveTareId` falls back to)
  // — this is what lets "hands up a complete draft" prove `handleAdd` KEEPS
  // a non-default selection rather than merely never having touched it.
  tareMock.mockReturnValue({
    data: [
      { id: 't1', name: 'Ящик', weight_kg: '1.20' },
      { id: 't2', name: 'Диб', weight_kg: '2.50' },
    ],
    isPending: false,
  });
});

// The locale test below switches to `uk` — reset unconditionally (even on a
// failed assertion) so it never leaks into a later file's "runs in ENGLISH"
// assumption. Mirrors `shared/lib/i18n/i18n.test.ts`'s own convention.
afterEach(async () => {
  await i18n.changeLanguage('en');
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

  it('keeps «+ Додати позицію» inactive and says why, in order', async () => {
    render(<WeighingForm {...base} acceptedAnything={false} />);
    expect(screen.getByRole('button', { name: /add position|додати позицію/i })).toBeDisabled();
    expect(screen.getByText(/nothing was accepted|нічого не приймали/i)).toBeInTheDocument();
  });

  it('warns above the season record without blocking', async () => {
    render(<WeighingForm {...base} />);
    await userEvent.type(screen.getByLabelText(/gross|вага з ягодою/i), '900');
    expect(screen.getByText(/801|800|check the weight|перевірте вагу/i)).toBeInTheDocument();
    // a warning, never a block: with a grade chosen the button still works
    await userEvent.selectOptions(screen.getByLabelText(/grade|сорт/i), 'g1');
    expect(screen.getByRole('button', { name: /add position|додати позицію/i })).toBeEnabled();
  });

  it('hands up a complete draft, clears the fields, and KEEPS a non-default tare type', async () => {
    const onAdd = vi.fn();
    render(<WeighingForm {...base} onAdd={onAdd} />);
    // Pick the NON-default tare type first — if `handleAdd` reset `tareId` to
    // the catalogue's first entry (the bug the requirement guards against),
    // asserting against the default `t1` would pass either way.
    await userEvent.selectOptions(screen.getByLabelText(/tare type|тип тари/i), 't2');
    await userEvent.type(screen.getByLabelText(/gross|вага з ягодою/i), '120.50');
    await userEvent.type(screen.getByLabelText(/pallet|піддон/i), '20');
    await userEvent.clear(screen.getByLabelText(/crates|кількість ящиків/i));
    await userEvent.type(screen.getByLabelText(/crates|кількість ящиків/i), '5');
    await userEvent.selectOptions(screen.getByLabelText(/grade|сорт/i), 'g1');
    await userEvent.click(screen.getByRole('button', { name: /add position|додати позицію/i }));

    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        product_grade_id: 'g1',
        product_grade_name: 'Малина 1',
        product_id: 'p1',
        gross_kg: '120.50',
        pallet_kg: '20',
        tare: [{ tare_type_id: 't2', units: 5 }],
      }),
    );

    // The five facts requirement 4 names: gross, pallet, crate count and
    // grade reset — but the crate TYPE does not, because it does not change
    // between pallets.
    expect(screen.getByLabelText(/gross|вага з ягодою/i)).toHaveValue('');
    expect(screen.getByLabelText(/pallet|піддон/i)).toHaveValue('');
    expect(screen.getByLabelText(/crates|кількість ящиків/i)).toHaveValue('0');
    expect(screen.getByLabelText(/grade|сорт/i)).toHaveValue('');
    expect(screen.getByLabelText(/tare type|тип тари/i)).toHaveValue('t2');
  });

  it('never sends a computed tare weight as if it were typed', async () => {
    // tare_weight_kg is on the draft for DISPLAY; the POST body (Task 10) omits it.
    const onAdd = vi.fn();
    render(<WeighingForm {...base} onAdd={onAdd} />);
    await userEvent.type(screen.getByLabelText(/gross|вага з ягодою/i), '50');
    await userEvent.selectOptions(screen.getByLabelText(/grade|сорт/i), 'g1');
    await userEvent.click(screen.getByRole('button', { name: /add position|додати позицію/i }));
    expect(onAdd.mock.calls[0][0].tare).toEqual([]);
  });

  /**
   * `uk` is this app's DEFAULT locale (`test-setup.ts` only switches to `en`
   * for the suite's own assertions) — every other number on this screen
   * localizes its separator, and the catalogue weight in the tare-type
   * option must too, or it is the one stray period on an otherwise
   * Ukrainian-formatted screen.
   */
  it("formats the tare type's catalogue weight for the active locale, not a raw decimal string", async () => {
    await i18n.changeLanguage('uk');
    render(<WeighingForm {...base} />);
    expect(screen.getByText('Ящик 1,20 кг')).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { i18n } from '@/shared/lib/i18n';
import type { CostOfDay, CostOfDayProduct } from '@/entities/cost-of-day';
import { ChecksDisclosure } from './ChecksDisclosure';

beforeAll(async () => {
  await i18n.changeLanguage('uk');
});
afterAll(async () => {
  await i18n.changeLanguage('en');
});

// formatUah separates thousands and the ₴ with non-breaking spaces.
const norm = (s: string | null) => (s ?? '').replace(/\s/g, ' ');

const product = (name: string, basket_share: string, full_cost: string): CostOfDayProduct =>
  ({
    product_id: name,
    product_name: name,
    complete: true,
    basket_share,
    full_cost,
  }) as CostOfDayProduct;

const day: CostOfDay = {
  basket: '1965.19',
  shortfall_amount: '265.19',
  expenses_amount: '1700.00',
  accrued: '113640.80',
  full_cost: '115340.80',
  unweighed: { intake_kg: '0.00', accrued: '0.00' },
  checks: { shares_ok: true, total_ok: true },
  products: [product('Кизил', '50.49', '647.09'), product('Малина', '1914.70', '114693.71')],
} as CostOfDay;

const renderIt = (over: Partial<CostOfDay> = {}, onOpenChange = vi.fn(), open = false) =>
  render(
    <ChecksDisclosure
      day={{ ...day, ...over }}
      locale="uk"
      open={open}
      onOpenChange={onOpenChange}
    />,
  );

describe('ChecksDisclosure', () => {
  it('prints both identities from server figures, each operand named by its product — audit E4', () => {
    const { container } = renderIt();
    const text = norm(container.textContent);
    expect(text).toContain(
      'Кизил 50,49 + Малина 1 914,70 = 1 965,19 ₴ = недостача 265,19 ₴ + витрати 1 700,00 ₴',
    );
    expect(text).toContain(
      'Кизил 647,09 + Малина 114 693,71 = 115 340,80 ₴ = нараховано 113 640,80 ₴ + витрати 1 700,00 ₴',
    );
    expect(container.querySelector('details#cost-checks')).not.toBeNull();
  });

  it('writes the unweighed identity', () => {
    const { container } = renderIt({ unweighed: { intake_kg: '10.00', accrued: '500.00' } });
    expect(norm(container.textContent)).toContain('не перезважено 500,00 ₴');
  });

  it('summary reads «Не сходиться» when a check fails', () => {
    const { container } = renderIt({ checks: { shares_ok: true, total_ok: false } });
    const summary = container.querySelector('summary')?.textContent ?? '';
    expect(summary).toContain('Не сходиться');
    expect(summary).not.toContain('Звірено');
  });

  it('renders nothing when checks is null', () => {
    const { container } = renderIt({ checks: null });
    expect(container).toBeEmptyDOMElement();
  });

  it('follows open and reports user toggles', () => {
    const onOpenChange = vi.fn();
    const { container } = renderIt({}, onOpenChange, true);
    const d = container.querySelector('details') as HTMLDetailsElement;
    expect(d.open).toBe(true);
    d.open = false;
    fireEvent(d, new Event('toggle'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

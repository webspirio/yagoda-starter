import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { i18n } from '@/shared/lib/i18n';
import type { CostOfDay, CostOfDayProduct } from '@/entities/cost-of-day';
import { StatusChips } from './StatusChips';

// Ukrainian copy asserted; the suite defaults to 'en' (see ExpensesStrip.test).
beforeAll(async () => {
  await i18n.changeLanguage('uk');
});
afterAll(async () => {
  await i18n.changeLanguage('en');
});

const product = (over: Partial<CostOfDayProduct> = {}): CostOfDayProduct =>
  ({
    product_id: 'p1',
    product_name: 'Малина',
    complete: true,
    top_ups: '0.00',
    ...over,
  }) as CostOfDayProduct;

const day: CostOfDay = {
  shift_id: 's1',
  closed_at: '2026-10-19T18:00:00.000Z',
  provisional: false,
  top_ups_latest_at: null,
  top_ups_total: '0.00',
  checks: { shares_ok: true, total_ok: true },
  products: [product()],
} as CostOfDay;

const renderChips = (over: Partial<CostOfDay> = {}, onChecksClick = vi.fn()) =>
  render(<StatusChips day={{ ...day, ...over }} locale="uk" onChecksClick={onChecksClick} />);

describe('StatusChips', () => {
  it('closed + all weighed + checked', () => {
    renderChips();
    expect(screen.getByText('Зміну закрито')).toBeInTheDocument();
    expect(screen.getByText('Усе перезважено')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Звірено' })).toBeInTheDocument();
  });

  it('the checks chip points at the disclosure it opens', () => {
    renderChips();
    expect(screen.getByRole('button', { name: 'Звірено' })).toHaveAttribute(
      'aria-controls',
      'cost-checks',
    );
  });

  it('open shift is neutral, never amber', () => {
    const { container } = renderChips({ provisional: true });
    expect(screen.getByText('Зміна ще відкрита — цифри рухаються')).toBeInTheDocument();
    expect(container.innerHTML).not.toContain('amber');
  });

  it('names the products not reweighed', () => {
    renderChips({
      products: [product(), product({ product_id: 'p2', product_name: 'Ожина', complete: false })],
    });
    expect(screen.getByText('Не перезважено: Ожина')).toBeInTheDocument();
  });

  it('names the доплати by amount and product, the latest time as its title', () => {
    renderChips({
      top_ups_latest_at: '2026-10-20T10:00:00.000Z',
      top_ups_total: '15000.00',
      products: [
        product({ top_ups: '15000.00' }),
        product({ product_id: 'p2', product_name: 'Кизил' }),
      ],
    });
    const chip = screen.getByText(/^Доплати:/);
    expect(chip).toHaveTextContent('Доплати: 15 000,00 ₴ (Малина)');
    expect(chip.closest('[title]')).toHaveAttribute(
      'title',
      expect.stringMatching(/^Остання доплата внесена /),
    );
  });

  it('shows no доплати chip on a day without them', () => {
    renderChips();
    expect(screen.queryByText(/^Доплати/)).not.toBeInTheDocument();
  });

  it('checks null reads as pending and is not a button', () => {
    renderChips({ checks: null });
    expect(screen.getByText('Звірка — після переважування')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('mismatch is clickable', async () => {
    const onChecksClick = vi.fn();
    renderChips({ checks: { shares_ok: true, total_ok: false } }, onChecksClick);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Не сходиться' }));
    expect(onChecksClick).toHaveBeenCalledTimes(1);
  });
});

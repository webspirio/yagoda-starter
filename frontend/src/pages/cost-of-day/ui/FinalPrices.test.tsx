import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { i18n } from '@/shared/lib/i18n';
import type { CostOfDay } from '@/entities/cost-of-day';
import { FinalPrices } from './FinalPrices';

// Every assertion below is the Ukrainian copy the component's own t() calls
// produce, but `test-setup.ts` defaults the active i18n language to 'en' for
// the whole suite (see `WeighingForm.test.tsx` for the same convention). Set
// it here for this file only, and reset it afterwards so it never leaks into
// a later file's "runs in ENGLISH" assumption.
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
  products: [
    {
      product_id: 'p-rasp',
      product_name: 'Малина',
      accrued: '128000.00',
      intake_net_kg: '800.00',
      reweigh_net_kg: '790.00',
      shortfall: '1600.00',
      basket_share: '5050.82',
      price_was: '160.00',
      price_cost: '166.39',
      price_by_our_weight: '162.03',
      complete: true,
    },
    {
      product_id: 'p-black',
      product_name: 'Ожина',
      accrued: '3900.00',
      intake_net_kg: '65.00',
      reweigh_net_kg: '64.00',
      shortfall: '60.00',
      basket_share: '409.18',
      price_was: '60.00',
      price_cost: '66.39',
      price_by_our_weight: '60.94',
      complete: true,
    },
  ],
};

describe('FinalPrices', () => {
  it('prints §8.4 three prices for a product', () => {
    render(<FinalPrices day={day} locale="uk" />);

    const row = screen.getByRole('row', { name: /Малина/ });
    expect(within(row).getByText('160,00')).toBeInTheDocument(); // було
    expect(within(row).getByText('166,39')).toBeInTheDocument(); // собівартість
    expect(within(row).getByText('162,03')).toBeInTheDocument(); // нараховане ÷ наша вага
  });

  it('shows «разом» as нараховано plus the allocated share', () => {
    render(<FinalPrices day={day} locale="uk" />);

    // 128 000,00 + 5 050,82 — two server figures added, never a division.
    const row = screen.getByRole('row', { name: /Малина/ });
    expect(within(row).getByText('133 050,82 ₴')).toBeInTheDocument();
  });

  it('reports the Σ із пулу = КОШИК звірка as passing', () => {
    render(<FinalPrices day={day} locale="uk" />);

    const check = screen.getByText(/Σ із пулу/);
    expect(check).toHaveTextContent('5 460,00 ₴');
    expect(check).toHaveAttribute('data-ok', 'true');
  });

  it('reports the звірка as FAILING when the shares do not sum to the basket', () => {
    const broken = { ...day, basket: '5461.00' };
    render(<FinalPrices day={broken} locale="uk" />);

    // The check exists to be read by a person, not to be decorative — a
    // mismatch has to look like one.
    expect(screen.getByText(/Σ із пулу/)).toHaveAttribute('data-ok', 'false');
  });

  it('dashes every derived cell for a product left out of the day', () => {
    const partial: CostOfDay = {
      ...day,
      products: [
        { ...day.products[0], reweigh_net_kg: null, basket_share: null, price_cost: null, price_by_our_weight: null, complete: false },
      ],
    };
    render(<FinalPrices day={partial} locale="uk" />);

    const row = screen.getByRole('row', { name: /Малина/ });
    expect(within(row).getAllByText('—').length).toBeGreaterThanOrEqual(4);
    expect(within(row).queryByText('0,00 ₴')).not.toBeInTheDocument();
  });

  it('prints §8.4 own звірка — нараховано plus витрати', () => {
    render(<FinalPrices day={day} locale="uk" />);
    const check = screen.getByText(/131 900,00/);
    expect(check).toHaveTextContent('135 700,00 ₴');
    expect(check).toHaveTextContent('3 800,00 ₴');
  });
});

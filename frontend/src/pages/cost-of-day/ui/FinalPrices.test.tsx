import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
      shortfall_kg: '10.00',
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
      shortfall_kg: '1.00',
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
    expect(within(row).getByText('160,00')).toBeInTheDocument(); // ціна в квитанції
    expect(within(row).getByText('166,39')).toBeInTheDocument(); // собівартість
    expect(within(row).getByText('162,03')).toBeInTheDocument(); // закупівельна ціна
    expect(screen.getByRole('columnheader', { name: 'ціна в квитанції' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /^закупівельна ціна/ })).toBeInTheDocument();
  });

  it('explains «закупівельна ціна» — what it counts and what it leaves out', async () => {
    const user = userEvent.setup();
    render(<FinalPrices day={day} locale="uk" />);

    await user.hover(screen.getByRole('button', { name: 'Що таке закупівельна ціна' }));

    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent(/нараховане ÷ наша вага/);
    expect(tip).toHaveTextContent(/Враховує:.*усушку саме цього товару/);
    expect(tip).toHaveTextContent(/Не враховує:.*витрати дня/);
  });

  it('shows «разом» as нараховано minus its недостача plus the allocated share', () => {
    render(<FinalPrices day={day} locale="uk" />);

    // 128 000,00 − 1 600,00 + 5 050,82: the недостача is already inside
    // нараховано, and the pool only moves it — adding the share alone
    // counted it twice.
    const row = screen.getByRole('row', { name: /Малина/ });
    expect(within(row).getByText('131 450,82 ₴')).toBeInTheDocument();
  });

  it('foots the «разом» column to нараховано + витрати, and the звірка says so', () => {
    // 131 450,82 (Малина) + 4 249,18 (Ожина: 3 900,00 − 60,00 + 409,18)
    // = 135 700,00 = 131 900,00 + 3 800,00 — §8.4's own identity.
    render(<FinalPrices day={day} locale="uk" />);

    const footerRow = screen.getByRole('row', { name: /РАЗОМ/ });
    expect(within(footerRow).getByText('135 700,00 ₴')).toBeInTheDocument();
    const check = screen.getByText(/131 900,00/);
    expect(check).toHaveTextContent('135 700,00 ₴');
    expect(check).toHaveAttribute('data-ok', 'true');
  });

  it('foots a pool made only of недостача to нараховано itself (Гайове)', () => {
    // No expenses: the 40,80 недостача is the whole basket and lands back on
    // the same product, so разом is нараховано — never 2 614,60.
    const shortOnly: CostOfDay = {
      ...day,
      accrued: '2573.80',
      shortfall_amount: '40.80',
      expenses_amount: '0.00',
      basket: '40.80',
      total_check: '2573.80',
      products: [
        {
          ...day.products[0],
          accrued: '2573.80',
          shortfall: '40.80',
          basket_share: '40.80',
        },
      ],
    };
    render(<FinalPrices day={shortOnly} locale="uk" />);

    const footerRow = screen.getByRole('row', { name: /РАЗОМ/ });
    expect(within(footerRow).getByText('2 573,80 ₴')).toBeInTheDocument();
    expect(screen.queryByText('2 614,60 ₴')).not.toBeInTheDocument();
    expect(screen.getByText(/нараховано 2 573,80/)).toHaveAttribute('data-ok', 'true');
  });

  it('flags the разом звірка as FAILING against the server’s own total_check', () => {
    // total_check is computed server-side from нараховано + витрати, not from
    // the shares this column is built of — so a column that does not foot to
    // it (as the old double-counted «разом» did, 137 360,00) reads ✗.
    render(<FinalPrices day={{ ...day, total_check: '137360.00' }} locale="uk" />);
    expect(screen.getByText(/131 900,00/)).toHaveAttribute('data-ok', 'false');
  });

  it('names the unweighed products in the звірка instead of shrinking нараховано', () => {
    // Ожина is not reweighed: it carries no share and no «разом», so the
    // column covers Малина only. The line still states the day's нараховано
    // (the same 131 900,00 the berry table prints) and adds Ожина back by name.
    const partial: CostOfDay = {
      ...day,
      shortfall_amount: '1600.00',
      basket: '5400.00',
      products: [
        { ...day.products[0], basket_share: '5400.00' },
        {
          ...day.products[1],
          reweigh_net_kg: null,
          shortfall: '0.00',
          shortfall_kg: '0.00',
          basket_share: null,
          price_cost: null,
          price_by_our_weight: null,
          complete: false,
        },
      ],
    };
    render(<FinalPrices day={partial} locale="uk" />);

    // 128 000,00 − 1 600,00 + 5 400,00 = 131 800,00; + 3 900,00 = 135 700,00.
    const check = screen.getByText(/не перезважено/);
    expect(check).toHaveTextContent(
      '131 800,00 ₴ + не перезважено 3 900,00 ₴ = нараховано 131 900,00 ₴ + витрати 3 800,00 ₴',
    );
    expect(check).toHaveAttribute('data-ok', 'true');
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
        {
          ...day.products[0],
          reweigh_net_kg: null,
          basket_share: null,
          price_cost: null,
          price_by_our_weight: null,
          complete: false,
        },
      ],
    };
    render(<FinalPrices day={partial} locale="uk" />);

    const row = screen.getByRole('row', { name: /Малина/ });
    expect(within(row).getAllByText('—').length).toBeGreaterThanOrEqual(4);
    expect(within(row).queryByText('0,00 ₴')).not.toBeInTheDocument();
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { i18n } from '@/shared/lib/i18n';
import type { CostOfDayProduct } from '@/entities/cost-of-day';
import { BerryTable } from './BerryTable';

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

const weighed: CostOfDayProduct = {
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
};

const unweighed: CostOfDayProduct = {
  ...weighed,
  product_id: 'p-black',
  product_name: 'Ожина',
  reweigh_net_kg: null,
  shortfall: '0.00',
  shortfall_kg: '0.00',
  basket_share: null,
  price_cost: null,
  price_by_our_weight: null,
  complete: false,
};

const renderTable = (products: CostOfDayProduct[]) =>
  render(
    <BerryTable
      products={products}
      reweighedKg="790.00"
      accrued="128000.00"
      shortfallAmount="1600.00"
      locale="uk"
    />,
  );

describe('BerryTable', () => {
  it('prints both weights, the rate and what was accrued on one product row', () => {
    renderTable([weighed]);

    expect(screen.getByRole('columnheader', { name: 'вага пункту' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'наша вага' })).toBeInTheDocument();
    const row = screen.getByRole('row', { name: /Малина/ });
    expect(within(row).getByText('800,00 кг')).toBeInTheDocument();
    expect(within(row).getByText('790,00 кг')).toBeInTheDocument();
    expect(within(row).getByText('160,00')).toBeInTheDocument();
    expect(within(row).getByText('128 000,00 ₴')).toBeInTheDocument();
  });

  it('puts the недостача in two unit-labelled columns of the product row', () => {
    renderTable([weighed]);

    expect(screen.getByRole('columnheader', { name: /^недостача, кг/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'недостача, ₴' })).toBeInTheDocument();
    const row = screen.getByRole('row', { name: /Малина/ });
    expect(within(row).getByText('10,00 кг')).toBeInTheDocument();
    expect(within(row).getByText('1 600,00 ₴')).toBeInTheDocument();
  });

  it('explains why «недостача, кг» is not вага пункту minus наша вага', async () => {
    const user = userEvent.setup();
    renderTable([weighed]);

    await user.hover(screen.getByRole('button', { name: 'Як рахується недостача' }));

    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent(/по кожному сорту окремо/);
    expect(tip).toHaveTextContent(/надлишок одного сорту не зменшує/);
    expect(tip).toHaveTextContent(/неперезважені продукти входять у «вагу пункту»/);
  });

  it('prints «наша вага» and the недостача as dashes, never zeros, when nothing was weighed', () => {
    renderTable([unweighed]);

    // §8.6's «Це не нуль»: «0,00 кг» beside 128 000,00 accrued reads as
    // berries that vanished, rather than berries nobody has weighed yet.
    const row = screen.getByRole('row', { name: /Ожина/ });
    expect(within(row).getByText('не перезважено')).toBeInTheDocument();
    expect(within(row).getAllByText('—')).toHaveLength(3);
    expect(within(row).queryByText('0,00 кг')).not.toBeInTheDocument();
  });

  it('prints the footer as dashes too when no product was weighed in full', () => {
    render(
      <BerryTable
        products={[unweighed]}
        reweighedKg="0.00"
        accrued="128000.00"
        shortfallAmount="0.00"
        locale="uk"
      />,
    );

    const total = screen.getByRole('row', { name: /РАЗОМ по пункту/ });
    expect(within(total).getAllByText('—')).toHaveLength(3);
    expect(within(total).queryByText('0,00 кг')).not.toBeInTheDocument();
    expect(within(total).queryByText('0,00 ₴')).not.toBeInTheDocument();
  });

  it('totals a mixed day: вага пункту counts the unweighed product, наша вага and недостача do not', () => {
    renderTable([weighed, unweighed]);

    const total = screen.getByRole('row', { name: /РАЗОМ по пункту/ });
    expect(within(total).getByText('1 600,00 кг')).toBeInTheDocument();
    expect(within(total).getByText('790,00 кг')).toBeInTheDocument();
    expect(within(total).getByText('10,00 кг')).toBeInTheDocument();
    expect(within(total).getByText('1 600,00 ₴')).toBeInTheDocument();
    expect(within(total).queryByText('—')).not.toBeInTheDocument();
  });

  it('prints a checked zero as 0,00 when the product was weighed and nothing is missing', () => {
    renderTable([{ ...weighed, shortfall: '0.00', shortfall_kg: '0.00' }]);

    const row = screen.getByRole('row', { name: /Малина/ });
    expect(within(row).getByText('0,00 кг')).toBeInTheDocument();
    expect(within(row).getByText('0,00 ₴')).toBeInTheDocument();
  });

  it("totals the point's weight and ours in their own columns of one row", () => {
    renderTable([weighed]);

    // 790 кг is the BASE's total: it sits under «наша вага», never under the
    // point's own weight column.
    const total = screen.getByRole('row', { name: /РАЗОМ по пункту/ });
    expect(within(total).getByText('800,00 кг')).toBeInTheDocument();
    expect(within(total).getByText('790,00 кг')).toBeInTheDocument();
    expect(within(total).getByText('128 000,00 ₴')).toBeInTheDocument();
    expect(within(total).getByText('10,00 кг')).toBeInTheDocument();
    expect(within(total).getByText('1 600,00 ₴')).toBeInTheDocument();
    // Header, one row per product, the total — no sub-rows.
    expect(screen.getAllByRole('row')).toHaveLength(3);
  });
});

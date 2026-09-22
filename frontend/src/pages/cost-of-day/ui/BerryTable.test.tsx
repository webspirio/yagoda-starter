import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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
  basket_share: null,
  price_cost: null,
  price_by_our_weight: null,
  complete: false,
};

const renderTable = (products: CostOfDayProduct[]) =>
  render(
    <BerryTable products={products} reweighedKg="790.00" accrued="128000.00" locale="uk" />,
  );

describe('BerryTable', () => {
  it("prints the point's weight, its rate and what it accrued", () => {
    renderTable([weighed]);

    const row = screen.getByRole('row', { name: /Малина/ });
    expect(within(row).getByText('800,00 кг')).toBeInTheDocument();
    expect(within(row).getByText('160,00')).toBeInTheDocument();
    expect(within(row).getByText('128 000,00 ₴')).toBeInTheDocument();
  });

  it('shows the недостача as its own line when there is one', () => {
    renderTable([weighed]);
    expect(screen.getByText('недостача')).toBeInTheDocument();
    expect(screen.getByText('1 600,00 ₴')).toBeInTheDocument();
  });

  it('prints «наша вага» as a dash, never a zero, when nothing was weighed', () => {
    renderTable([unweighed]);

    // §8.6's «Це не нуль»: «0,00 кг наша вага» beside 128 000,00 accrued reads
    // as berries that vanished, rather than berries nobody has weighed yet.
    // Scoped by the BADGE, not by «наша вага»: the totals below carry a
    // «наша вага, разом» row that the looser name would match as well.
    const ourWeight = screen.getByRole('row', { name: /не перезважено/ });
    expect(within(ourWeight).getAllByText('—')).toHaveLength(2);
    expect(within(ourWeight).queryByText('0,00 кг')).not.toBeInTheDocument();
  });

  it('omits the недостача line entirely when nothing is missing', () => {
    renderTable([{ ...weighed, shortfall: '0.00' }]);
    expect(screen.queryByText('недостача')).not.toBeInTheDocument();
  });

  it("totals the point's weight and ours as two separate rows", () => {
    renderTable([weighed]);

    const pointTotal = screen.getByRole('row', { name: /РАЗОМ по пункту/ });
    expect(within(pointTotal).getByText('800,00 кг')).toBeInTheDocument();
    expect(within(pointTotal).getByText('128 000,00 ₴')).toBeInTheDocument();

    // 790 кг is the BASE's number and belongs on its own line. Printed under
    // «РАЗОМ по пункту» it would claim the point weighed in what the base
    // weighed out — the exact disagreement this screen exists to show.
    const ourTotal = screen.getByRole('row', { name: /наша вага, разом/ });
    expect(within(ourTotal).getByText('790,00 кг')).toBeInTheDocument();
  });
});

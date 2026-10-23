import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { i18n } from '@/shared/lib/i18n';
import type { CostOfDay, CostOfDayProduct } from '@/entities/cost-of-day';
import { CostTable } from './CostTable';

// Ukrainian copy on purpose — `test-setup.ts` defaults the suite to 'en', so
// switch for this file only and switch back so it never leaks (same convention
// as `BerryTable.test.tsx`).
beforeAll(async () => {
  await i18n.changeLanguage('uk');
});

afterAll(async () => {
  await i18n.changeLanguage('en');
});

// Гайове, 19.10 — the real day the spec (2026-10-23 §4.2) is written against.
// Every figure is what the server sends; the component must only format it.
const cornel: CostOfDayProduct = {
  product_id: 'p-cornel',
  product_name: 'Кизил',
  accrued: '596.60',
  intake_net_kg: '15.70',
  reweigh_net_kg: '15.70',
  shortfall: '0.00',
  shortfall_kg: '0.00',
  shortfall_share: '6.81',
  expenses_share: '43.68',
  basket_share: '50.49',
  full_cost: '647.09',
  price_was: '38.00',
  price_cost: '41.22',
  price_by_our_weight: '38.00',
  complete: true,
  grades: [
    {
      product_grade_id: 'g-cornel-1',
      product_grade_name: 'Кизил сорт 1',
      accrued: '596.60',
      intake_net_kg: '15.70',
      reweigh_net_kg: '15.70',
      price_was: '38.00',
    },
  ],
};

const raspberry: CostOfDayProduct = {
  product_id: 'p-rasp',
  product_name: 'Малина',
  accrued: '113044.20',
  intake_net_kg: '596.80',
  reweigh_net_kg: '595.40',
  shortfall: '265.19',
  shortfall_kg: '1.40',
  shortfall_share: '258.38',
  expenses_share: '1656.32',
  basket_share: '1914.70',
  full_cost: '114693.71',
  price_was: '189.42',
  price_cost: '192.64',
  price_by_our_weight: '189.86',
  complete: true,
  grades: [
    {
      product_grade_id: 'g-rasp-1',
      product_grade_name: 'Сорт 1',
      accrued: '64860.00',
      intake_net_kg: '324.30',
      reweigh_net_kg: '218.00',
      price_was: '200.00',
    },
    {
      product_grade_id: 'g-rasp-2',
      product_grade_name: 'Сорт 2',
      accrued: '48184.20',
      intake_net_kg: '272.50',
      reweigh_net_kg: '377.40',
      price_was: '176.82',
    },
  ],
};

const day: CostOfDay = {
  shift_id: 's-1910',
  closed_at: '2026-10-19T18:00:00.000Z',
  provisional: false,
  accrued: '113640.80',
  reweighed_kg: '611.10',
  shortfall_amount: '265.19',
  expenses_amount: '1700.00',
  basket: '1965.19',
  per_kg: '3.22',
  shortfall_per_kg: '0.43',
  expenses_per_kg: '2.79',
  total_check: '115340.80',
  weighed: {
    intake_kg: '612.50',
    shortfall_kg: '1.40',
    accrued: '113640.80',
    shortfall: '265.19',
    price_was: '185.54',
  },
  full_cost: '115340.80',
  price_cost_avg: '188.74',
  unweighed: { intake_kg: '0.00', accrued: '0.00' },
  checks: { shares_ok: true, total_ok: true },
  top_ups_included: true,
  top_ups_latest_at: null,
  products: [cornel, raspberry],
};

const renderTable = (d: CostOfDay = day) => render(<CostTable day={d} locale="uk" />);

/** The cells of a row, in column order (the first is the product's name). */
const cellsOf = (row: HTMLElement) => within(row).getAllByRole('cell');

describe('CostTable', () => {
  it('reads a row left to right as ціна + недостача + витрати = собівартість', () => {
    renderTable();

    const row = screen.getByRole('row', { name: /Малина/ });
    const texts = cellsOf(row).map((c) => c.textContent);
    expect(texts.slice(1)).toEqual([
      '596,80',
      '595,40',
      '−1,40',
      '113 044,20 ₴',
      '189,42',
      '−265,19',
      '0,43',
      '2,79',
      '192,64',
      '+3,22',
    ]);
  });

  it('prints a weighed zero as a muted 0,00', () => {
    renderTable();

    const notArrived = cellsOf(screen.getByRole('row', { name: /Кизил/ }))[3];
    expect(notArrived).toHaveTextContent(/^0,00$/);
    expect(notArrived.querySelector('[class*="--amber"]')).toBeNull();
    expect(notArrived.innerHTML).toContain('text-muted-foreground');
  });

  it('totals weighed products and leaves Δ empty', () => {
    renderTable();

    const total = screen.getByRole('row', { name: /^Пункт/ });
    const texts = cellsOf(total).map((c) => c.textContent);
    expect(texts).toEqual([
      'Пункт',
      '612,50',
      '611,10',
      '−1,40',
      '113 640,80 ₴',
      '185,54',
      '−265,19',
      '0,43',
      '2,79',
      '188,74',
      '',
    ]);
    // Nothing is left out of the total, so the «не перезважено» line is absent.
    expect(screen.queryByText(/Не перезважено, не входить у підсумок/)).not.toBeInTheDocument();
  });

  it('opens a product into its share and its grades', async () => {
    const user = userEvent.setup();
    renderTable();

    expect(screen.queryByText('Сорт 1')).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Показати сорти: Малина' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);

    const share = screen.getByText(/Частка дня в гривнях/);
    expect(share).toHaveTextContent('258,38');
    expect(share).toHaveTextContent('1 656,32');
    expect(share).toHaveTextContent('1 914,70');
    expect(share).toHaveTextContent('114 693,71');
    expect(share).toHaveTextContent('189,86');

    const grade = screen.getByText('Сорт 1').closest('tr') as HTMLElement;
    expect(cellsOf(grade).map((c) => c.textContent)).toEqual([
      'Сорт 1',
      '324,30',
      '218,00',
      '',
      '64 860,00 ₴',
      '200,00',
      '',
      '',
      '',
      '',
      '',
    ]);
    expect(screen.getByText('Сорт 2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Сховати сорти: Малина' }));
    expect(screen.queryByText('Сорт 1')).not.toBeInTheDocument();
    expect(screen.queryByText(/Частка дня в гривнях/)).not.toBeInTheDocument();
  });

  it('dashes a product not reweighed in full and reports it under the total', () => {
    const blackberry: CostOfDayProduct = {
      ...raspberry,
      product_id: 'p-black',
      product_name: 'Ожина',
      accrued: '9000.00',
      intake_net_kg: '60.00',
      reweigh_net_kg: null,
      shortfall: '0.00',
      shortfall_kg: '0.00',
      shortfall_share: null,
      expenses_share: null,
      basket_share: null,
      full_cost: null,
      price_was: '150.00',
      price_cost: null,
      price_by_our_weight: null,
      complete: false,
      grades: [],
    };
    renderTable({
      ...day,
      products: [cornel, raspberry, blackberry],
      unweighed: { intake_kg: '60.00', accrued: '9000.00' },
    });

    const row = screen.getByRole('row', { name: /Ожина/ });
    expect(within(row).getByText('не перезважено')).toBeInTheDocument();
    const texts = cellsOf(row).map((c) => c.textContent);
    expect(texts.slice(1)).toEqual([
      '60,00',
      '—',
      '—',
      '9 000,00 ₴',
      '150,00',
      '—',
      '—',
      '—',
      '—',
      '—',
    ]);

    // Not folded into the total — it sits on its own muted line under it.
    const total = screen.getByRole('row', { name: /^Пункт/ });
    expect(total).toHaveTextContent('612,50');
    expect(total).not.toHaveTextContent('9 000,00');
    expect(
      screen.getByText('Не перезважено, не входить у підсумок: 60,00 кг · 9 000,00 ₴'),
    ).toBeInTheDocument();
  });

  it('shows the awaiting note instead of the reading hint when nothing is weighed', () => {
    const unweighedRasp: CostOfDayProduct = {
      ...raspberry,
      reweigh_net_kg: null,
      shortfall: '0.00',
      shortfall_kg: '0.00',
      shortfall_share: null,
      expenses_share: null,
      basket_share: null,
      full_cost: null,
      price_cost: null,
      price_by_our_weight: null,
      complete: false,
    };
    renderTable({
      ...day,
      reweighed_kg: '0.00',
      shortfall_amount: '0.00',
      basket: '1700.00',
      per_kg: null,
      shortfall_per_kg: null,
      expenses_per_kg: null,
      weighed: null,
      full_cost: null,
      price_cost_avg: null,
      unweighed: { intake_kg: '596.80', accrued: '113044.20' },
      checks: null,
      products: [unweighedRasp],
    });

    const texts = cellsOf(screen.getByRole('row', { name: /Малина/ })).map((c) => c.textContent);
    // Дня ₴/кг · Витрати ₴/кг · Собівартість · Δ — «Це не нуль» (§8.6).
    expect(texts.slice(7)).toEqual(['—', '—', '—', '—']);
    const totalTexts = cellsOf(screen.getByRole('row', { name: /^Пункт/ })).map(
      (c) => c.textContent,
    );
    expect(totalTexts.slice(7, 10)).toEqual(['—', '—', '—']);

    expect(screen.queryByText(/Як читати рядок/)).not.toBeInTheDocument();
    const box = screen.getByText('Очікує переважування').closest('[data-awaiting]') as HTMLElement;
    expect(box).toHaveTextContent('1 700,00 ₴ не розподілено');
    expect(box).toHaveTextContent(/Поки партію не зважили на базі/);
    expect(box.className).toContain('bg-muted');
    expect(box.outerHTML).not.toContain('--amber');
  });

  it('prints a zero Δ as a muted 0,00 without a plus on a day with an empty basket', () => {
    // Spec §3.5 «basket 0»: nothing missing and no expenses — the receipt
    // price IS the собівартість, and «+0,00» would promise an addition.
    renderTable({
      ...day,
      shortfall_amount: '0.00',
      expenses_amount: '0.00',
      basket: '0.00',
      per_kg: '0.00',
      shortfall_per_kg: '0.00',
      expenses_per_kg: '0.00',
      products: [{ ...cornel, price_cost: '38.00' }],
    });

    const delta = cellsOf(screen.getByRole('row', { name: /Кизил/ }))[10];
    expect(delta.textContent).toBe('0,00');
    expect(delta.className).toContain('text-muted-foreground');
  });

  it('prints the reading hint with the base weight when the day is weighed', () => {
    renderTable();

    const hint = screen.getByText(/Як читати рядок/);
    expect(hint).toHaveTextContent('(611,10 кг)');
    expect(within(hint).getByText('собівартість').className).toContain('--leaf');
    expect(screen.queryByText('Очікує переважування')).not.toBeInTheDocument();
  });

  it('explains «Нараховано» and the average in tooltips and in print footnotes', async () => {
    const user = userEvent.setup();
    renderTable();

    await user.hover(screen.getByRole('button', { name: 'Що таке «нараховано»' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/а не готівка з каси/);

    const notes = screen.getByRole('list');
    expect(notes.className).toContain('print-only');
    expect(within(notes).getAllByRole('listitem')).toHaveLength(2);
    expect(notes).toHaveTextContent(/Сума повної вартості ÷ вага на базі/);
    expect(screen.getByRole('button', { name: 'Як рахується середня' })).toBeInTheDocument();
  });

  it('uses amber only inside the Недостача group', () => {
    const { container } = renderTable();

    const amber = Array.from(container.querySelectorAll('[class*="--amber"]'));
    expect(amber.length).toBeGreaterThan(0);
    for (const el of amber) {
      // Either a cell of the two Недостача columns (or its group header), the
      // «Не доїхало» kilograms (a недостача too, §4.2: amber when > 0, in an
      // untinted column), or the word «недостача» itself in the reading hint.
      const cell = el.closest('th, td');
      if (cell) expect(['shortfall', 'shortfall-kg']).toContain(cell.getAttribute('data-group'));
      else expect(el).toHaveTextContent('недостача дня на кг');
    }
  });
});

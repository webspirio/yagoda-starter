import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { i18n } from '@/shared/lib/i18n';
import type { CostOfDay, CostOfDayProduct } from '@/entities/cost-of-day';
import { CostTable } from './CostTable';

// Ukrainian copy on purpose — `test-setup.ts` defaults the suite to 'en', so
// switch for this file only and switch back so it never leaks (same convention).
beforeAll(async () => {
  await i18n.changeLanguage('uk');
});

afterAll(async () => {
  await i18n.changeLanguage('en');
});

// Гайове, 19.10 — the real day the spec (2026-10-23 §4.2) is written against,
// with витрати 1 700,00 and the halves divided on their own (review C1):
// 265,19 ÷ 611,10 = 0,43 and 1 700,00 ÷ 611,10 = 2,78, на кілограм 3,21.
// Every figure is what the server sends; the component must only format it.
const cornel: CostOfDayProduct = {
  product_id: 'p-cornel',
  product_name: 'Кизил',
  accrued: '596.60',
  top_ups: '0.00',
  intake_net_kg: '15.70',
  reweigh_net_kg: '15.70',
  shortfall: '0.00',
  shortfall_kg: '0.00',
  shortfall_share: '6.81',
  expenses_share: '43.68',
  basket_share: '50.49',
  full_cost: '647.09',
  price_was: '38.00',
  price_cost: '41.21',
  price_by_our_weight: '38.00',
  complete: true,
  grades: [
    {
      product_grade_id: 'g-cornel-1',
      product_grade_name: 'Кизил сорт 1',
      accrued: '596.60',
      top_ups: '0.00',
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
  top_ups: '15000.00',
  intake_net_kg: '596.80',
  reweigh_net_kg: '595.40',
  shortfall: '265.19',
  shortfall_kg: '1.40',
  shortfall_share: '258.38',
  expenses_share: '1656.32',
  basket_share: '1914.70',
  full_cost: '114693.71',
  price_was: '189.42',
  price_cost: '192.63',
  price_by_our_weight: '189.86',
  complete: true,
  grades: [
    {
      product_grade_id: 'g-rasp-1',
      product_grade_name: 'Сорт 1',
      accrued: '71067.20',
      top_ups: '15000.00',
      intake_net_kg: '333.70',
      reweigh_net_kg: '227.40',
      price_was: '212.97',
    },
    {
      product_grade_id: 'g-rasp-2',
      product_grade_name: 'Сорт 2',
      accrued: '41977.00',
      top_ups: '0.00',
      intake_net_kg: '263.10',
      reweigh_net_kg: '368.00',
      price_was: '159.55',
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
  per_kg: '3.21',
  shortfall_per_kg: '0.43',
  expenses_per_kg: '2.78',
  total_check: '115340.80',
  weighed: {
    intake_kg: '612.50',
    shortfall_kg: '1.40',
    accrued: '113640.80',
    shortfall: '265.19',
  },
  full_cost: '115340.80',
  price_cost_avg: '188.74',
  unweighed: { intake_kg: '0.00', accrued: '0.00' },
  checks: { shares_ok: true, total_ok: true },
  top_ups_included: true,
  top_ups_latest_at: '2026-10-23T14:15:00.000Z',
  top_ups_total: '15000.00',
  products: [cornel, raspberry],
};

const renderTable = (d: CostOfDay = day) => render(<CostTable day={d} locale="uk" />);

/** The cells of a row, in column order (the first is the product's name). */
const cellsOf = (row: HTMLElement) => within(row).getAllByRole('cell');

describe('CostTable', () => {
  it('reads a row left to right as ціна закупки + недостача + витрати = собівартість', () => {
    renderTable();

    const row = screen.getByRole('row', { name: /Малина/ });
    const texts = cellsOf(row).map((c) => c.textContent);
    // Ten columns — no Δ (review C5); the доплати sit under Нараховано (C3).
    expect(texts.slice(1)).toEqual([
      '596,80',
      '595,40',
      '−1,40',
      '113 044,20 ₴у т.ч. доплати 15 000,00',
      '189,42',
      '−265,19',
      '0,43',
      '2,78',
      '192,63',
    ]);
  });

  it('names the purchase-price column for what it is and has no Δ column', () => {
    renderTable();

    expect(screen.getByRole('columnheader', { name: 'Ціна закупки, ₴/кг' })).toBeInTheDocument();
    expect(screen.queryByText(/Δ/)).not.toBeInTheDocument();
    // No rule codes on a client-facing screen.
    expect(document.body.textContent).not.toContain('§');
  });

  it('prints no доплати line on a product without them', () => {
    renderTable();

    const accrued = cellsOf(screen.getByRole('row', { name: /Кизил/ }))[4];
    expect(accrued.textContent).toBe('596,60 ₴');
  });

  it('prints a weighed zero as a muted 0,00', () => {
    renderTable();

    const notArrived = cellsOf(screen.getByRole('row', { name: /Кизил/ }))[3];
    expect(notArrived).toHaveTextContent(/^0,00$/);
    expect(notArrived.querySelector('[class*="--amber"]')).toBeNull();
    expect(notArrived.innerHTML).toContain('text-muted-foreground');
  });

  it('totals sums only and leaves every per-kg cell empty — review C2', () => {
    renderTable();

    const total = screen.getByRole('row', { name: /^Усього/ });
    const texts = cellsOf(total).map((c) => c.textContent);
    expect(texts).toEqual([
      'Усього',
      '612,50',
      '611,10',
      '−1,40',
      '113 640,80 ₴',
      '',
      '−265,19',
      '',
      '',
      '',
    ]);
    // Nothing is left out of the total, so the «не перезважено» line is absent.
    expect(screen.queryByText(/Не перезважено, не входить у підсумок/)).not.toBeInTheDocument();
  });

  it('prints the day average as one formula of server figures — review C2', () => {
    const { container } = renderTable();

    const line = container.querySelector('[data-day-formula]') as HTMLElement;
    expect(line.textContent).toBe(
      'Середня собівартість кілограма дня: (нараховано 113 640,80 + витрати 1 700,00) ÷ 611,10 кг = 188,74 ₴/кг',
    );
    expect(within(line).getByText('188,74 ₴/кг').className).toContain('--leaf');
  });

  it('opens a product into its calculator chain, then its grades — review C4', async () => {
    const user = userEvent.setup();
    const { container } = renderTable();

    expect(screen.queryByText('Сорт 1')).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Показати сорти: Малина' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);

    const chain = container.querySelector('[data-chain]') as HTMLElement;
    expect(within(chain).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Ціна закупки: 113 044,20 ÷ 596,80 = 189,42',
      'Недостача: 1,40 кг × 189,42 = 265,19 ₴',
      'Собівартість: 189,42 + 0,43 + 2,78 = 192,63',
    ]);

    const grade = screen.getByText('Сорт 1').closest('tr') as HTMLElement;
    expect(cellsOf(grade).map((c) => c.textContent)).toEqual([
      'Сорт 1',
      '333,70',
      '227,40',
      '',
      '71 067,20 ₴у т.ч. доплати 15 000,00',
      '212,97',
      '',
      '',
      '',
      '',
    ]);
    expect(screen.getByText('Сорт 2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Сховати сорти: Малина' }));
    expect(screen.queryByText('Сорт 1')).not.toBeInTheDocument();
    expect(container.querySelector('[data-chain]')).toBeNull();
  });

  it('leaves the недостача step out of the chain when nothing is missing', async () => {
    const user = userEvent.setup();
    const { container } = renderTable();

    await user.click(screen.getByRole('button', { name: 'Показати сорти: Кизил' }));

    const chain = container.querySelector('[data-chain]') as HTMLElement;
    expect(within(chain).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Ціна закупки: 596,60 ÷ 15,70 = 38,00',
      'Собівартість: 38,00 + 0,43 + 2,78 = 41,21',
    ]);
  });

  it('dashes a product not reweighed in full and reports it under the total', async () => {
    const user = userEvent.setup();
    const blackberry: CostOfDayProduct = {
      ...raspberry,
      product_id: 'p-black',
      product_name: 'Ожина',
      accrued: '9000.00',
      top_ups: '0.00',
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
    const { container } = renderTable({
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
    ]);

    // Not folded into the total — it sits on its own muted line under it.
    const total = screen.getByRole('row', { name: /^Усього/ });
    expect(total).toHaveTextContent('612,50');
    expect(total).not.toHaveTextContent('9 000,00');
    expect(
      screen.getByText('Не перезважено, не входить у підсумок: 60,00 кг · 9 000,00 ₴'),
    ).toBeInTheDocument();

    // Its chain stops at what the point knows: the purchase price.
    await user.click(screen.getByRole('button', { name: 'Показати сорти: Ожина' }));
    const chain = container.querySelector('[data-chain]') as HTMLElement;
    expect(within(chain).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Ціна закупки: 9 000,00 ÷ 60,00 = 150,00',
    ]);
  });

  it('shows the awaiting note instead of the formulas when nothing is weighed', () => {
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
    const { container } = renderTable({
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
    // Дня ₴/кг · Витрати ₴/кг · Собівартість — «Це не нуль» (§8.6).
    expect(texts.slice(7)).toEqual(['—', '—', '—']);
    const totalTexts = cellsOf(screen.getByRole('row', { name: /^Усього/ })).map(
      (c) => c.textContent,
    );
    expect(totalTexts.slice(1, 5)).toEqual(['—', '—', '—', '—']);

    expect(screen.queryByText(/Як читати рядок/)).not.toBeInTheDocument();
    expect(container.querySelector('[data-day-formula]')).toBeNull();
    const box = screen.getByText('Очікує переважування').closest('[data-awaiting]') as HTMLElement;
    expect(box).toHaveTextContent('1 700,00 ₴ не розподілено');
    expect(box).toHaveTextContent(/Поки партію не зважили на базі/);
    expect(box.className).toContain('bg-muted');
    expect(box.outerHTML).not.toContain('--amber');
  });

  it('prints each half of на кілограм as its own division — review C1', () => {
    renderTable();

    const hint = screen.getByText(/Як читати рядок/);
    expect(hint).toHaveTextContent('265,19 ÷ 611,10 кг = 0,43');
    expect(hint).toHaveTextContent('1 700,00 ÷ 611,10 кг = 2,78');
    expect(within(hint).getByText('собівартість').className).toContain('--leaf');
    expect(screen.queryByText('Очікує переважування')).not.toBeInTheDocument();
  });

  it('explains «Нараховано» with its доплати in a tooltip and a print footnote', async () => {
    const user = userEvent.setup();
    const { container } = renderTable();

    await user.hover(screen.getByRole('button', { name: 'Що таке «нараховано»' }));
    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent(/разом із доплатами/);
    expect(tip).toHaveTextContent(/а не готівка з каси/);

    const note = container.querySelector('.print-only') as HTMLElement;
    expect(note).toHaveTextContent(/разом із доплатами/);
  });

  it('uses amber only on недостача', async () => {
    const user = userEvent.setup();
    const { container } = renderTable();
    await user.click(screen.getByRole('button', { name: 'Показати сорти: Малина' }));

    const amber = Array.from(container.querySelectorAll('[class*="--amber"]'));
    expect(amber.length).toBeGreaterThan(0);
    for (const el of amber) {
      // A cell of the Недостача group (or its header), the «Не доїхало»
      // kilograms (amber when > 0, in an untinted column), the недостача
      // step of an opened row's chain, or the недостача half in the hint.
      expect(['shortfall', 'shortfall-kg']).toContain(
        el.closest('[data-group]')?.getAttribute('data-group'),
      );
    }
  });
});

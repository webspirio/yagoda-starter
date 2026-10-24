import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { i18n } from '@/shared/lib/i18n';
import type { NetworkCostOfDay, NetworkCostPoint } from '@/entities/cost-of-day';
import { NetworkCostTable } from './NetworkCostTable';
import { NetworkCostOfDay as NetworkBody } from './NetworkCostOfDay';

beforeAll(async () => {
  await i18n.changeLanguage('uk');
});

afterAll(async () => {
  await i18n.changeLanguage('en');
});

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

const cell = (over: Partial<NetworkCostPoint>): NetworkCostPoint => ({
  point_id: 'p',
  point_name: 'P',
  shift_id: 's',
  provisional: false,
  complete: true,
  intake_net_kg: '0.00',
  reweigh_net_kg: '0.00',
  shortfall_kg: '0.00',
  accrued: '0.00',
  top_ups: '0.00',
  shortfall: '0.00',
  shortfall_share: '0.00',
  expenses_share: '0.00',
  full_cost: '0.00',
  price_was: '0.00',
  price_cost: '0.00',
  ...over,
});

// §8.6's two points with each one's expenses on top — Шипинки's page reads
// 166,84, Гайове's 160,00; the network row reads 165 400,00 ÷ 1 000,00 = 165,40.
// Лісове accepted 100 кг and has not weighed them.
const day: NetworkCostOfDay = {
  date: '2026-10-22',
  points: [
    {
      point_id: 'pt-shp',
      point_name: 'Шипинки',
      shift_id: 's-shp',
      provisional: false,
      expenses_amount: '3800.00',
      weighed: true,
    },
    {
      point_id: 'pt-hai',
      point_name: 'Гайове',
      shift_id: 's-hai',
      provisional: false,
      expenses_amount: '1050.00',
      weighed: true,
    },
    {
      point_id: 'pt-lis',
      point_name: 'Лісове',
      shift_id: 's-lis',
      provisional: false,
      expenses_amount: '500.00',
      weighed: false,
    },
  ],
  provisional: false,
  accrued: '175550.00',
  expenses_amount: '5350.00',
  expenses_weighed: '4850.00',
  reweighed_kg: '1000.00',
  shortfall_amount: '1600.00',
  top_ups_total: '0.00',
  weighed: {
    intake_kg: '1010.00',
    shortfall_kg: '10.00',
    accrued: '160550.00',
    shortfall: '1600.00',
    shortfall_share: '1600.00',
    expenses_share: '4850.00',
    full_cost: '165400.00',
  },
  price_cost_avg: '165.40',
  unweighed: { intake_kg: '100.00', accrued: '15000.00' },
  checks: { points_ok: true, total_ok: true },
  products: [
    {
      product_id: 'p-rasp',
      product_name: 'Малина',
      complete: true,
      intake_net_kg: '1010.00',
      reweigh_net_kg: '1000.00',
      shortfall_kg: '10.00',
      accrued: '160550.00',
      top_ups: '0.00',
      shortfall: '1600.00',
      shortfall_share: '1600.00',
      expenses_share: '4850.00',
      full_cost: '165400.00',
      price_was: '158.96',
      price_cost: '165.40',
      unweighed: { intake_kg: '100.00', accrued: '15000.00' },
      points: [
        cell({
          point_name: 'Шипинки',
          shift_id: 's-shp',
          intake_net_kg: '800.00',
          reweigh_net_kg: '790.00',
          shortfall_kg: '10.00',
          accrued: '128000.00',
          shortfall: '1600.00',
          shortfall_share: '1600.00',
          expenses_share: '3800.00',
          full_cost: '131800.00',
          price_was: '160.00',
          price_cost: '166.84',
        }),
        cell({
          point_name: 'Гайове',
          shift_id: 's-hai',
          intake_net_kg: '210.00',
          reweigh_net_kg: '210.00',
          accrued: '32550.00',
          expenses_share: '1050.00',
          full_cost: '33600.00',
          price_was: '155.00',
          price_cost: '160.00',
        }),
        cell({
          point_name: 'Лісове',
          shift_id: 's-lis',
          complete: false,
          intake_net_kg: '100.00',
          reweigh_net_kg: null,
          accrued: '15000.00',
          shortfall_share: null,
          expenses_share: null,
          full_cost: null,
          price_was: '150.00',
          price_cost: null,
        }),
      ],
    },
  ],
};

const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLTableRowElement;
const texts = (row: HTMLTableRowElement) =>
  within(row)
    .getAllByRole('cell')
    .map((c) => norm(c.textContent));

describe('NetworkCostTable', () => {
  it('prints the network row: Σ ÷ Σ, the money in the bands', () => {
    render(<NetworkCostTable day={day} locale="uk" />);

    const [, point, base, notArrived, accrued, priceWas, own, share, expenses, full, cost] = texts(
      rowOf('Малина'),
    );
    expect(point).toBe('1 010,00');
    expect(base).toBe('1 000,00');
    expect(notArrived).toBe('−10,00');
    // Units in the header only (audit E9): the cells are plain figures.
    expect(accrued).toBe('160 550,00');
    expect(priceWas).toBe('158,96');
    expect(own).toBe('−1 600,00');
    expect(share).toBe('1 600,00');
    expect(expenses).toBe('4 850,00');
    expect(full).toBe('165 400,00');
    expect(cost).toBe('165,40');
    expect(cost).not.toBe('163,42'); // (166,84 + 160,00) ÷ 2
  });

  it('says a product weighed at only some points is not the whole network — audit E1', () => {
    render(<NetworkCostTable day={day} locale="uk" />);

    const name = within(rowOf('Малина')).getAllByRole('cell')[0];
    expect(within(name).getByText('перезважено 2 з 3 точок')).toBeInTheDocument();
    expect(norm(name.textContent)).toContain('без 100,00 кг');
    // Both share columns carry one name.
    expect(screen.getAllByRole('columnheader', { name: 'Частка, ₴' })).toHaveLength(2);
  });

  it('opens a product into its two formulas and one sub-row per point, each with its own собівартість', async () => {
    const user = userEvent.setup();
    const { container } = render(<NetworkCostTable day={day} locale="uk" />);

    expect(screen.queryByText('Шипинки')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Показати точки: Малина' }));

    const chain = norm(container.querySelector('[data-chain]')?.textContent);
    expect(chain).toContain(
      'Повна вартість: 160 550,00 ₴ − 1 600,00 ₴ + 1 600,00 ₴ + 4 850,00 ₴ = 165 400,00 ₴',
    );
    expect(chain).toContain(
      'Собівартість: 165 400,00 ₴ ÷ 1 000,00 кг = 165,40 ₴/кг — сума ÷ вага по точках: Шипинки, Гайове',
    );
    expect(chain).toMatch(/Не перезважено, не входить у рядок: Лісове — 100,00 кг · 15 000,00 ₴/);

    expect(texts(rowOf('Шипинки'))[10]).toBe('166,84');
    expect(texts(rowOf('Гайове'))[10]).toBe('160,00');
    // Лісове's base-side cells are dashes, never zeros.
    const lis = texts(rowOf('Лісове'));
    expect(lis[2]).toBe('—');
    expect(lis.slice(-4)).toEqual(['—', '—', '—', '—']);
    expect(within(rowOf('Лісове')).getByText('не перезважено')).toBeInTheDocument();
  });

  it('sums the total row and prints the day formula with the expenses that were spread', () => {
    const { container } = render(<NetworkCostTable day={day} locale="uk" />);

    const total = texts(container.querySelector('[data-total]') as HTMLTableRowElement);
    expect(total[0]).toBe('Усього');
    expect(total[9]).toBe('165 400,00');
    expect(total[10]).toBe('');

    const formula = norm(container.querySelector('[data-day-formula]')?.textContent);
    // Лісове's 15 000,00 is out of the numerator, and the operand says so (E3).
    expect(formula).toContain(
      '(нараховано по перезваженому 160 550,00 ₴ + витрати 4 850,00 ₴) ÷ 1 000,00 кг',
    );
    // …and the kilograms say whose they are (E1).
    expect(norm(container.querySelector('[data-counted]')?.textContent)).toBe(
      'Враховано 1 000,00 кг з 2 точок з 3.',
    );
    expect(formula).toContain('= 165,40 ₴/кг');
    expect(screen.getByText(/ніколи не середнє з середніх/)).toBeInTheDocument();
    expect(norm(screen.getByText(/Не перезважено, не входить у підсумок/).textContent)).toMatch(
      /Не перезважено, не входить у підсумок: 100,00 кг/,
    );
  });

  it('dashes a product nobody weighed and waits for a reweigh', () => {
    const none: NetworkCostOfDay = {
      ...day,
      weighed: null,
      price_cost_avg: null,
      checks: null,
      products: [
        {
          ...day.products[0],
          complete: false,
          reweigh_net_kg: null,
          shortfall_kg: '0.00',
          shortfall: '0.00',
          shortfall_share: null,
          expenses_share: null,
          full_cost: null,
          price_cost: null,
          unweighed: null,
          points: [day.products[0].points[2]],
        },
      ],
    };
    const { container } = render(<NetworkCostTable day={none} locale="uk" />);

    const row = texts(rowOf('Малина'));
    expect(row[0]).toMatch(/не перезважено/);
    expect(row.slice(6)).toEqual(['—', '—', '—', '—', '—']);
    expect(container.querySelector('[data-awaiting]')).not.toBeNull();
    expect(container.querySelector('[data-day-formula]')).toBeNull();
  });

  // «Звідки це число» (client, 24.10) — the body owns the trace scope, so the
  // expenses line above the table is in reach of the formulas under it.
  describe('traced formulas', () => {
    const termOf = (root: Element, text: string) =>
      Array.from(root.querySelectorAll<HTMLElement>('[data-slot="trace-term"]')).find(
        (el) => norm(el.textContent) === text,
      ) as HTMLElement;

    it('points the row chain at the product row’s cells', async () => {
      const user = userEvent.setup();
      const { container } = render(<NetworkBody day={day} locale="uk" />);
      const rasp = within(rowOf('Малина')).getAllByRole('cell');
      await user.click(screen.getByRole('button', { name: 'Показати точки: Малина' }));
      const chain = container.querySelector('[data-chain]') as HTMLElement;

      fireEvent.pointerEnter(termOf(chain, '4 850,00 ₴'));
      expect(rasp[8]).toHaveAttribute('data-trace-hit', 'plum');
      expect(rasp[9]).not.toHaveAttribute('data-trace-hit');

      // The «не перезважено» step points at the sub-row of the point left out.
      fireEvent.pointerEnter(termOf(chain, '15 000,00 ₴'));
      expect(within(rowOf('Лісове')).getAllByRole('cell')[4]).toHaveAttribute(
        'data-trace-hit',
        'sky',
      );
      expect(within(rowOf('Шипинки')).getAllByRole('cell')[4]).not.toHaveAttribute(
        'data-trace-hit',
      );
    });

    it('points the day formula’s витрати at the weighed points’ entries above the table', () => {
      const { container } = render(<NetworkBody day={day} locale="uk" />);
      const formula = container.querySelector('[data-day-formula]') as HTMLElement;
      const line = container.querySelector('[data-network-expenses]') as HTMLElement;

      fireEvent.pointerEnter(termOf(formula, '4 850,00 ₴'));
      expect(termOf(line, '3 800,00 ₴')).toHaveAttribute('data-trace-hit', 'plum');
      expect(termOf(line, '1 050,00 ₴')).toHaveAttribute('data-trace-hit', 'plum');
      // Лісове weighed nothing: its 500,00 is not in the numerator.
      for (const el of line.querySelectorAll('[data-slot="trace-term"]')) {
        if (norm(el.textContent) === '500,00 ₴') expect(el).not.toHaveAttribute('data-trace-hit');
      }
      const total = within(container.querySelector('[data-total]') as HTMLElement).getAllByRole(
        'cell',
      );
      expect(total[8]).toHaveAttribute('data-trace-hit', 'plum');

      fireEvent.pointerEnter(termOf(container.querySelector('[data-counted]')!, '1 000,00 кг'));
      expect(total[2]).toHaveAttribute('data-trace-hit', 'neutral');
    });
  });
});

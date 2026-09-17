import { CostOfDayService } from './cost-of-day.service';
import { add, sub, gte } from '../common/money';
import { UserRole } from '../users/user-role.enum';
import type { GradeTotalsRow } from '../reweighs/reweigh-reconciliation.service';

const owner = { id: 'u-owner', role: UserRole.NetworkOwner, collection_point_id: null } as never;

/** §8.4: нараховано 131 900,00 over 854 переважених кг, 10 кг short on raspberry. */
const DAY: GradeTotalsRow[] = [
  {
    product_id: 'p-rasp',
    product_name: 'Малина',
    product_grade_id: 'g-rasp',
    intake_net_kg: '800.00',
    intake_amount: '128000.00',
    reweigh_net_kg: '790.00',
  },
  {
    // Tuned per the task brief: 1 кг short at 3 900,00 ÷ 65,00 кг = 60,00 ₴/кг
    // gives an exact 60,00 shortfall, so 1 600,00 + 60,00 = 1 660,00 — the
    // number §8.4 prints. (64,80 кг, the figure the published screenshot's
    // rough text implies, rounds to 48,15 and does not reproduce it.)
    product_id: 'p-black',
    product_name: 'Ожина',
    product_grade_id: 'g-black',
    intake_net_kg: '65.00',
    intake_amount: '3900.00',
    reweigh_net_kg: '64.00',
  },
];

/**
 * `grades` are `gradeTotals` rows, `expenses` the day's `day_expenses` total,
 * `receipts` the `ReceiptForAllocation[]` the top-up query returns.
 *
 * MATCHES ON QUERY TEXT rather than call order — several cases below call
 * `forShift` more than once against the same `svc`, and a fixed sequence of
 * `mockResolvedValueOnce`s (the brief's own illustrative fixture) would be
 * exhausted after the first call. Matching by the SQL each query is
 * recognisably about also decouples the test from the exact number and
 * ordering of queries the service happens to issue.
 */
const build = (
  grades = DAY,
  expenses = '3800.00',
  receipts: unknown[] = [],
  latestTopUpAt: Date | null = null,
) => {
  const dataSource = {
    query: jest.fn(async (sql: string) => {
      if (sql.includes('reweigh_items')) return grades;
      if (sql.includes('FROM day_expenses')) return [{ total: expenses }];
      if (sql.includes('MAX(ti.created_at)')) return [{ latest: latestTopUpAt }];
      if (sql.includes('FROM intakes i')) return receipts;
      throw new Error(`unexpected query: ${sql}`);
    }),
  };
  const shifts = { findOneRaw: jest.fn(async () => ({ id: 's-1', closed_at: new Date() })) };
  return new CostOfDayService(dataSource as never, shifts as never);
};

const svc = build();
const svcWithNoReweigh = build(DAY.map((g) => ({ ...g, reweigh_net_kg: null })));
const svcWithTopUp = build(
  DAY,
  '3800.00',
  [
    {
      intake_id: 'i-1',
      top_up_total: '2000.00',
      lines: [{ product_grade_id: 'g-rasp', amount: '128000.00' }],
    },
  ],
  new Date('2026-09-10T09:00:00Z'),
);
const svcWithSurplus = build([{ ...DAY[0], reweigh_net_kg: '805.00' }, DAY[1]]);

describe('CostOfDayService.forShift', () => {
  // §8.4's worked day, reduced to the two products it implies:
  //   нараховано 131 900,00 · переважено 854 кг · недостача 1 660,00 · витрати 3 800,00
  //   КОШИК 5 460,00 → 6,39 ₴/кг · малина 160,00 → 166,39
  it('reproduces §8.4 line for line', async () => {
    const out = await svc.forShift(owner, 's-1');
    expect(out.accrued).toBe('131900.00');
    expect(out.reweighed_kg).toBe('854.00');
    expect(out.shortfall_amount).toBe('1660.00');
    expect(out.expenses_amount).toBe('3800.00');
    expect(out.basket).toBe('5460.00');
    expect(out.per_kg).toBe('6.39');
    const raspberry = out.products.find((p) => p.product_name === 'Малина')!;
    expect(raspberry.price_was).toBe('160.00');
    expect(raspberry.price_cost).toBe('166.39');
  });

  it('keeps the звірка honest: нараховано + витрати = разом', async () => {
    const out = await svc.forShift(owner, 's-1');
    expect(add(out.accrued, out.expenses_amount)).toBe(out.total_check);
  });

  it('prices the third column as нараховане ÷ НАША вага — §8.4', async () => {
    const raspberry = (await svc.forShift(owner, 's-1')).products.find(
      (p) => p.product_name === 'Малина',
    )!;
    expect(raspberry.price_by_our_weight).toBe('162.03'); // 128 000 ÷ 790
  });

  it('spreads the basket EQUALLY per kilogram across every product — §8.5 ①', async () => {
    const out = await svc.forShift(owner, 's-1');
    for (const p of out.products) {
      expect(sub(p.price_cost as string, p.price_was)).toBe(out.per_kg);
    }
  });

  it('returns null per_kg — never 0,00 — when nothing was weighed (§8.6 «Це не нуль»)', async () => {
    const out = await svcWithNoReweigh.forShift(owner, 's-1');
    expect(out.per_kg).toBeNull();
    expect(out.products.every((p) => p.price_cost === null)).toBe(true);
  });

  it('includes top-ups in нараховано and in the value of недостача — spec §3.12/§3.13', async () => {
    const out = await svcWithTopUp.forShift(owner, 's-1'); // +2 000,00 on the raspberry receipt
    expect(out.accrued).toBe('133900.00');
    expect(out.top_ups_included).toBe(true);
    expect(out.top_ups_latest_at).not.toBeNull();
  });

  it('clamps a SURPLUS out of the basket so it can never lower the day cost — §8.2', async () => {
    const out = await svcWithSurplus.forShift(owner, 's-1');
    expect(gte(out.shortfall_amount, '0.00')).toBe(true);
  });
});

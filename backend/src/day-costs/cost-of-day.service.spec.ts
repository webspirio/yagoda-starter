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
    product_grade_name: 'Малина 1',
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
    product_grade_name: 'Ожина 1',
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
  closedAt: Date | null = new Date('2026-09-17T18:00:00Z'),
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
  const shifts = { findOneRaw: jest.fn(async () => ({ id: 's-1', closed_at: closedAt })) };
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

/**
 * §3.15's partial weighing, priced: ONE product, two grades, only the first
 * of them on the scale. The reconciliation already calls this product «не
 * перезважено»; this fixture is what proves cost-of-day says the same thing
 * rather than booking сорт 2's hundred kilograms as a shortfall nobody has
 * confirmed yet.
 */
const PARTIAL: GradeTotalsRow[] = [
  {
    product_id: 'p-rasp',
    product_name: 'Малина',
    product_grade_id: 'g-rasp-1',
    product_grade_name: 'Малина 1',
    intake_net_kg: '100.00',
    intake_amount: '10000.00',
    reweigh_net_kg: '95.00',
  },
  {
    product_id: 'p-rasp',
    product_name: 'Малина',
    product_grade_id: 'g-rasp-2',
    product_grade_name: 'Малина 2',
    intake_net_kg: '100.00',
    intake_amount: '8000.00',
    reweigh_net_kg: null,
  },
];
const svcPartial = build(PARTIAL, '0.00');

/**
 * THE CASE THE `PARTIAL` FIXTURE ALONE CANNOT REACH: a day holding one fully
 * weighed product AND one partially weighed one. With only the partial
 * product present, `per_kg` is `null` and every consequence of it is
 * invisible — so this fixture is what shows whether «contributes nothing»
 * really means nothing, in both directions.
 *
 *   Ожина  — 100 кг in, 100 кг weighed, 10 000,00 → complete
 *   Малина — сорт 1: 100 кг in / 95 кг weighed / 10 000,00
 *            сорт 2: 100 кг in / not weighed    /  8 000,00 → NOT complete
 *   витрати 1 000,00
 */
const MIXED: GradeTotalsRow[] = [
  {
    product_id: 'p-black',
    product_name: 'Ожина',
    product_grade_id: 'g-black',
    product_grade_name: 'Ожина 1',
    intake_net_kg: '100.00',
    intake_amount: '10000.00',
    reweigh_net_kg: '100.00',
  },
  ...PARTIAL,
];
const svcMixed = build(MIXED, '1000.00');
const svcOpenShift = build(DAY, '3800.00', [], null, null);

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

  /**
   * §3.15 — a product weighed in one grade but not another is «не
   * перезважено» AT THE PRODUCT LEVEL, and this screen has to agree with the
   * reconciliation screen reading the same shift. All three figures move
   * together: the unweighed grade's shortfall is not real yet, so it is not
   * in the basket; and the weighed grade's kilograms are not a weighing of
   * this product, so they are not in the denominator either.
   */
  describe('a partially weighed product — spec §3.15', () => {
    it('books NO shortfall for it: the unweighed grade’s недостача is not real yet', async () => {
      const out = await svcPartial.forShift(owner, 's-1');
      expect(out.shortfall_amount).toBe('0.00');
      expect(out.basket).toBe('0.00');
    });

    it('keeps its kilograms OUT of переважено — half a weighing is not a weighing', async () => {
      const out = await svcPartial.forShift(owner, 's-1');
      expect(out.reweighed_kg).toBe('0.00');
      expect(out.per_kg).toBeNull();
    });

    it('returns a null «наша вага» price, never 18 000 ÷ 95 — §8.6 «Це не нуль»', async () => {
      const p = (await svcPartial.forShift(owner, 's-1')).products[0];
      expect(p.price_was).toBe('90.00');
      expect(p.price_by_our_weight).toBeNull();
    });

    /**
     * The rule has to hold in BOTH directions on a day that also has a fully
     * weighed product. Left out of the denominator but still handed a share
     * of it, малина would price at 90,00 + 10,00 = 100,00 — a собівартість
     * derived from a divisor its own 95 kilograms were deliberately excluded
     * from, on a screen whose whole claim is «жодна гривня не загубилася».
     */
    it('does not COLLECT a basket share either, on a day that also has a complete product', async () => {
      const out = await svcMixed.forShift(owner, 's-1');

      // The complete product alone sets the denominator and the share.
      expect(out.reweighed_kg).toBe('100.00');
      expect(out.basket).toBe('1000.00');
      expect(out.per_kg).toBe('10.00');

      const blackberry = out.products.find((p) => p.product_name === 'Ожина')!;
      expect(blackberry.complete).toBe(true);
      expect(blackberry.price_was).toBe('100.00');
      expect(blackberry.price_cost).toBe('110.00');

      const raspberry = out.products.find((p) => p.product_name === 'Малина')!;
      expect(raspberry.complete).toBe(false);
      expect(raspberry.price_was).toBe('90.00');
      // NOT '100.00' — the number a `perKg`-only guard would have printed.
      expect(raspberry.price_cost).toBeNull();
      expect(raspberry.price_by_our_weight).toBeNull();
    });

    it('still books no shortfall for the partial product when the day is mixed', async () => {
      const out = await svcMixed.forShift(owner, 's-1');
      expect(out.shortfall_amount).toBe('0.00');
      expect(out.accrued).toBe('28000.00');
    });
  });

  /**
   * §3.9 — while the shift is open the недостача is not a claim yet, and the
   * reconciliation says so with a dash. Cost-of-day still shows the day
   * taking shape (§5.5: no gate), but it must SAY that the figure is
   * provisional, or the two §8 screens contradict each other mid-day.
   */
  it('marks an OPEN shift’s figures provisional and carries closed_at — §3.9', async () => {
    const out = await svcOpenShift.forShift(owner, 's-1');
    expect(out.closed_at).toBeNull();
    expect(out.provisional).toBe(true);
  });

  it('is not provisional once the shift is closed', async () => {
    const out = await svc.forShift(owner, 's-1');
    expect(out.closed_at).toBe('2026-09-17T18:00:00.000Z');
    expect(out.provisional).toBe(false);
  });
});

describe('CostOfDayProduct carries the figures it was built from (§8.4 left half)', () => {
  it('passes нараховано, both weights and the недостача through per product', async () => {
    const res = await svc.forShift(owner, 's-1');
    const rasp = res.products.find((p) => p.product_id === 'p-rasp');

    // 800 кг accruing 128 000,00 is 160,00 ₴/кг; 790 кг came back, so 10 кг
    // short × 160,00 = 1 600,00 — §8.4's own raspberry line.
    expect(rasp).toMatchObject({
      accrued: '128000.00',
      intake_net_kg: '800.00',
      reweigh_net_kg: '790.00',
      shortfall: '1600.00',
    });
  });

  it('reports reweigh_net_kg as null — never 0.00 — for a product nothing weighed', async () => {
    const res = await svcWithNoReweigh.forShift(owner, 's-1');

    // §8.6's «Це не нуль»: the screen must be able to print «—» rather than a
    // zero that reads as «the berries vanished».
    expect(res.products.map((p) => p.reweigh_net_kg)).toEqual([null, null]);
    expect(res.products.map((p) => p.shortfall)).toEqual(['0.00', '0.00']);
  });
});

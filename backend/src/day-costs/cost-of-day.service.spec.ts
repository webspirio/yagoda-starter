import * as fc from 'fast-check';
import { CostOfDayService } from './cost-of-day.service';
import { add, sub, gte, mul, sum } from '../common/money';
import { UserRole } from '../users/user-role.enum';
import type { GradeTotalsRow } from '../reweighs/reweigh-reconciliation.service';

/** kopiykas -> decimal string, as in `common/money.properties.spec.ts`. */
const fromKopiyka = (k: bigint): string => `${k / 100n}.${(k % 100n).toString().padStart(2, '0')}`;

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

/**
 * §3.15 — Малина has TWO grades and only one is on the scale, so the whole
 * product is «не перезважено»: it contributes no kilograms to переважено and
 * therefore collects no share of the basket. Ожина is weighed in full.
 *
 * Named apart from the file's existing `PARTIAL`/`svcPartial` (a different,
 * already-in-use 100 кг fixture for the §3.15 describe block above) so this
 * one — built on `DAY`'s own 800/64 кг figures, to land on the exact
 * §8.4 shares this describe block asserts — doesn't collide with it.
 */
const BASKET_PARTIAL: GradeTotalsRow[] = [
  {
    ...DAY[0],
    product_grade_id: 'g-rasp-1',
    product_grade_name: 'Малина 1',
    intake_net_kg: '400.00',
    intake_amount: '64000.00',
    reweigh_net_kg: '395.00',
  },
  {
    ...DAY[0],
    product_grade_id: 'g-rasp-2',
    product_grade_name: 'Малина 2',
    intake_net_kg: '400.00',
    intake_amount: '64000.00',
    reweigh_net_kg: null,
  },
  DAY[1],
];
const svcBasketPartial = build(BASKET_PARTIAL);

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
      shortfall_kg: '10.00',
    });
  });

  it('counts недостача per product, so a surplus grade offsets a short one', async () => {
    // Сорт 1 is 10 кг short, сорт 2 is 3 кг over: the product is 7 кг short
    // (client call 23.10.2026 — the base does not weigh the point's grades),
    // at the product's 160,00 ₴/кг, and the ₴ figure agrees with the kilograms.
    const res = await build(
      [
        { ...DAY[0], product_grade_id: 'g-rasp-1' },
        { ...DAY[0], product_grade_id: 'g-rasp-2', reweigh_net_kg: '803.00' },
      ],
      '0.00',
    ).forShift(owner, 's-1');

    expect(res.products[0]).toMatchObject({ shortfall: '1120.00', shortfall_kg: '7.00' });
  });

  it('books no shortfall_kg for a partially weighed product', async () => {
    const res = await svcPartial.forShift(owner, 's-1');
    expect(res.products[0].shortfall_kg).toBe('0.00');
  });

  it('reports reweigh_net_kg as null — never 0.00 — for a product nothing weighed', async () => {
    const res = await svcWithNoReweigh.forShift(owner, 's-1');

    // §8.6's «Це не нуль»: the screen must be able to print «—» rather than a
    // zero that reads as «the berries vanished».
    expect(res.products.map((p) => p.reweigh_net_kg)).toEqual([null, null]);
    expect(res.products.map((p) => p.shortfall)).toEqual(['0.00', '0.00']);
    expect(res.products.map((p) => p.shortfall_kg)).toEqual(['0.00', '0.00']);
  });
});

describe('на кілограм splits into its two halves (§8.4)', () => {
  it('prints з них недостача 1,94 and з них витрати 4,45 on §8.4 own numbers', async () => {
    const res = await svc.forShift(owner, 's-1');

    // КОШИК 5 460,00 over 854 кг. The three divisions are independent, which
    // is why they are asserted as three facts and not as an addition.
    expect(res.basket).toBe('5460.00');
    expect(res.reweighed_kg).toBe('854.00');
    expect(res.per_kg).toBe('6.39');
    expect(res.shortfall_per_kg).toBe('1.94');
    expect(res.expenses_per_kg).toBe('4.45');
  });

  it('dashes both halves on a day with nothing on the scale', async () => {
    const res = await svcWithNoReweigh.forShift(owner, 's-1');

    // Same guard as `per_kg`: `div` throws on a zero divisor by design, and
    // «нічого не важили» is a dash, never a zero.
    expect(res.per_kg).toBeNull();
    expect(res.shortfall_per_kg).toBeNull();
    expect(res.expenses_per_kg).toBeNull();
  });
});

describe('basket_share is allocated, never multiplied out (§8.4)', () => {
  const shareOf = (products: { product_id: string; basket_share: string | null }[], id: string) =>
    products.find((p) => p.product_id === id)?.basket_share ?? null;

  it('splits the basket so the parts sum EXACTLY to it', async () => {
    const res = await svc.forShift(owner, 's-1');

    // КОШИК 5 460,00 over 790 кг + 64 кг. Largest remainder puts the leftover
    // kopiyka on raspberry.
    expect(shareOf(res.products, 'p-rasp')).toBe('5050.82');
    expect(shareOf(res.products, 'p-black')).toBe('409.18');
    expect(add('5050.82', '409.18')).toBe(res.basket);
  });

  it('does not lose the kopiykas a per-row multiplication would', async () => {
    const res = await svc.forShift(owner, 's-1');

    // per_kg × kg per row is 6,39 × 790 + 6,39 × 64 = 5 457,06 — 2,94 ₴ of a
    // 5 460,00 basket gone. This is the whole reason the field exists.
    expect(add(mul(res.per_kg as string, '790.00'), mul(res.per_kg as string, '64.00'))).toBe(
      '5457.06',
    );
    expect(res.basket).toBe('5460.00');
  });

  it('gives a partially weighed product no share at all — not a zero', async () => {
    const res = await svcBasketPartial.forShift(owner, 's-1');

    // §3.15: Малина contributed no kilograms to переважено, so it collects
    // nothing from the denominator it was left out of. Ожина takes the lot.
    expect(shareOf(res.products, 'p-rasp')).toBeNull();
    expect(shareOf(res.products, 'p-black')).toBe(res.basket);
    expect(res.reweighed_kg).toBe('64.00');
  });

  it('dashes every share on a day with nothing on the scale', async () => {
    const res = await svcWithNoReweigh.forShift(owner, 's-1');
    expect(res.products.map((p) => p.basket_share)).toEqual([null, null]);
  });
});

/**
 * Spec 2026-10-23 «одна таблиця» — every figure the one-table screen prints,
 * computed here so the browser does no arithmetic at all.
 *
 * `GAIOVE` is 19.10.2026 at Гайове, one grade per product, the day the spec's
 * own numbers are taken from:
 *   Кизил  — 15,70 кг in / 596,60 ₴ / 15,70 кг weighed (nothing missing)
 *   Малина — 596,80 кг in / 113 044,20 ₴ / 595,40 кг weighed (1,40 кг short)
 *   витрати 1 700,00
 */
const GAIOVE: GradeTotalsRow[] = [
  {
    product_id: 'p-cornel',
    product_name: 'Кизил',
    product_grade_id: 'g-cornel',
    product_grade_name: 'Кизил 1',
    intake_net_kg: '15.70',
    intake_amount: '596.60',
    reweigh_net_kg: '15.70',
  },
  {
    product_id: 'p-rasp',
    product_name: 'Малина',
    product_grade_id: 'g-rasp',
    product_grade_name: 'Малина 1',
    intake_net_kg: '596.80',
    intake_amount: '113044.20',
    reweigh_net_kg: '595.40',
  },
];
const svcGaiove = build(GAIOVE, '1700.00');

describe('one-table fields (spec 2026-10-23)', () => {
  const productOf = <T extends { product_id: string }>(products: T[], id: string): T =>
    products.find((p) => p.product_id === id)!;

  it('splits на кілограм so the halves sum to it', async () => {
    const res = await svcGaiove.forShift(owner, 's-1');

    // КОШИК 265,19 + 1 700,00 = 1 965,19 over 611,10 кг = 3,22. Two
    // independent quotients would read 0,43 + 2,78 = 3,21 and miss by a
    // kopiyka; `allocate(per_kg, [недостача, витрати])` cannot.
    expect(res.per_kg).toBe('3.22');
    expect(res.shortfall_per_kg).toBe('0.43');
    expect(res.expenses_per_kg).toBe('2.79');
    expect(add(res.shortfall_per_kg!, res.expenses_per_kg!)).toBe(res.per_kg);
  });

  it('keeps §8.4 own halves', async () => {
    const res = await svc.forShift(owner, 's-1');
    expect(res.shortfall_per_kg).toBe('1.94');
    expect(res.expenses_per_kg).toBe('4.45');
  });

  it('splits each share into недостача and витрати', async () => {
    const res = await svcGaiove.forShift(owner, 's-1');

    expect(productOf(res.products, 'p-cornel')).toMatchObject({
      shortfall_share: '6.81',
      expenses_share: '43.68',
      basket_share: '50.49',
    });
    expect(productOf(res.products, 'p-rasp')).toMatchObject({
      shortfall_share: '258.38',
      expenses_share: '1656.32',
      basket_share: '1914.70',
    });
    expect(sum(res.products.map((p) => p.shortfall_share!))).toBe(res.shortfall_amount);
    expect(sum(res.products.map((p) => p.expenses_share!))).toBe(res.expenses_amount);
    expect(sum(res.products.map((p) => p.basket_share!))).toBe(res.basket);
  });

  it('prices повна вартість per product and per day', async () => {
    const res = await svcGaiove.forShift(owner, 's-1');

    expect(productOf(res.products, 'p-cornel').full_cost).toBe('647.09');
    expect(productOf(res.products, 'p-rasp').full_cost).toBe('114693.71');
    expect(res.full_cost).toBe('115340.80');
    expect(res.price_cost_avg).toBe('188.74');
    // собівартість itself is unchanged: «було» + «на кілограм» (spec §3.1).
    expect(productOf(res.products, 'p-cornel').price_cost).toBe('41.22');
    expect(productOf(res.products, 'p-rasp').price_cost).toBe('192.64');
  });

  it('totals weighed products only', async () => {
    const res = await svcGaiove.forShift(owner, 's-1');

    expect(res.weighed).toEqual({
      intake_kg: '612.50',
      shortfall_kg: '1.40',
      accrued: '113640.80',
      shortfall: '265.19',
      price_was: '185.54',
    });
    expect(res.unweighed).toEqual({ intake_kg: '0.00', accrued: '0.00' });
    expect(res.checks).toEqual({ shares_ok: true, total_ok: true });
  });

  it('§8.4 day', async () => {
    const res = await svc.forShift(owner, 's-1');

    expect(productOf(res.products, 'p-rasp')).toMatchObject({
      shortfall_share: '1535.60',
      expenses_share: '3515.22',
      full_cost: '131450.82',
    });
    expect(productOf(res.products, 'p-black')).toMatchObject({
      shortfall_share: '124.40',
      expenses_share: '284.78',
      full_cost: '4249.18',
    });
    expect(res.full_cost).toBe('135700.00');
    expect(res.price_cost_avg).toBe('158.90');
    expect(res.weighed?.price_was).toBe('152.49');
    expect(res.checks).toEqual({ shares_ok: true, total_ok: true });
  });

  it('mixed day', async () => {
    const res = await svcMixed.forShift(owner, 's-1');

    // Ожина alone is complete; Малина (сорт 2 not on the scale) is reported
    // beside the total, never folded into it.
    expect(res.weighed).toEqual({
      intake_kg: '100.00',
      shortfall_kg: '0.00',
      accrued: '10000.00',
      shortfall: '0.00',
      price_was: '100.00',
    });
    expect(res.unweighed).toEqual({ intake_kg: '200.00', accrued: '18000.00' });

    const raspberry = productOf(res.products, 'p-rasp');
    expect(raspberry.full_cost).toBeNull();
    expect(raspberry.shortfall_share).toBeNull();
    expect(raspberry.expenses_share).toBeNull();
    expect(raspberry.basket_share).toBeNull();

    expect(res.full_cost).toBe('11000.00');
    expect(add(res.full_cost!, res.unweighed.accrued)).toBe(res.total_check);
    expect(res.checks?.total_ok).toBe(true);
    expect(res.checks?.shares_ok).toBe(true);
  });

  it('nothing weighed', async () => {
    const res = await svcWithNoReweigh.forShift(owner, 's-1');

    // §8.6 «Це не нуль» — every figure that depends on per_kg is a dash.
    expect(res.weighed).toBeNull();
    expect(res.full_cost).toBeNull();
    expect(res.price_cost_avg).toBeNull();
    expect(res.checks).toBeNull();
    expect(res.unweighed.accrued).toBe(res.accrued);
    expect(res.unweighed.intake_kg).toBe('865.00');
    expect(res.products.every((p) => p.full_cost === null)).toBe(true);
    expect(res.products.every((p) => p.shortfall_share === null)).toBe(true);
    expect(res.products.every((p) => p.expenses_share === null)).toBe(true);
  });

  it('empty basket', async () => {
    const res = await build(
      DAY.map((g) => ({ ...g, reweigh_net_kg: g.intake_net_kg })),
      '0.00',
    ).forShift(owner, 's-1');

    // allocate over two zero weights splits evenly — of a zero total, so
    // both halves are 0,00 rather than a surprise.
    expect(res.basket).toBe('0.00');
    expect(res.per_kg).toBe('0.00');
    expect(res.shortfall_per_kg).toBe('0.00');
    expect(res.expenses_per_kg).toBe('0.00');
    for (const p of res.products) expect(p.price_cost).toBe(p.price_was);
    expect(res.checks).toEqual({ shares_ok: true, total_ok: true });
  });

  it('holds both splits and both checks for any day (property)', async () => {
    const kopiykas = (min: bigint, max: bigint) => fc.bigInt({ min, max }).map(fromKopiyka);
    const product = fc
      .record({
        intakeKopiykas: fc.bigInt({ min: 1n, max: 999_999n }),
        price: kopiykas(100n, 99_999n),
        reweighFraction: fc.double({ min: 0, max: 1, noNaN: true }),
      })
      .map(({ intakeKopiykas, price, reweighFraction }) => {
        // reweigh in [0.01, intake] — a product with zero on the scale is a
        // separate rule (§8.6) the cases above already pin.
        const span = Number(intakeKopiykas - 1n);
        const reweighKopiykas = 1n + BigInt(Math.floor(span * reweighFraction));
        const intake = fromKopiyka(intakeKopiykas);
        return { intake, price, reweigh: fromKopiyka(reweighKopiykas) };
      });

    await fc.assert(
      fc.asyncProperty(
        fc.array(product, { minLength: 1, maxLength: 4 }),
        kopiykas(0n, 9_999_999n),
        async (products, expenses) => {
          const grades: GradeTotalsRow[] = products.map((p, i) => ({
            product_id: `p-${i}`,
            product_name: `Товар ${i}`,
            product_grade_id: `g-${i}`,
            product_grade_name: `Сорт ${i}`,
            intake_net_kg: p.intake,
            intake_amount: mul(p.intake, p.price),
            reweigh_net_kg: p.reweigh,
          }));
          const res = await build(grades, expenses).forShift(owner, 's-1');

          expect(add(res.shortfall_per_kg!, res.expenses_per_kg!)).toBe(res.per_kg);
          expect(sum(res.products.map((p) => p.shortfall_share!))).toBe(res.shortfall_amount);
          expect(sum(res.products.map((p) => p.expenses_share!))).toBe(res.expenses_amount);
          expect(res.checks).toEqual({ shares_ok: true, total_ok: true });
        },
      ),
      { numRuns: 200 },
    );
  });
});

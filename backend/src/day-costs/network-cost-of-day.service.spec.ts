import { NetworkCostOfDayService } from './network-cost-of-day.service';
import { CostOfDayService } from './cost-of-day.service';
import { add, cmp, sub } from '../common/money';
import { UserRole } from '../users/user-role.enum';
import type { GradeTotalsRow } from '../reweighs/reweigh-reconciliation.service';

const owner = {
  sub: 'u-owner',
  username: 'admin',
  role: UserRole.NetworkOwner,
  collection_point_id: null,
} as never;

interface ShiftFixture {
  shift_id: string;
  point_id: string;
  point_name: string;
  grades: GradeTotalsRow[];
  expenses?: string;
  closed?: boolean;
}

/**
 * A `NetworkCostOfDayService` over the REAL `CostOfDayService`, both reading
 * one `DataSource` mock that answers by SQL shape and keys every per-shift
 * query on its `$1`. The network figures are sums of each point's own
 * cost-of-day, so the honest unit under test is the composition — a stubbed
 * `forShift` would let the fixtures disagree with what a point's own page
 * prints. No fixture uses top-ups.
 */
const build = (shifts: ShiftFixture[]) => {
  const byId = (params: unknown[]) => shifts.find((s) => s.shift_id === params[0]);
  // Audit M5: the whole network day is ONE REPEATABLE READ snapshot — every
  // read, the shift list and each point's day, goes through its manager.
  const manager = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM shifts s')) {
        return shifts.map((s) => ({
          shift_id: s.shift_id,
          point_id: s.point_id,
          point_name: s.point_name,
        }));
      }
      if (sql.includes('reweigh_items')) return byId(params)?.grades ?? [];
      if (sql.includes('FROM day_expenses')) return [{ total: byId(params)?.expenses ?? '0.00' }];
      if (sql.includes('MAX(ti.created_at)')) return [{ latest: null }];
      if (sql.includes('FROM intakes i')) return [];
      throw new Error(`unexpected query: ${sql}`);
    }),
  };
  const dataSource = {
    query: jest.fn(async () => {
      throw new Error('read outside the REPEATABLE READ transaction');
    }),
    transaction: jest.fn(async (_level: string, fn: (m: typeof manager) => unknown) => fn(manager)),
  };
  const shiftsService = {
    findOneRaw: jest.fn(async (id: string) => {
      const s = shifts.find((f) => f.shift_id === id);
      return s
        ? { id, closed_at: s.closed === false ? null : new Date('2026-08-04T18:00:00Z') }
        : null;
    }),
  };
  const costOfDay = new CostOfDayService(dataSource as never, shiftsService as never);
  const service = new NetworkCostOfDayService(dataSource as never, costOfDay);
  return Object.assign(service, { mocks: { dataSource, shiftsService, manager } });
};

const grade = (
  product: string,
  gradeId: string,
  netKg: string,
  amount: string,
  reweighNetKg: string | null = netKg,
): GradeTotalsRow => ({
  product_id: `p-${product}`,
  product_name: product,
  product_grade_id: gradeId,
  product_grade_name: `${product} 1`,
  intake_net_kg: netKg,
  intake_amount: amount,
  reweigh_net_kg: reweighNetKg,
});

// §8.6's own table, with §8.2's недостача on Шипинки (800 кг at 160,00, 790
// arrived) and each point's day expenses on top: Шипинки's own page reads
// 160,00 + 2,03 + 4,81 = 166,84; Гайове's 155,00 + 0,00 + 5,00 = 160,00.
const shypynky: ShiftFixture = {
  shift_id: 's-shp',
  point_id: 'pt-shp',
  point_name: 'Шипинки',
  grades: [grade('Малина', 'g-shp', '800.00', '128000.00', '790.00')],
  expenses: '3800.00',
};
const haiove: ShiftFixture = {
  shift_id: 's-hai',
  point_id: 'pt-hai',
  point_name: 'Гайове',
  grades: [grade('Малина', 'g-hai', '210.00', '32550.00')],
  expenses: '1050.00',
};

describe('NetworkCostOfDayService.forDate', () => {
  it('Σ повна вартість ÷ Σ база кг — NEVER the mean of the points’ собівартість (§8.6)', async () => {
    const out = await build([shypynky, haiove]).forDate(owner, '2026-08-04');
    const rasp = out.products.find((p) => p.product_name === 'Малина')!;

    expect(rasp.complete).toBe(true);
    expect(rasp.reweigh_net_kg).toBe('1000.00');
    // (128 000 − 1 600 + 1 600 + 3 800) + (32 550 + 1 050)
    expect(rasp.full_cost).toBe('165400.00');
    expect(rasp.price_cost).toBe('165.40');
    expect(rasp.price_cost).not.toBe('163.42'); // (166,84 + 160,00) ÷ 2 — the trap

    // Each point's sub-row is exactly what its own page prints.
    const shp = rasp.points.find((p) => p.point_name === 'Шипинки')!;
    expect(shp.price_cost).toBe('166.84');
    expect(shp.full_cost).toBe('131800.00');
    const hai = rasp.points.find((p) => p.point_name === 'Гайове')!;
    expect(hai.price_cost).toBe('160.00');
  });

  it('prints a row whose money adds up: нараховано − своя + частки = повна вартість', async () => {
    const out = await build([shypynky, haiove]).forDate(owner, '2026-08-04');
    const rasp = out.products[0];

    expect(rasp.accrued).toBe('160550.00');
    expect(rasp.intake_net_kg).toBe('1010.00');
    expect(rasp.price_was).toBe('158.96'); // 160 550,00 ÷ 1 010,00
    expect(rasp.shortfall).toBe('1600.00');
    expect(rasp.shortfall_kg).toBe('10.00');
    expect(rasp.shortfall_share).toBe('1600.00');
    expect(rasp.expenses_share).toBe('4850.00');
    const chain = add(
      add(sub(rasp.accrued, rasp.shortfall), rasp.shortfall_share!),
      rasp.expenses_share!,
    );
    expect(chain).toBe(rasp.full_cost);
    expect(rasp.unweighed).toBeNull();
  });

  it('sums the day: total row, formula operands and checks', async () => {
    const out = await build([shypynky, haiove]).forDate(owner, '2026-08-04');

    expect(out.date).toBe('2026-08-04');
    expect(out.points.map((p) => [p.point_name, p.expenses_amount, p.weighed])).toEqual([
      ['Шипинки', '3800.00', true],
      ['Гайове', '1050.00', true],
    ]);
    expect(out.accrued).toBe('160550.00');
    expect(out.expenses_amount).toBe('4850.00');
    expect(out.expenses_weighed).toBe('4850.00');
    expect(out.reweighed_kg).toBe('1000.00');
    expect(out.weighed).toEqual({
      intake_kg: '1010.00',
      shortfall_kg: '10.00',
      accrued: '160550.00',
      shortfall: '1600.00',
      shortfall_share: '1600.00',
      expenses_share: '4850.00',
      full_cost: '165400.00',
    });
    // The day formula «(weighed.accrued + expenses_weighed) ÷ reweighed_kg»
    // is exact because the numerator IS weighed.full_cost.
    expect(add(out.weighed!.accrued, out.expenses_weighed)).toBe(out.weighed!.full_cost);
    expect(out.price_cost_avg).toBe('165.40');
    expect(out.checks).toEqual({ points_ok: true, total_ok: true });
    expect(out.provisional).toBe(false);
  });

  it('leaves a point that has not weighed the product out of the row, and says so', async () => {
    const unweighed: ShiftFixture = {
      shift_id: 's-un',
      point_id: 'pt-un',
      point_name: 'Лісове',
      grades: [grade('Малина', 'g-un', '100.00', '15000.00', null)],
      expenses: '500.00',
    };
    const out = await build([shypynky, haiove, unweighed]).forDate(owner, '2026-08-04');
    const rasp = out.products[0];

    // Unchanged by the third point — «порожня клітинка … це не нуль».
    expect(rasp.reweigh_net_kg).toBe('1000.00');
    expect(rasp.accrued).toBe('160550.00');
    expect(rasp.price_cost).toBe('165.40');
    expect(rasp.unweighed).toEqual({ intake_kg: '100.00', accrued: '15000.00' });

    const cell = rasp.points.find((p) => p.point_name === 'Лісове')!;
    expect(cell.complete).toBe(false);
    expect(cell.reweigh_net_kg).toBeNull();
    expect(cell.full_cost).toBeNull();
    expect(cell.price_cost).toBeNull();

    // Its 500,00 of expenses landed on no kilogram yet: in the day's total,
    // out of the formula, and the звірка still closes.
    expect(out.points.find((p) => p.point_name === 'Лісове')!.weighed).toBe(false);
    expect(out.expenses_amount).toBe('5350.00');
    expect(out.expenses_weighed).toBe('4850.00');
    expect(out.unweighed).toEqual({ intake_kg: '100.00', accrued: '15000.00' });
    expect(out.checks).toEqual({ points_ok: true, total_ok: true });
  });

  it('reads a product nobody weighed like the single-point «не переважено» row', async () => {
    const a: ShiftFixture = {
      shift_id: 's-a',
      point_id: 'pt-a',
      point_name: 'А',
      grades: [grade('Ожина', 'g-a', '50.00', '7500.00', null)],
    };
    const b: ShiftFixture = {
      shift_id: 's-b',
      point_id: 'pt-b',
      point_name: 'Б',
      grades: [grade('Ожина', 'g-b', '30.00', '4800.00', null)],
    };
    const out = await build([a, b]).forDate(owner, '2026-08-04');
    const black = out.products[0];

    expect(black.complete).toBe(false);
    expect(black.intake_net_kg).toBe('80.00');
    expect(black.accrued).toBe('12300.00');
    expect(black.price_was).toBe('153.75');
    for (const v of [
      black.reweigh_net_kg,
      black.shortfall_share,
      black.expenses_share,
      black.full_cost,
      black.price_cost,
      black.unweighed,
    ]) {
      expect(v).toBeNull();
    }
    // Nothing weighed anywhere: no total row, no average, nothing to reconcile.
    expect(out.weighed).toBeNull();
    expect(out.price_cost_avg).toBeNull();
    expect(out.checks).toBeNull();
    expect(out.unweighed).toEqual({ intake_kg: '80.00', accrued: '12300.00' });
  });

  it('lists only the points that accepted a product under it', async () => {
    const lisove: ShiftFixture = {
      shift_id: 's-lis',
      point_id: 'pt-lis',
      point_name: 'Лісове',
      grades: [grade('Ожина', 'g-lis', '50.00', '7500.00')],
    };
    const out = await build([shypynky, haiove, lisove]).forDate(owner, '2026-08-04');

    expect(out.products.map((p) => p.product_name)).toEqual(['Малина', 'Ожина']);
    const rasp = out.products[0];
    expect(rasp.points.map((p) => p.point_name)).toEqual(['Шипинки', 'Гайове']);
    expect(out.products[1].points.map((p) => p.point_name)).toEqual(['Лісове']);
    // Ожина's price is its own: Σ over one point.
    expect(out.products[1].price_cost).toBe('150.00');
    expect(cmp(out.price_cost_avg!, '0.00')).toBe(1);
  });

  it('marks the day provisional while any point’s shift is still open', async () => {
    const out = await build([shypynky, { ...haiove, closed: false }]).forDate(owner, '2026-08-04');

    expect(out.provisional).toBe(true);
    expect(out.points.map((p) => p.provisional)).toEqual([false, true]);
    expect(out.products[0].points.map((p) => p.provisional)).toEqual([false, true]);
  });

  it('answers an empty network day with empty lists and dashes, not zeros', async () => {
    const out = await build([]).forDate(owner, '2026-08-04');

    expect(out.points).toEqual([]);
    expect(out.products).toEqual([]);
    expect(out.weighed).toBeNull();
    expect(out.price_cost_avg).toBeNull();
    expect(out.checks).toBeNull();
    expect(out.accrued).toBe('0.00');
  });

  // Audit M5 — a network row is a sum of point rows; it equals them only if
  // every point's day is read at the same instant: one transaction, not one
  // per point.
  it('reads every point’s day inside ONE REPEATABLE READ transaction', async () => {
    const service = build([shypynky, haiove]);
    await service.forDate(owner, '2026-08-04');

    const { dataSource, shiftsService, manager } = service.mocks;
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(dataSource.transaction.mock.calls[0][0]).toBe('REPEATABLE READ');
    expect(dataSource.query).not.toHaveBeenCalled();
    expect(shiftsService.findOneRaw).toHaveBeenCalledWith('s-shp', manager);
    expect(shiftsService.findOneRaw).toHaveBeenCalledWith('s-hai', manager);
  });
  describe('§8.5 split strategies (spec 2026-10-24 §3.4)', () => {
    it('passes the split to every point’s day and echoes it', async () => {
      const spy = jest.spyOn(CostOfDayService.prototype, 'forShiftIn');
      const out = await build([shypynky, haiove]).forDate(owner, '2026-08-04', 'value');
      expect(out.split).toBe('value');
      expect(spy).toHaveBeenCalledTimes(2);
      for (const call of spy.mock.calls) expect(call[2]).toBe('value');
      spy.mockRestore();
    });

    it('defaults to weight', async () => {
      const out = await build([shypynky, haiove]).forDate(owner, '2026-08-04');
      expect(out.split).toBe('weight');
    });

    it('keeps total_ok on a point whose weighed accrued is zero, under value', async () => {
      const free: ShiftFixture = {
        shift_id: 's-free',
        point_id: 'pt-free',
        point_name: 'Безкоштовна',
        grades: [grade('Малина', 'g-free', '50.00', '0.00', '49.00')],
        expenses: '500.00',
      };
      const out = await build([shypynky, free]).forDate(owner, '2026-08-04', 'value');
      expect(out.checks).toEqual({ points_ok: true, total_ok: true });
    });
  });
});

import { NetworkAverageService } from './network-average.service';
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
}

/**
 * Builds a `NetworkAverageService` whose `DataSource.query` answers two
 * queries by SQL shape: the shift roster for the date (matched on `FROM
 * shifts s`), and `gradeTotals`'s per-shift query (matched on `reweigh_items`
 * — same text `productCostRows`/`gradeTotals` issue, keyed by the shiftId
 * bind parameter so different shifts can return different fixtures). No
 * fixture here uses top-ups, so the `FROM intakes i` receipts query always
 * answers empty and the accrued figure is the intake amount verbatim.
 */
const build = (shifts: ShiftFixture[]) => {
  const dataSource = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM shifts s')) {
        return shifts.map((s) => ({
          shift_id: s.shift_id,
          point_id: s.point_id,
          point_name: s.point_name,
        }));
      }
      if (sql.includes('reweigh_items')) {
        const shiftId = params[0] as string;
        return shifts.find((s) => s.shift_id === shiftId)?.grades ?? [];
      }
      if (sql.includes('FROM intakes i')) {
        return [];
      }
      throw new Error(`unexpected query: ${sql}`);
    }),
  };
  return new NetworkAverageService(dataSource as never);
};

// The client's own worked table (§8.6): Шипинки 790 кг / 126 400,00 ₴,
// Гайове 210 кг / 32 550,00 ₴.
//
// `reweighNetKg` defaults to the intake weight — a point with nothing
// missing, where сума is the intake amount verbatim. Шипинки passes it
// EXPLICITLY, and that is the point: §8.6's сума is «нараховано − недостача»,
// so a fixture where недостача is always zero leaves the subtraction unproven
// — replacing `sub` with `add`, or dropping the term altogether, would keep
// every assertion in this file green. Шипинки's 126 400,00 therefore ARISES
// here as 128 000,00 − 1 600,00 (§8.2's own worked numbers: 800 кг accrued at
// 160,00, 10 кг short) instead of being seeded as a finished figure.
const raspberryGrade = (
  netKg: string,
  amount: string,
  gradeId: string,
  reweighNetKg: string | null = netKg,
): GradeTotalsRow => ({
  product_id: 'p-rasp',
  product_name: 'Малина',
  product_grade_id: gradeId,
  product_grade_name: 'Малина 1',
  intake_net_kg: netKg,
  intake_amount: amount,
  reweigh_net_kg: reweighNetKg,
});

const shypynky: ShiftFixture = {
  shift_id: 's-shypynky',
  point_id: 'pt-shypynky',
  point_name: 'Шипинки',
  grades: [raspberryGrade('800.00', '128000.00', 'g-shp-rasp', '790.00')],
};

const haiove: ShiftFixture = {
  shift_id: 's-haiove',
  point_id: 'pt-haiove',
  point_name: 'Гайове',
  grades: [raspberryGrade('210.00', '32550.00', 'g-hai-rasp')],
};

describe('NetworkAverageService.forDate', () => {
  it('sums then divides; NEVER averages the averages — §8.6', async () => {
    const svc = build([shypynky, haiove]);
    const out = await svc.forDate(owner, '2026-08-04');
    const raspberry = out.products.find((p) => p.product_name === 'Малина')!;
    expect(raspberry.total_kg).toBe('1000.00');
    expect(raspberry.total_amount).toBe('158950.00');
    expect(raspberry.average_price).toBe('158.95');
    expect(raspberry.average_price).not.toBe('157.50'); // (160 + 155) ÷ 2 — the wrong answer
  });

  /**
   * §8.6's сума is «нараховано − недостача», and this is the only test that
   * can tell the subtraction from an addition or from nothing at all:
   * Шипинки accrued 128 000,00 over 800 кг and arrived 10 кг short, so its
   * cell must read 126 400,00 against the 790 кг that actually turned up. An
   * implementation that forgot the term would print 128 000,00 and a network
   * average of 160,55.
   */
  it('subtracts the недостача from a point’s cell — сума is what ARRIVED, not what was accrued', async () => {
    const svc = build([shypynky, haiove]);
    const out = await svc.forDate(owner, '2026-08-04');
    const raspberry = out.products.find((p) => p.product_name === 'Малина')!;

    const shp = raspberry.points.find((p) => p.point_name === 'Шипинки')!;
    expect(shp.weight_kg).toBe('790.00');
    expect(shp.amount).toBe('126400.00');
    expect(shp.amount).not.toBe('128000.00'); // the figure a missing `sub` would print

    // And the day's average moves with it, so the term is load-bearing here too.
    expect(raspberry.average_price).not.toBe('160.55');
  });

  it('excludes a point that accepted the product but has NOT weighed it — §8.6', async () => {
    const notWeighed: ShiftFixture = {
      shift_id: 's-not-weighed',
      point_id: 'pt-not-weighed',
      point_name: 'Не зважений',
      grades: [
        {
          product_id: 'p-rasp',
          product_name: 'Малина',
          product_grade_id: 'g-nw-rasp',
          product_grade_name: 'Малина 1',
          intake_net_kg: '100.00',
          intake_amount: '15000.00',
          reweigh_net_kg: null, // accepted, not yet weighed
        },
      ],
    };
    const svc = build([shypynky, haiove, notWeighed]);
    const out = await svc.forDate(owner, '2026-08-04');
    const raspberry = out.products.find((p) => p.product_name === 'Малина')!;
    expect(raspberry.total_kg).toBe('1000.00'); // unchanged — the cell is empty, not zero
    expect(raspberry.total_amount).toBe('158950.00');
    const point = raspberry.points.find((p) => p.point_name === 'Не зважений')!;
    expect(point.weight_kg).toBeNull();
    expect(point.amount).toBeNull();
  });

  it('excludes a point that did not accept the product at all', async () => {
    // Шипинки and Гайове sold raspberry; Лісове sold only ожина that day.
    const lisove: ShiftFixture = {
      shift_id: 's-lisove',
      point_id: 'pt-lisove',
      point_name: 'Лісове',
      grades: [
        {
          product_id: 'p-black',
          product_name: 'Ожина',
          product_grade_id: 'g-lis-black',
          product_grade_name: 'Ожина 1',
          intake_net_kg: '50.00',
          intake_amount: '7500.00',
          reweigh_net_kg: '50.00',
        },
      ],
    };
    const svc = build([shypynky, haiove, lisove]);
    const out = await svc.forDate(owner, '2026-08-04');
    const raspberry = out.products.find((p) => p.product_name === 'Малина')!;
    // Not a null row, not a zero row — absent entirely.
    expect(raspberry.points.map((p) => p.point_name)).not.toContain('Лісове');
    expect(raspberry.total_kg).toBe('1000.00');
  });

  it('returns a null average_price — never 0.00 — when total weight is zero (§8.6 «Це не нуль»)', async () => {
    const onlyUnweighed: ShiftFixture = {
      shift_id: 's-only-unweighed',
      point_id: 'pt-only-unweighed',
      point_name: 'Тільки прийом',
      grades: [
        {
          product_id: 'p-rasp',
          product_name: 'Малина',
          product_grade_id: 'g-only-rasp',
          product_grade_name: 'Малина 1',
          intake_net_kg: '100.00',
          intake_amount: '15000.00',
          reweigh_net_kg: null,
        },
      ],
    };
    const svc = build([onlyUnweighed]);
    const out = await svc.forDate(owner, '2026-08-04');
    const raspberry = out.products.find((p) => p.product_name === 'Малина')!;
    expect(raspberry.total_kg).toBe('0.00');
    expect(raspberry.average_price).toBeNull();
  });
});

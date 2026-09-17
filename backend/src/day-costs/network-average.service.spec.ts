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
// Гайове 210 кг / 32 550,00 ₴ — neither point has a shortfall, so сума is
// the intake amount verbatim and вага is the intake weight verbatim.
const raspberryGrade = (netKg: string, amount: string, gradeId: string): GradeTotalsRow => ({
  product_id: 'p-rasp',
  product_name: 'Малина',
  product_grade_id: gradeId,
  intake_net_kg: netKg,
  intake_amount: amount,
  reweigh_net_kg: netKg,
});

const shypynky: ShiftFixture = {
  shift_id: 's-shypynky',
  point_id: 'pt-shypynky',
  point_name: 'Шипинки',
  grades: [raspberryGrade('790.00', '126400.00', 'g-shp-rasp')],
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

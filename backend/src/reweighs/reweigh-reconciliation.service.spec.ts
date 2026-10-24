import { IsNull } from 'typeorm';
import { ReweighReconciliationService } from './reweigh-reconciliation.service';
import type { GradeTotalsRow } from './reweigh-reconciliation.service';
import { UserRole } from '../users/user-role.enum';

// `sub`, not `id` — matches the real `AuthenticatedUser` shape
// (`auth/jwt.strategy.ts`); see `reweighs.service.spec.ts`'s own note.
const owner = { sub: 'u-owner', role: UserRole.NetworkOwner, collection_point_id: null } as never;

/**
 * `forShift` runs three statements through `dataSource.query` — `gradeTotals`,
 * `topUpsByGradeForShift` and `tareUnitsByGrade` — so the fake answers by the
 * table each one reads. Unset sources answer `[]`: no доплати, no tare units.
 */
const fakeQuery = (
  grades: () => unknown[],
  receipts: () => unknown[] = () => [],
  tare: () => unknown[] = () => [],
) =>
  jest.fn(async (sql: string) => {
    if (sql.includes('intake_top_ups')) return receipts();
    if (sql.includes('intake_item_tare_types')) return tare();
    return grades();
  });

describe('ReweighReconciliationService.forShift', () => {
  const build = (
    shift: Record<string, unknown>,
    rows: Record<string, unknown>[],
    receipts: Record<string, unknown>[] = [],
    tare: Record<string, unknown>[] = [],
  ) => {
    // `items` (§5.3) is read through the repository, not through `query`;
    // the empty list keeps these cases about the PRODUCT arithmetic, which
    // is all this spec ever asserted. `reweigh-reconciliation.db-spec.ts`
    // is where the item list is proven, because what matters there is that
    // the relations are really loaded.
    const dataSource = {
      query: fakeQuery(() => rows, () => receipts, () => tare),
      getRepository: jest.fn(() => ({ find: jest.fn(async () => []) })),
    };
    const shifts = { findOneRaw: jest.fn(async () => shift) };
    return new ReweighReconciliationService(dataSource as never, shifts as never);
  };

  const raspberry = {
    product_id: 'p-rasp',
    product_name: 'Малина',
    product_grade_id: 'g-rasp-1',
    intake_net_kg: '800.00',
    intake_amount: '128000.00',
    reweigh_net_kg: '790.00',
  };

  it('computes §8.2 exactly: −10 кг → −1 600,00 ₴', async () => {
    const svc = build({ id: 's-1', closed_at: new Date() }, [raspberry]);
    const out = await svc.forShift(owner, 's-1');
    const p = out.products[0];
    expect(p.state).toBe('weighed');
    expect(p.missing_kg).toBe('10.00');
    expect(p.missing_amount).toBe('1600.00');
  });

  it('prices недостача at what was ACTUALLY paid, bonuses included — spec §3.6', async () => {
    // 800 кг accrued 132 000 because of a +5 ₴/кг bonus → 165,00 ₴/кг, not 160,00
    const svc = build({ id: 's-1', closed_at: new Date() }, [
      { ...raspberry, intake_amount: '132000.00' },
    ]);
    const out = await svc.forShift(owner, 's-1');
    expect(out.products[0].missing_amount).toBe('1650.00');
  });

  it('prices it off the whole-hryvnia amount, not off net × rate — §2.12 (#56)', async () => {
    // 36,90 × 57,00 = 2 103,30 was paid as 2 103,00 → 56,99 ₴/кг, not 57,00.
    const svc = build({ id: 's-1', closed_at: new Date() }, [
      { ...raspberry, intake_net_kg: '36.90', intake_amount: '2103.00', reweigh_net_kg: '35.90' },
    ]);
    const out = await svc.forShift(owner, 's-1');
    expect(out.products[0].missing_amount).toBe('56.99');
  });

  it('reports «—» while the shift is still open — spec §3.9', async () => {
    const svc = build({ id: 's-1', closed_at: null }, [raspberry]);
    const out = await svc.forShift(owner, 's-1');
    expect(out.products[0].missing_kg).toBeNull();
    expect(out.products[0].missing_amount).toBeNull();
  });

  it('marks a product with NO reweigh line as not_reweighed, never as zero — §8.2, §8.6', async () => {
    const svc = build({ id: 's-1', closed_at: new Date() }, [
      { ...raspberry, reweigh_net_kg: null },
    ]);
    const p = (await svc.forShift(owner, 's-1')).products[0];
    expect(p.state).toBe('not_reweighed');
    expect(p.missing_kg).toBeNull();
  });

  it('marks a PARTIALLY weighed product as not_reweighed — spec §3.15', async () => {
    const svc = build({ id: 's-1', closed_at: new Date() }, [
      raspberry,
      {
        ...raspberry,
        product_grade_id: 'g-rasp-2',
        intake_net_kg: '50.00',
        intake_amount: '7500.00',
        reweigh_net_kg: null,
      },
    ]);
    const p = (await svc.forShift(owner, 's-1')).products[0];
    expect(p.state).toBe('not_reweighed');
  });

  it('surfaces a surplus as a signed number rather than hiding it — §8.2 надлишок', async () => {
    const svc = build({ id: 's-1', closed_at: new Date() }, [
      { ...raspberry, reweigh_net_kg: '805.00' },
    ]);
    const p = (await svc.forShift(owner, 's-1')).products[0];
    expect(p.missing_kg).toBe('-5.00');
  });

  /**
   * Гайове 19.10 (review §0): Малина 333,70 + 263,10 = 596,80 кг at the point,
   * 227,40 + 368,00 = 595,40 at the base, receipts 41 977,00 + 56 067,20 and
   * one 15 000,00 доплата. Receipts alone price it at 164,28 → 229,99 ₴; with
   * the доплата it is 113 044,20 ÷ 596,80 = 189,42 → 265,19 ₴, cost-of-day's
   * figure.
   */
  const haiove = [
    {
      ...raspberry, product_grade_id: 'g-rasp-1', product_grade_name: '1 сорт',
      intake_net_kg: '333.70', intake_amount: '41977.00', reweigh_net_kg: '227.40',
    },
    {
      ...raspberry, product_grade_id: 'g-rasp-2', product_grade_name: '2 сорт',
      intake_net_kg: '263.10', intake_amount: '56067.20', reweigh_net_kg: '368.00',
    },
  ];
  const haioveTopUp = [
    {
      intake_id: 'i-3',
      top_up_total: '15000.00',
      lines: [{ product_grade_id: 'g-rasp-1', amount: '41977.00' }],
    },
  ];

  it('prices the shortfall at accrued INCLUDING доплати, and says the rate — review §0, W2', async () => {
    const svc = build({ id: 's-1', closed_at: new Date() }, haiove, haioveTopUp);
    const p = (await svc.forShift(owner, 's-1')).products[0];
    expect(p.missing_kg).toBe('1.40');
    expect(p.rate).toBe('189.42');
    expect(p.missing_amount).toBe('265.19');
    // Audit 2026-10-24 E5: the rate's own operands, so the screen can print
    // «113 044,20 ÷ 596,80 = 189,42» — accrued WITH the доплата, and the доплата.
    expect(p.accrued).toBe('113044.20');
    expect(p.top_ups).toBe('15000.00');
  });

  it('without a доплата the same day prices at the receipts alone', async () => {
    const svc = build({ id: 's-1', closed_at: new Date() }, haiove);
    const p = (await svc.forShift(owner, 's-1')).products[0];
    expect(p.rate).toBe('164.28');
    expect(p.missing_amount).toBe('229.99');
    expect(p.accrued).toBe('98044.20');
    expect(p.top_ups).toBe('0.00');
  });

  it('totals only the shortfalls — a surplus never offsets another product — W2', async () => {
    const cornel = {
      ...raspberry, product_id: 'p-corn', product_name: 'Кизил', product_grade_id: 'g-corn',
      intake_net_kg: '15.70', intake_amount: '600.00', reweigh_net_kg: '17.70',
    };
    const svc = build({ id: 's-1', closed_at: new Date() }, [...haiove, cornel], haioveTopUp);
    const out = await svc.forShift(owner, 's-1');
    expect(out.products.find((p) => p.product_id === 'p-corn')?.missing_kg).toBe('-2.00');
    expect(out.missing_total_kg).toBe('1.40');
    expect(out.missing_total_amount).toBe('265.19');
  });

  it('totals 0.00 when every priced product is a surplus, and null while nothing is priced', async () => {
    const surplus = build({ id: 's-1', closed_at: new Date() }, [{ ...raspberry, reweigh_net_kg: '805.00' }]);
    const s1 = await surplus.forShift(owner, 's-1');
    expect(s1.missing_total_kg).toBe('0.00');
    expect(s1.missing_total_amount).toBe('0.00');

    const open = build({ id: 's-1', closed_at: null }, [raspberry]);
    const s2 = await open.forShift(owner, 's-1');
    expect(s2.missing_total_kg).toBeNull();
    expect(s2.missing_total_amount).toBeNull();
  });

  it('counts tare units per grade and per product, point vs base, never from kilograms — W5', async () => {
    const svc = build({ id: 's-1', closed_at: new Date() }, haiove, [], [
      { product_grade_id: 'g-rasp-1', tare_type_id: 't-crate', tare_type_name: 'Ящик', point_units: 82, base_units: 48 },
      { product_grade_id: 'g-rasp-2', tare_type_id: 't-crate', tare_type_name: 'Ящик', point_units: 54, base_units: 88 },
      { product_grade_id: 'g-rasp-2', tare_type_id: 't-lub', tare_type_name: 'Лубянка', point_units: 3, base_units: 0 },
    ]);
    const out = await svc.forShift(owner, 's-1');
    expect(out.grades.map((g) => [g.crates.point, g.crates.base])).toEqual([
      [82, 48],
      [57, 88],
    ]);
    expect(out.products[0].crates).toEqual({
      point: 139,
      base: 136,
      by_type: [
        { tare_type_id: 't-lub', tare_type_name: 'Лубянка', point: 3, base: 0 },
        { tare_type_id: 't-crate', tare_type_name: 'Ящик', point: 136, base: 136 },
      ],
    });
  });

  it('carries zero crates, not a guess, when no unit rows exist', async () => {
    const svc = build({ id: 's-1', closed_at: new Date() }, [raspberry]);
    const out = await svc.forShift(owner, 's-1');
    expect(out.products[0].crates).toEqual({ point: 0, base: 0, by_type: [] });
  });

  it('says so when the point accepted nothing that day — §8.1', async () => {
    const svc = build({ id: 's-1', closed_at: new Date() }, []);
    const out = await svc.forShift(owner, 's-1');
    expect(out.accepted_anything).toBe(false);
    expect(out.products).toEqual([]);
  });
});

const gradeRow = (over: Partial<GradeTotalsRow> & Pick<GradeTotalsRow, 'product_grade_id'>): GradeTotalsRow => ({
  product_id: 'prod-1',
  product_name: 'Малина',
  product_grade_name: 'Малина 1',
  intake_net_kg: '100.00',
  intake_amount: '10000.00',
  reweigh_net_kg: null,
  ...over,
});

describe('grades[]', () => {
  let rows: GradeTotalsRow[];
  let service: ReweighReconciliationService;
  const actor = owner;

  beforeEach(() => {
    rows = [];
    const dataSource = {
      query: fakeQuery(() => rows),
      getRepository: jest.fn(() => ({ find: jest.fn(async () => []) })),
    };
    const shifts = { findOneRaw: jest.fn(async () => ({ id: 'shift-1', closed_at: new Date() })) };
    service = new ReweighReconciliationService(dataSource as never, shifts as never);
  });

  it('lists one row per accepted grade, with its product', async () => {
    rows = [
      gradeRow({
        product_id: 'prod-1', product_name: 'Малина',
        product_grade_id: 'g-1', product_grade_name: 'Малина 1',
        intake_net_kg: '200.00', intake_amount: '20000.00', reweigh_net_kg: '190.00',
      }),
      gradeRow({
        product_id: 'prod-1', product_name: 'Малина',
        product_grade_id: 'g-2', product_grade_name: 'Малина 3',
        intake_net_kg: '100.00', intake_amount: '7000.00', reweigh_net_kg: null,
      }),
    ];

    const res = await service.forShift(actor, 'shift-1');

    expect(res.grades).toEqual([
      {
        product_grade_id: 'g-1', product_grade_name: 'Малина 1',
        product_id: 'prod-1', product_name: 'Малина',
        intake_net_kg: '200.00', reweigh_net_kg: '190.00',
        crates: { point: 0, base: 0, by_type: [] },
      },
      {
        product_grade_id: 'g-2', product_grade_name: 'Малина 3',
        product_id: 'prod-1', product_name: 'Малина',
        intake_net_kg: '100.00', reweigh_net_kg: '0.00',
        crates: { point: 0, base: 0, by_type: [] },
      },
    ]);
  });

  it('reports an unweighed grade as 0.00 while still marking the PRODUCT not_reweighed', async () => {
    rows = [
      gradeRow({
        product_id: 'prod-1', product_name: 'Малина',
        product_grade_id: 'g-2', product_grade_name: 'Малина 3',
        intake_net_kg: '100.00', intake_amount: '7000.00', reweigh_net_kg: null,
      }),
    ];

    const res = await service.forShift(actor, 'shift-1');

    expect(res.grades[0].reweigh_net_kg).toBe('0.00');
    expect(res.products[0].state).toBe('not_reweighed');
    expect(res.products[0].missing_kg).toBeNull();
  });

  it('is empty when the shift accepted nothing', async () => {
    rows = [];
    const res = await service.forShift(actor, 'shift-1');
    expect(res.grades).toEqual([]);
    expect(res.accepted_anything).toBe(false);
  });
});

describe('include_voided', () => {
  let rows: GradeTotalsRow[];
  let service: ReweighReconciliationService;
  let itemRepo: { find: jest.Mock };
  const actor = owner;

  beforeEach(() => {
    rows = [];
    itemRepo = { find: jest.fn(async () => []) };
    const dataSource = {
      query: fakeQuery(() => rows),
      getRepository: jest.fn(() => itemRepo),
    };
    const shifts = { findOneRaw: jest.fn(async () => ({ id: 'shift-1', closed_at: new Date() })) };
    service = new ReweighReconciliationService(dataSource as never, shifts as never);
  });

  it('omits voided lines by default', async () => {
    await service.forShift(actor, 'shift-1');
    expect(itemRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { reweigh: { shift_id: 'shift-1' }, voided_at: IsNull() },
      }),
    );
  });

  it('asks for every line, voided included, when told to', async () => {
    await service.forShift(actor, 'shift-1', true);
    expect(itemRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { reweigh: { shift_id: 'shift-1' } } }),
    );
  });

  it('never lets a voided line move a products[] figure', async () => {
    // `products[]` comes from gradeTotals' SQL, which filters ri.voided_at IS NULL
    // itself — the flag must not reach it.
    rows = [
      gradeRow({
        product_grade_id: 'g-1',
        intake_net_kg: '200.00', intake_amount: '20000.00', reweigh_net_kg: '190.00',
      }),
    ];
    const withVoided = await service.forShift(actor, 'shift-1', true);
    const without = await service.forShift(actor, 'shift-1', false);
    expect(withVoided.products).toEqual(without.products);
  });
});

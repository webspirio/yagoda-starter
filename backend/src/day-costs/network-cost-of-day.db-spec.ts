import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { NetworkCostOfDayService } from './network-cost-of-day.service';
import { CostOfDayService } from './cost-of-day.service';
import { Shift } from '../shifts/shift.entity';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { UserRole } from '../users/user-role.enum';

const pointCode = (): string => randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();

/** Deterministic small hash so each test picks its own `business_date`
 *  without colliding with another test's fixtures or another db-spec's
 *  `CURRENT_DATE` seeds — this spec is the only one in the suite that scopes
 *  purely by `business_date` with no other tag, so date collision is the one
 *  isolation risk worth guarding explicitly. */
function hashOf(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (h * 31 + value.charCodeAt(i)) | 0;
  }
  return h;
}

const businessDateFor = (tag: string, monthPrefix: string): string =>
  `${monthPrefix}${(1 + (Math.abs(hashOf(tag)) % 27)).toString().padStart(2, '0')}`;

/**
 * «Усі точки» seeded for real: §8.6's own table — Шипинки 800 кг accrued at
 * 160,00 with 790 кг arrived, Гайове 210 кг at 155,00 — plus each point's day
 * expenses, one shared raspberry grade (the catalog is global, so both points'
 * receipts must reference the SAME `product_grades` row for there to be
 * anything to sum), read back through the ACTUAL roster SQL and every
 * `CostOfDayService.forShift` query underneath it. The unit spec proves the
 * summing; this one proves the queries parse, join and come back as the code
 * expects.
 */
describe('NetworkCostOfDayService.forDate (DB)', () => {
  let ds: DataSource;
  let service: NetworkCostOfDayService;
  let ownerId: string;

  const shiftsStub = {
    findOneRaw: async (id: string) => ds.manager.getRepository(Shift).findOne({ where: { id } }),
  };

  beforeAll(async () => {
    ds = await openTestDataSource();
    service = new NetworkCostOfDayService(ds, new CostOfDayService(ds, shiftsStub as never));

    const [owner] = await ds.query(
      `INSERT INTO users (first_name, last_name, role) VALUES ('Керівник', 'Тест', 'network_owner')
       RETURNING id`,
    );
    ownerId = owner.id;
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  const actor = (): AuthenticatedUser =>
    ({
      sub: ownerId,
      username: 'owner',
      role: UserRole.NetworkOwner,
      collection_point_id: null,
    }) as AuthenticatedUser;

  const seedProduct = async (name: string): Promise<{ productId: string; gradeId: string }> => {
    const [product] = await ds.query(`INSERT INTO products (name) VALUES ($1) RETURNING id`, [
      name,
    ]);
    const [grade] = await ds.query(
      `INSERT INTO product_grades (product_id, name) VALUES ($1, 'Стандарт') RETURNING id`,
      [product.id],
    );
    return { productId: product.id, gradeId: grade.id };
  };

  const seedSecondGrade = async (productId: string): Promise<string> => {
    const [grade] = await ds.query(
      `INSERT INTO product_grades (product_id, name) VALUES ($1, 'Сорт 2') RETURNING id`,
      [productId],
    );
    return grade.id;
  };

  /** A point that accepted the SAME product in two grades and put only the
   *  first of them on the scale — §3.15's partial weighing, which is neither
   *  «weighed» nor «never touched». */
  const seedPartiallyWeighedPoint = async (
    businessDate: string,
    pointName: string,
    gradeA: string,
    gradeB: string,
  ): Promise<{ pointId: string }> => {
    const short = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();

    const [point] = await ds.query(
      `INSERT INTO collection_points (name, code, kind) VALUES ($1, $2, 'reception') RETURNING id`,
      [pointName, pointCode()],
    );
    const [shift] = await ds.query(
      `INSERT INTO shifts (collection_point_id, business_date, status, opened_by_user_id, closed_at, closed_by_user_id)
       VALUES ($1, $2, 'closed', $3, now(), $3) RETURNING id`,
      [point.id, businessDate, ownerId],
    );
    const [supplier] = await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name)
       VALUES ($1, 'Іван', $2) RETURNING id`,
      [point.id, `Постачальник-${short}`],
    );
    const [intake] = await ds.query(
      `INSERT INTO intakes (code, shift_id, supplier_id, amount, balance_after, received_by_user_id)
       VALUES ($1, $2, $3, '18000.00', '0.00', $4) RETURNING id`,
      [`${short}-IN-1`, shift.id, supplier.id, ownerId],
    );
    await ds.query(
      `INSERT INTO intake_items (intake_id, item_order, product_grade_id,
           gross_kg, pallet_kg, tare_weight_kg, net_kg, price, bonus, amount)
       VALUES ($1, 1, $2, '100.00', '0.00', '0.00', '100.00', '100.00', '0.00', '10000.00'),
              ($1, 2, $3, '100.00', '0.00', '0.00', '100.00', '80.00', '0.00', '8000.00')`,
      [intake.id, gradeA, gradeB],
    );

    // Only сорт 1 reaches the scale, and it is 5 кг light.
    const [reweighHeader] = await ds.query(
      `INSERT INTO reweighs (shift_id) VALUES ($1) RETURNING id`,
      [shift.id],
    );
    await ds.query(
      `INSERT INTO reweigh_items (reweigh_id, item_order, product_grade_id,
           gross_kg, pallet_kg, tare_weight_kg, net_kg, weighed_by_user_id)
       VALUES ($1, 1, $2, '95.00', '0.00', '0.00', '95.00', $3)`,
      [reweighHeader.id, gradeA, ownerId],
    );

    return { pointId: point.id };
  };

  /** One point's shift with a single receipt against `gradeId`. `reweighKg`
   *  defaults to `netKg` — reweighed in full, so сума = accrued exactly and
   *  there is no shortfall. Pass a SMALLER `reweighKg` to seed a real
   *  недостача; pass `reweigh: false` to leave the intake unweighed;
   *  `expenses` is the point's one day-expense line, none when omitted. */
  const seedPoint = async (
    tag: string,
    businessDate: string,
    pointName: string,
    gradeId: string,
    netKg: string,
    amount: string,
    reweigh: boolean,
    reweighKg: string = netKg,
    expenses?: string,
  ): Promise<{ pointId: string; shiftId: string }> => {
    // A fresh UUID per call, not derived from `tag` — two points seeded off
    // the same `tag` would otherwise share their first 8 characters and
    // collide on `UQ_intakes_code` (global, not per-point).
    const short = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();

    const [point] = await ds.query(
      `INSERT INTO collection_points (name, code, kind) VALUES ($1, $2, 'reception') RETURNING id`,
      [pointName, pointCode()],
    );
    const [shift] = await ds.query(
      `INSERT INTO shifts (collection_point_id, business_date, status, opened_by_user_id, closed_at, closed_by_user_id)
       VALUES ($1, $2, 'closed', $3, now(), $3) RETURNING id`,
      [point.id, businessDate, ownerId],
    );
    const [supplier] = await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name)
       VALUES ($1, 'Іван', $2) RETURNING id`,
      [point.id, `Постачальник-${short}`],
    );

    const [intake] = await ds.query(
      `INSERT INTO intakes (code, shift_id, supplier_id, amount, balance_after, received_by_user_id)
       VALUES ($1, $2, $3, $4, '0.00', $5) RETURNING id`,
      [`${short}-IN-1`, shift.id, supplier.id, amount, ownerId],
    );
    // price/bonus are cosmetic — `amount` on the line is what the query reads.
    await ds.query(
      `INSERT INTO intake_items (intake_id, item_order, product_grade_id,
           gross_kg, pallet_kg, tare_weight_kg, net_kg, price, bonus, amount)
       VALUES ($1, 1, $2, $3, '0.00', '0.00', $3, $4, '0.00', $4)`,
      [intake.id, gradeId, netKg, amount],
    );

    if (reweigh) {
      const [reweighHeader] = await ds.query(
        `INSERT INTO reweighs (shift_id) VALUES ($1) RETURNING id`,
        [shift.id],
      );
      await ds.query(
        `INSERT INTO reweigh_items (reweigh_id, item_order, product_grade_id,
             gross_kg, pallet_kg, tare_weight_kg, net_kg, weighed_by_user_id)
         VALUES ($1, 1, $2, $3, '0.00', '0.00', $3, $4)`,
        [reweighHeader.id, gradeId, reweighKg, ownerId],
      );
    }

    if (expenses !== undefined) {
      await ds.query(
        `INSERT INTO day_expenses (shift_id, label, amount, created_by_user_id)
         VALUES ($1, 'Витрати дня', $2, $3)`,
        [shift.id, expenses, ownerId],
      );
    }

    return { pointId: point.id, shiftId: shift.id };
  };

  /** Шипинки: 128 000,00 − 1 600,00 + 1 600,00 + 3 800,00 = 131 800,00 over
   *  790 кг, its own page 166,84. Гайове: 32 550,00 + 1 050,00 = 33 600,00 over
   *  210 кг, its own page 160,00. */
  const seedTwoPoints = async (tag: string, businessDate: string, gradeId: string) => {
    await seedPoint(
      `${tag}-shp`,
      businessDate,
      `Шипинки ${tag}`,
      gradeId,
      '800.00',
      '128000.00',
      true,
      '790.00',
      '3800.00',
    );
    await seedPoint(
      `${tag}-hai`,
      businessDate,
      `Гайове ${tag}`,
      gradeId,
      '210.00',
      '32550.00',
      true,
      '210.00',
      '1050.00',
    );
  };

  it('§8.6 end to end: Σ повна вартість ÷ Σ база кг, never the mean of the points', async () => {
    const tag = randomUUID();
    const businessDate = businessDateFor(tag, '2020-01-');
    const { gradeId } = await seedProduct(`Малина ${tag}`);
    await seedTwoPoints(tag, businessDate, gradeId);

    const out = await service.forDate(actor(), businessDate);
    const raspberry = out.products.find((p) => p.product_name === `Малина ${tag}`)!;
    expect(raspberry).toBeDefined();
    expect(raspberry.reweigh_net_kg).toBe('1000.00');
    expect(raspberry.accrued).toBe('160550.00');
    expect(raspberry.shortfall).toBe('1600.00');
    expect(raspberry.shortfall_share).toBe('1600.00');
    expect(raspberry.expenses_share).toBe('4850.00');
    expect(raspberry.full_cost).toBe('165400.00');
    expect(raspberry.price_cost).toBe('165.40');
    expect(raspberry.price_cost).not.toBe('163.42'); // (166,84 + 160,00) ÷ 2 — the trap

    const shp = raspberry.points.find((p) => p.point_name === `Шипинки ${tag}`)!;
    expect(shp.price_cost).toBe('166.84');
    const hai = raspberry.points.find((p) => p.point_name === `Гайове ${tag}`)!;
    expect(hai.price_cost).toBe('160.00');

    const mine = out.points.filter((p) => p.point_name.endsWith(tag));
    expect(mine.map((p) => p.expenses_amount).sort()).toEqual(['1050.00', '3800.00']);
    expect(out.checks).toEqual({ points_ok: true, total_ok: true });
  });

  it('leaves a point that weighed nothing out of the row — real DB, real null', async () => {
    const tag = randomUUID();
    const businessDate = businessDateFor(tag, '2020-02-');
    const { gradeId } = await seedProduct(`Малина ${tag}`);
    await seedTwoPoints(tag, businessDate, gradeId);
    await seedPoint(
      `${tag}-un`,
      businessDate,
      `Не зважений ${tag}`,
      gradeId,
      '100.00',
      '15000.00',
      false, // accepted, never weighed
      '100.00',
      '500.00',
    );

    const out = await service.forDate(actor(), businessDate);
    const raspberry = out.products.find((p) => p.product_name === `Малина ${tag}`)!;

    const cell = raspberry.points.find((p) => p.point_name === `Не зважений ${tag}`)!;
    expect(cell.complete).toBe(false);
    expect(cell.reweigh_net_kg).toBeNull();
    expect(cell.full_cost).toBeNull();

    // The row is unchanged by its presence; it is reported beside it.
    expect(raspberry.reweigh_net_kg).toBe('1000.00');
    expect(raspberry.price_cost).toBe('165.40');
    expect(raspberry.unweighed).toEqual({ intake_kg: '100.00', accrued: '15000.00' });

    // Its 500,00 of expenses wait for a reweigh: counted, not spread.
    const un = out.points.find((p) => p.point_name === `Не зважений ${tag}`)!;
    expect(un.weighed).toBe(false);
    expect(out.checks?.total_ok).toBe(true);
  });

  /**
   * §3.15 — a point that weighed ONE grade of a product and not the other
   * contributes nothing to the network row: its weighed grade's kilograms and
   * its unweighed grade's «missing» kilograms would both skew the figure.
   */
  it('leaves a partially weighed point out of the row — §3.15', async () => {
    const tag = randomUUID();
    const businessDate = businessDateFor(tag, '2020-03-');
    const { productId, gradeId } = await seedProduct(`Малина ${tag}`);
    const gradeTwo = await seedSecondGrade(productId);
    await seedTwoPoints(tag, businessDate, gradeId);
    await seedPartiallyWeighedPoint(businessDate, `Половина ${tag}`, gradeId, gradeTwo);

    const out = await service.forDate(actor(), businessDate);
    const raspberry = out.products.find((p) => p.product_name === `Малина ${tag}`)!;

    const cell = raspberry.points.find((p) => p.point_name === `Половина ${tag}`)!;
    expect(cell.complete).toBe(false);
    expect(cell.reweigh_net_kg).toBeNull();

    expect(raspberry.reweigh_net_kg).toBe('1000.00');
    expect(raspberry.full_cost).toBe('165400.00');
    expect(raspberry.price_cost).toBe('165.40');
    expect(raspberry.unweighed).toEqual({ intake_kg: '200.00', accrued: '18000.00' });
  });
});

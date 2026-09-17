import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { CostOfDayService } from './cost-of-day.service';
import { Shift } from '../shifts/shift.entity';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { UserRole } from '../users/user-role.enum';

const pointCode = (): string => randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();

/**
 * The acceptance test for the whole reweigh/day-costs slice: §8.4's own worked
 * day, seeded for real and read back through `CostOfDayService`. Two products,
 * one point, a 10 kg shortfall on raspberry and 3 800,00 of day expenses,
 * asserted against every number the client's screen prints —
 *   нараховано 131 900,00 · переважено 854 кг · недостача 1 660,00 ·
 *   витрати 3 800,00 · КОШИК 5 460,00 · на кілограм 6,39 ₴/кг ·
 *   малина 160,00 «було» → 166,39 «собівартість».
 *
 * The ожина fixture below is tuned exactly as the unit spec's is (65,00 кг
 * intake against a 3 900,00 receipt and a 64,00 кг reweigh — 1 кг short at
 * 60,00 ₴/кг) so the published 1 660,00 недостача comes out exact; see that
 * spec's header comment for why 64,80 кг does not.
 */
describe('CostOfDayService.forShift (DB)', () => {
  let ds: DataSource;
  let service: CostOfDayService;
  let ownerId: string;

  const shiftsStub = {
    findOneRaw: async (id: string) => ds.manager.getRepository(Shift).findOne({ where: { id } }),
  };

  beforeAll(async () => {
    ds = await openTestDataSource();
    service = new CostOfDayService(ds, shiftsStub as never);

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

  it('reproduces §8.4 end to end against real Postgres', async () => {
    const tag = randomUUID();
    const short = tag.slice(0, 8).toUpperCase();

    const [point] = await ds.query(
      `INSERT INTO collection_points (name, code, kind) VALUES ($1, $2, 'reception') RETURNING id`,
      [`Точка ${tag}`, pointCode()],
    );
    const [shift] = await ds.query(
      `INSERT INTO shifts (collection_point_id, business_date, status, opened_by_user_id, closed_at, closed_by_user_id)
       VALUES ($1, CURRENT_DATE, 'closed', $2, now(), $2) RETURNING id`,
      [point.id, ownerId],
    );
    const [supplier] = await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name)
       VALUES ($1, 'Іван', $2) RETURNING id`,
      [point.id, `Постачальник-${tag}`],
    );

    const [raspberry] = await ds.query(`INSERT INTO products (name) VALUES ($1) RETURNING id`, [
      `Малина ${tag}`,
    ]);
    const [raspberryGrade] = await ds.query(
      `INSERT INTO product_grades (product_id, name) VALUES ($1, 'Стандарт') RETURNING id`,
      [raspberry.id],
    );
    const [blackberry] = await ds.query(`INSERT INTO products (name) VALUES ($1) RETURNING id`, [
      `Ожина ${tag}`,
    ]);
    const [blackberryGrade] = await ds.query(
      `INSERT INTO product_grades (product_id, name) VALUES ($1, 'Стандарт') RETURNING id`,
      [blackberry.id],
    );

    // Raspberry receipt — 800 кг accepted at 160,00 ₴/кг = 128 000,00.
    const [raspberryIntake] = await ds.query(
      `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id)
       VALUES ($1, $2, $3, '128000.00', $4) RETURNING id`,
      [`${short}-IN-1`, shift.id, supplier.id, ownerId],
    );
    await ds.query(
      `INSERT INTO intake_items (intake_id, item_order, product_grade_id,
           gross_kg, pallet_kg, tare_weight_kg, net_kg, price, bonus, amount)
       VALUES ($1, 1, $2, '800.00', '0.00', '0.00', '800.00', '160.00', '0.00', '128000.00')`,
      [raspberryIntake.id, raspberryGrade.id],
    );

    // Ожина receipt — 65 кг accepted at 60,00 ₴/кг = 3 900,00.
    const [blackberryIntake] = await ds.query(
      `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id)
       VALUES ($1, $2, $3, '3900.00', $4) RETURNING id`,
      [`${short}-IN-2`, shift.id, supplier.id, ownerId],
    );
    await ds.query(
      `INSERT INTO intake_items (intake_id, item_order, product_grade_id,
           gross_kg, pallet_kg, tare_weight_kg, net_kg, price, bonus, amount)
       VALUES ($1, 1, $2, '65.00', '0.00', '0.00', '65.00', '60.00', '0.00', '3900.00')`,
      [blackberryIntake.id, blackberryGrade.id],
    );

    // Reweigh — 10 кг short on raspberry (790 of 800), 1 кг short on ожина
    // (64 of 65).
    const [reweigh] = await ds.query(`INSERT INTO reweighs (shift_id) VALUES ($1) RETURNING id`, [
      shift.id,
    ]);
    await ds.query(
      `INSERT INTO reweigh_items (reweigh_id, item_order, product_grade_id,
           gross_kg, pallet_kg, tare_weight_kg, net_kg, weighed_by_user_id)
       VALUES ($1, 1, $2, '790.00', '0.00', '0.00', '790.00', $3)`,
      [reweigh.id, raspberryGrade.id, ownerId],
    );
    await ds.query(
      `INSERT INTO reweigh_items (reweigh_id, item_order, product_grade_id,
           gross_kg, pallet_kg, tare_weight_kg, net_kg, weighed_by_user_id)
       VALUES ($1, 2, $2, '64.00', '0.00', '0.00', '64.00', $3)`,
      [reweigh.id, blackberryGrade.id, ownerId],
    );

    // Day expenses — 3 800,00 «витрати дня».
    await ds.query(
      `INSERT INTO day_expenses (shift_id, label, amount, created_by_user_id)
       VALUES ($1, 'Витрати дня', '3800.00', $2)`,
      [shift.id, ownerId],
    );

    const out = await service.forShift(actor(), shift.id);

    expect(out.accrued).toBe('131900.00');
    expect(out.reweighed_kg).toBe('854.00');
    expect(out.shortfall_amount).toBe('1660.00');
    expect(out.expenses_amount).toBe('3800.00');
    expect(out.basket).toBe('5460.00');
    expect(out.per_kg).toBe('6.39');
    expect(out.total_check).toBe('135700.00');

    const raspberryOut = out.products.find((p) => p.product_id === raspberry.id);
    expect(raspberryOut?.price_was).toBe('160.00');
    expect(raspberryOut?.price_cost).toBe('166.39');
    expect(raspberryOut?.price_by_our_weight).toBe('162.03');
  });

  /**
   * §3.15 against real Postgres: ONE product, two grades, only сорт 1 on the
   * scale, and an open shift on top so §3.9's caveat is exercised in the
   * same read. Before the fix this shift reported `reweighed_kg '95.00'`,
   * `shortfall_amount '500.00'` and `price_by_our_weight 189.47` — while
   * `GET /shifts/:id/reweigh`, reading the very same rows, called the
   * product «не перезважено» and refused to state a shortfall at all.
   */
  it('§3.15/§3.9: a partially weighed product on an OPEN shift contributes nothing', async () => {
    const tag = randomUUID();
    const short = tag.slice(0, 8).toUpperCase();

    const [point] = await ds.query(
      `INSERT INTO collection_points (name, code, kind) VALUES ($1, $2, 'reception') RETURNING id`,
      [`Точка ${tag}`, pointCode()],
    );
    // OPEN — no closed_at, no closed_by_user_id.
    const [shift] = await ds.query(
      `INSERT INTO shifts (collection_point_id, business_date, status, opened_by_user_id)
       VALUES ($1, CURRENT_DATE, 'open', $2) RETURNING id`,
      [point.id, ownerId],
    );
    const [supplier] = await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name)
       VALUES ($1, 'Іван', $2) RETURNING id`,
      [point.id, `Постачальник-${tag}`],
    );

    const [raspberry] = await ds.query(`INSERT INTO products (name) VALUES ($1) RETURNING id`, [
      `Малина ${tag}`,
    ]);
    const [gradeOne] = await ds.query(
      `INSERT INTO product_grades (product_id, name) VALUES ($1, 'Сорт 1') RETURNING id`,
      [raspberry.id],
    );
    const [gradeTwo] = await ds.query(
      `INSERT INTO product_grades (product_id, name) VALUES ($1, 'Сорт 2') RETURNING id`,
      [raspberry.id],
    );

    const [intake] = await ds.query(
      `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id)
       VALUES ($1, $2, $3, '18000.00', $4) RETURNING id`,
      [`${short}-PW-1`, shift.id, supplier.id, ownerId],
    );
    await ds.query(
      `INSERT INTO intake_items (intake_id, item_order, product_grade_id,
           gross_kg, pallet_kg, tare_weight_kg, net_kg, price, bonus, amount)
       VALUES ($1, 1, $2, '100.00', '0.00', '0.00', '100.00', '100.00', '0.00', '10000.00'),
              ($1, 2, $3, '100.00', '0.00', '0.00', '100.00', '80.00', '0.00', '8000.00')`,
      [intake.id, gradeOne.id, gradeTwo.id],
    );

    const [reweigh] = await ds.query(`INSERT INTO reweighs (shift_id) VALUES ($1) RETURNING id`, [
      shift.id,
    ]);
    await ds.query(
      `INSERT INTO reweigh_items (reweigh_id, item_order, product_grade_id,
           gross_kg, pallet_kg, tare_weight_kg, net_kg, weighed_by_user_id)
       VALUES ($1, 1, $2, '95.00', '0.00', '0.00', '95.00', $3)`,
      [reweigh.id, gradeOne.id, ownerId],
    );

    const out = await service.forShift(actor(), shift.id);

    expect(out.accrued).toBe('18000.00');
    expect(out.reweighed_kg).toBe('0.00');
    expect(out.shortfall_amount).toBe('0.00');
    expect(out.basket).toBe('0.00');
    expect(out.per_kg).toBeNull();

    const product = out.products.find((p) => p.product_id === raspberry.id);
    expect(product?.price_was).toBe('90.00');
    expect(product?.price_by_our_weight).toBeNull();
    expect(product?.price_cost).toBeNull();

    // §3.9 — and the screen can say the day is not finished.
    expect(out.closed_at).toBeNull();
    expect(out.provisional).toBe(true);
  });
});

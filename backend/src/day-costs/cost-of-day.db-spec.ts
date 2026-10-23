import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { CostOfDayService } from './cost-of-day.service';
import { sum } from '../common/money';
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
    // 10 кг short on raspberry, 1 кг on blackberry — the kilograms behind 1 660,00.
    expect(out.products.map((p) => p.shortfall_kg).sort()).toEqual(['1.00', '10.00']);

    const raspberryOut = out.products.find((p) => p.product_id === raspberry.id);
    expect(raspberryOut?.price_was).toBe('160.00');
    expect(raspberryOut?.price_cost).toBe('166.39');
    expect(raspberryOut?.price_by_our_weight).toBe('162.03');

    // §8.4's «жодна гривня не загубилася» — the basket is ALLOCATED across
    // both complete products, not multiplied out per row, so the parts sum
    // back to the basket exactly; `per_kg × kg` per row would not (it drops
    // 2,94 ₴ of this very 5 460,00 basket).
    const blackberryOut = out.products.find((p) => p.product_id === blackberry.id);
    expect(raspberryOut?.basket_share).not.toBeNull();
    expect(blackberryOut?.basket_share).not.toBeNull();
    expect(sum([raspberryOut!.basket_share!, blackberryOut!.basket_share!])).toBe(out.basket);

    // Spec 2026-10-23 — the one-table fields, read back from real rows.
    // На кілограм split into its two halves, which add back up to 6,39.
    expect(out.shortfall_per_kg).toBe('1.94');
    expect(out.expenses_per_kg).toBe('4.45');
    // Each share split into недостача and витрати; повна вартість per product.
    expect(raspberryOut).toMatchObject({
      shortfall_share: '1535.60',
      expenses_share: '3515.22',
      basket_share: '5050.82',
      full_cost: '131450.82',
    });
    expect(blackberryOut).toMatchObject({
      shortfall_share: '124.40',
      expenses_share: '284.78',
      basket_share: '409.18',
      full_cost: '4249.18',
    });
    expect(out.full_cost).toBe('135700.00');
    expect(out.price_cost_avg).toBe('158.90');
    expect(out.weighed).toEqual({
      intake_kg: '865.00',
      shortfall_kg: '11.00',
      accrued: '131900.00',
      shortfall: '1660.00',
    });
    expect(out.unweighed).toEqual({ intake_kg: '0.00', accrued: '0.00' });
    expect(out.checks).toEqual({ shares_ok: true, total_ok: true });
    // No доплати on this day: a real zero, per product and per day.
    expect(out.top_ups_total).toBe('0.00');
    expect(out.products.map((p) => p.top_ups)).toEqual(['0.00', '0.00']);
  });

  /**
   * Гайове, 19.10 — the day the 2026-10-23 three-screens review was checked
   * against on a calculator, seeded for real with its one доплата (15 000,00
   * on a Малина сорт 1 receipt) and a base that re-graded raspberry:
   *
   *   Кизил         15,70 кг ·    596,60 ₴                → base 15,70
   *   Малина сорт 1 333,70 кг · 56 067,20 ₴ + 15 000,00 доплата → base 227,40
   *   Малина сорт 2 263,10 кг · 41 977,00 ₴                → base 368,00
   *   витрати 1 200,00 + 500,00 + 200,00 = 1 900,00
   *
   * Every figure below is one a hand calculator re-derives from figures the
   * screen prints beside it (C1–C4).
   */
  it('reproduces Гайове 19.10 with its доплата — three-screens review C1–C4', async () => {
    const tag = randomUUID();
    const short = tag.slice(0, 8).toUpperCase();

    const [point] = await ds.query(
      `INSERT INTO collection_points (name, code, kind) VALUES ($1, $2, 'reception') RETURNING id`,
      [`Гайове ${tag}`, pointCode()],
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
    const [cornel] = await ds.query(`INSERT INTO products (name) VALUES ($1) RETURNING id`, [
      `Кизил ${tag}`,
    ]);
    const [cornelGrade] = await ds.query(
      `INSERT INTO product_grades (product_id, name) VALUES ($1, 'Сорт 1') RETURNING id`,
      [cornel.id],
    );
    const [raspberry] = await ds.query(`INSERT INTO products (name) VALUES ($1) RETURNING id`, [
      `Малина ${tag}`,
    ]);
    const [raspOne] = await ds.query(
      `INSERT INTO product_grades (product_id, name) VALUES ($1, 'Сорт 1') RETURNING id`,
      [raspberry.id],
    );
    const [raspTwo] = await ds.query(
      `INSERT INTO product_grades (product_id, name) VALUES ($1, 'Сорт 2') RETURNING id`,
      [raspberry.id],
    );

    // One receipt per line, so the доплата lands on сорт 1 alone.
    const receipt = async (n: number, grade: string, kg: string, price: string, amount: string) => {
      const [intake] = await ds.query(
        `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [`${short}-IN-${n}`, shift.id, supplier.id, amount, ownerId],
      );
      await ds.query(
        `INSERT INTO intake_items (intake_id, item_order, product_grade_id,
             gross_kg, pallet_kg, tare_weight_kg, net_kg, price, bonus, amount)
         VALUES ($1, 1, $2, $3, '0.00', '0.00', $3, $4, '0.00', $5)`,
        [intake.id, grade, kg, price, amount],
      );
      return intake.id as string;
    };
    await receipt(1, cornelGrade.id, '15.70', '38.00', '596.60');
    const raspOneIntake = await receipt(2, raspOne.id, '333.70', '168.02', '56067.20');
    await receipt(3, raspTwo.id, '263.10', '159.55', '41977.00');
    await ds.query(
      `INSERT INTO intake_top_ups (intake_id, amount, reason, created_by_user_id)
       VALUES ($1, '15000.00', 'Ціну перерахували', $2)`,
      [raspOneIntake, ownerId],
    );

    const [reweigh] = await ds.query(`INSERT INTO reweighs (shift_id) VALUES ($1) RETURNING id`, [
      shift.id,
    ]);
    await ds.query(
      `INSERT INTO reweigh_items (reweigh_id, item_order, product_grade_id,
           gross_kg, pallet_kg, tare_weight_kg, net_kg, weighed_by_user_id)
       VALUES ($1, 1, $2, '15.70', '0.00', '0.00', '15.70', $5),
              ($1, 2, $3, '227.40', '0.00', '0.00', '227.40', $5),
              ($1, 3, $4, '368.00', '0.00', '0.00', '368.00', $5)`,
      [reweigh.id, cornelGrade.id, raspOne.id, raspTwo.id, ownerId],
    );
    await ds.query(
      `INSERT INTO day_expenses (shift_id, label, amount, created_by_user_id)
       VALUES ($1, 'Приймальник', '1200.00', $2),
              ($1, 'Вантажник', '500.00', $2),
              ($1, 'Інше', '200.00', $2)`,
      [shift.id, ownerId],
    );

    const out = await service.forShift(actor(), shift.id);
    const raspberryOut = out.products.find((p) => p.product_id === raspberry.id)!;
    const cornelOut = out.products.find((p) => p.product_id === cornel.id)!;

    // C3 — the доплата is named, per product, per grade and per day.
    expect(out.top_ups_total).toBe('15000.00');
    expect(raspberryOut.top_ups).toBe('15000.00');
    expect(cornelOut.top_ups).toBe('0.00');
    expect(raspberryOut.grades.map((g) => g.top_ups)).toEqual(['15000.00', '0.00']);

    // C4 — «Ціна закупки: 113 044,20 ÷ 596,80 = 189,42 · Недостача: 1,40 кг ×
    // 189,42 = 265,19 ₴ · Собівартість: 189,42 + 0,43 + 3,11 = 192,96».
    expect(raspberryOut).toMatchObject({
      accrued: '113044.20',
      intake_net_kg: '596.80',
      reweigh_net_kg: '595.40',
      price_was: '189.42',
      shortfall_kg: '1.40',
      shortfall: '265.19',
      price_cost: '192.96',
    });
    expect(cornelOut).toMatchObject({ price_was: '38.00', shortfall: '0.00', price_cost: '41.54' });

    // C1 — each half is its own quotient: 265,19 ÷ 611,10 = 0,43 and
    // 1 900,00 ÷ 611,10 = 3,11; на кілограм is their sum.
    expect(out.reweighed_kg).toBe('611.10');
    expect(out.shortfall_amount).toBe('265.19');
    expect(out.expenses_amount).toBe('1900.00');
    expect(out.shortfall_per_kg).toBe('0.43');
    expect(out.expenses_per_kg).toBe('3.11');
    expect(out.per_kg).toBe('3.54');

    // C2 — sums only in the total row, and the day's formula line:
    // (113 640,80 + 1 900,00) ÷ 611,10 = 189,07.
    expect(out.weighed).toEqual({
      intake_kg: '612.50',
      shortfall_kg: '1.40',
      accrued: '113640.80',
      shortfall: '265.19',
    });
    expect(out.full_cost).toBe('115540.80');
    expect(out.price_cost_avg).toBe('189.07');
    expect(out.checks).toEqual({ shares_ok: true, total_ok: true });
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
    // §3.15 — contributed no kilograms to the denominator, so it collects no
    // share of the basket either: `null`, not a zero.
    expect(product?.basket_share).toBeNull();
    expect(product?.full_cost).toBeNull();
    // Nothing weighed in full: no total row, no звірка — the whole day is
    // reported as unweighed.
    expect(out.weighed).toBeNull();
    expect(out.full_cost).toBeNull();
    expect(out.checks).toBeNull();
    expect(out.unweighed).toEqual({ intake_kg: '200.00', accrued: '18000.00' });

    // §3.9 — and the screen can say the day is not finished.
    expect(out.closed_at).toBeNull();
    expect(out.provisional).toBe(true);
  });
});

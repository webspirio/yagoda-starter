import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { CostOfDayService } from './cost-of-day.service';
import { ReweighReconciliationService } from '../reweighs/reweigh-reconciliation.service';
import { Shift } from '../shifts/shift.entity';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { UserRole } from '../users/user-role.enum';

const pointCode = (): string => randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();

/**
 * НЕДОСТАЧА IS A PRODUCT'S, NOT A GRADE'S (client call 23.10.2026, Гайове, малина).
 *
 * The point accepted 596,8 кг of raspberry in two grades; the base weighed 595,4 кг but put
 * ~105 кг onto the other grade, because the base does not sort by the point's price tiers.
 * Compared grade by grade, that read as 106,3 кг missing in собівартість дня (one grade's
 * surplus clamped away) and as 1 124 ₴ on the reweigh screen (each grade priced at its own
 * rate) for what is 1,4 кг. The shortfall is now taken per PRODUCT and priced at the product's
 * average accrued rate: 1,40 × 189,42 = 265,19. The per-grade split is reconstructed so the
 * totals match the call; the real one is not known.
 */
describe('shortfall by product (DB)', () => {
  let ds: DataSource;
  let ownerId: string;
  const shiftsStub = {
    findOneRaw: async (id: string) => ds.manager.getRepository(Shift).findOne({ where: { id } }),
  };

  beforeAll(async () => {
    ds = await openTestDataSource();
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

  it('a grade mismatch between point and base is not a shortfall', async () => {
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

    // Point: 324,30 кг of сорт 1 (62 634,00) + 272,50 кг of сорт 2 (50 413,00) = 596,80 кг,
    // 113 047,00 ₴ — 189,42 ₴/кг on average.
    const [intake] = await ds.query(
      `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id)
       VALUES ($1, $2, $3, '113047.00', $4) RETURNING id`,
      [`${short}-IN-1`, shift.id, supplier.id, ownerId],
    );
    await ds.query(
      `INSERT INTO intake_items (intake_id, item_order, product_grade_id,
           gross_kg, pallet_kg, tare_weight_kg, net_kg, price, bonus, amount)
       VALUES ($1, 1, $2, '324.30', '0.00', '0.00', '324.30', '193.14', '0.00', '62634.00'),
              ($1, 2, $3, '272.50', '0.00', '0.00', '272.50', '185.00', '0.00', '50413.00')`,
      [intake.id, gradeOne.id, gradeTwo.id],
    );

    // Base: 218,00 кг as сорт 1, 377,40 кг as сорт 2 = 595,40 кг.
    const [reweigh] = await ds.query(`INSERT INTO reweighs (shift_id) VALUES ($1) RETURNING id`, [
      shift.id,
    ]);
    await ds.query(
      `INSERT INTO reweigh_items (reweigh_id, item_order, product_grade_id,
           gross_kg, pallet_kg, tare_weight_kg, net_kg, weighed_by_user_id)
       VALUES ($1, 1, $2, '218.00', '0.00', '0.00', '218.00', $4),
              ($1, 2, $3, '377.40', '0.00', '0.00', '377.40', $4)`,
      [reweigh.id, gradeOne.id, gradeTwo.id, ownerId],
    );

    const reconciliation = await new ReweighReconciliationService(ds, shiftsStub as never).forShift(
      actor(),
      shift.id,
    );
    const product = reconciliation.products.find((p) => p.product_id === raspberry.id);
    expect(product?.missing_kg).toBe('1.40');
    expect(product?.missing_amount).toBe('265.19');

    const cost = await new CostOfDayService(ds, shiftsStub as never).forShift(actor(), shift.id);
    const row = cost.products.find((p) => p.product_id === raspberry.id);
    expect(row?.price_was).toBe('189.42');
    expect(row?.shortfall_kg).toBe('1.40');
    expect(row?.shortfall).toBe('265.19');
    expect(cost.shortfall_amount).toBe('265.19');

    // The breakdown under the row still shows where the base put the berries.
    expect(row?.grades).toEqual([
      {
        product_grade_id: gradeOne.id,
        product_grade_name: 'Сорт 1',
        accrued: '62634.00',
        intake_net_kg: '324.30',
        reweigh_net_kg: '218.00',
        price_was: '193.14',
      },
      {
        product_grade_id: gradeTwo.id,
        product_grade_name: 'Сорт 2',
        accrued: '50413.00',
        intake_net_kg: '272.50',
        reweigh_net_kg: '377.40',
        price_was: '185.00',
      },
    ]);
  });
});

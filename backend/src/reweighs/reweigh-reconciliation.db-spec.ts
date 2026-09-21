import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { ReweighReconciliationService } from './reweigh-reconciliation.service';
import { Shift } from '../shifts/shift.entity';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { UserRole } from '../users/user-role.enum';

const pointCode = (): string => randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();

/**
 * `gradeTotals`'s `LEFT JOIN` against real Postgres — the one case a mocked
 * `dataSource.query` cannot reach, because a mock cannot tell a real `NULL`
 * from a hand-typed `null` in a fixture row. Two grades of one product,
 * intake recorded for both, only one weighed: if the join silently produced
 * `0` for the unweighed grade instead of `NULL`, this product would read as
 * a real (and wrong) shortfall instead of «не перезважено».
 *
 * `shifts` below is a thin DB-backed stand-in for the same reason
 * `reweighs.db-spec.ts` uses one — constructing the real `ShiftsService`
 * pulls in a web of unrelated dependencies this spec has no use for.
 */
describe('ReweighReconciliationService.forShift (DB)', () => {
  let ds: DataSource;
  let service: ReweighReconciliationService;
  let ownerId: string;

  const shiftsStub = {
    findOneRaw: async (id: string) => ds.manager.getRepository(Shift).findOne({ where: { id } }),
  };

  beforeAll(async () => {
    ds = await openTestDataSource();
    service = new ReweighReconciliationService(ds, shiftsStub as never);

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

  it('marks a product with one weighed grade and one unweighed grade as not_reweighed, missing_kg null', async () => {
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
    const [product] = await ds.query(`INSERT INTO products (name) VALUES ($1) RETURNING id`, [
      `Малина ${tag}`,
    ]);
    const [gradeA] = await ds.query(
      `INSERT INTO product_grades (product_id, name) VALUES ($1, $2) RETURNING id`,
      [product.id, `Сорт А ${tag}`],
    );
    const [gradeB] = await ds.query(
      `INSERT INTO product_grades (product_id, name) VALUES ($1, $2) RETURNING id`,
      [product.id, `Сорт Б ${tag}`],
    );

    const [intake] = await ds.query(
      `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id)
       VALUES ($1, $2, $3, '300.00', $4) RETURNING id`,
      [`${short}-IN-1`, shift.id, supplier.id, ownerId],
    );
    // Grade A — accepted and later reweighed.
    await ds.query(
      `INSERT INTO intake_items (intake_id, item_order, product_grade_id,
           gross_kg, pallet_kg, tare_weight_kg, net_kg, price, bonus, amount)
       VALUES ($1, 1, $2, '100.00', '0.00', '0.00', '100.00', '2.00', '0.00', '200.00')`,
      [intake.id, gradeA.id],
    );
    // Grade B — accepted but NEVER reweighed.
    await ds.query(
      `INSERT INTO intake_items (intake_id, item_order, product_grade_id,
           gross_kg, pallet_kg, tare_weight_kg, net_kg, price, bonus, amount)
       VALUES ($1, 2, $2, '50.00', '0.00', '0.00', '50.00', '2.00', '0.00', '100.00')`,
      [intake.id, gradeB.id],
    );

    const [reweigh] = await ds.query(
      `INSERT INTO reweighs (shift_id) VALUES ($1) RETURNING id`,
      [shift.id],
    );
    await ds.query(
      `INSERT INTO reweigh_items (reweigh_id, item_order, product_grade_id,
           gross_kg, pallet_kg, tare_weight_kg, net_kg, weighed_by_user_id)
       VALUES ($1, 1, $2, '95.00', '0.00', '0.00', '95.00', $3)`,
      [reweigh.id, gradeA.id, ownerId],
    );

    const out = await service.forShift(actor(), shift.id);
    const p = out.products.find((row) => row.product_id === product.id);

    expect(p).toBeDefined();
    expect(p?.state).toBe('not_reweighed');
    expect(p?.missing_kg).toBeNull();
    expect(p?.missing_amount).toBeNull();
  });

  /**
   * §5.3's `items` — the non-voided lines, newest first. Not decoration:
   * `POST /reweigh-items/:id/void` needs a line id, and nothing else in the
   * API hands one back after the POST that created it, so without this the
   * §8.7 storno is unreachable from a fresh page load. Asserted against real
   * Postgres because the point of the assertion is that the relations the
   * mapper reads are actually LOADED — a missing `relations` option shows up
   * as `product_name: undefined`, which a mock would never catch.
   */
  it('returns §5.3’s items — non-voided, newest first, names resolved', async () => {
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
    const [product] = await ds.query(`INSERT INTO products (name) VALUES ($1) RETURNING id`, [
      `Малина ${tag}`,
    ]);
    const [grade] = await ds.query(
      `INSERT INTO product_grades (product_id, name) VALUES ($1, $2) RETURNING id`,
      [product.id, `Сорт ${tag}`],
    );
    const [tareType] = await ds.query(
      `INSERT INTO tare_types (name, weight_kg, deposit_price) VALUES ($1, '1.20', '0.00') RETURNING id`,
      [`Чешка ${tag}`],
    );

    const [intake] = await ds.query(
      `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id)
       VALUES ($1, $2, $3, '200.00', $4) RETURNING id`,
      [`${short}-IT-1`, shift.id, supplier.id, ownerId],
    );
    await ds.query(
      `INSERT INTO intake_items (intake_id, item_order, product_grade_id,
           gross_kg, pallet_kg, tare_weight_kg, net_kg, price, bonus, amount)
       VALUES ($1, 1, $2, '100.00', '0.00', '0.00', '100.00', '2.00', '0.00', '200.00')`,
      [intake.id, grade.id],
    );

    const [reweigh] = await ds.query(`INSERT INTO reweighs (shift_id) VALUES ($1) RETURNING id`, [
      shift.id,
    ]);
    const [first] = await ds.query(
      `INSERT INTO reweigh_items (reweigh_id, item_order, product_grade_id,
           gross_kg, pallet_kg, tare_weight_kg, net_kg, weighed_by_user_id, created_at)
       VALUES ($1, 1, $2, '41.20', '0.00', '1.20', '40.00', $3, now() - interval '2 hours') RETURNING id`,
      [reweigh.id, grade.id, ownerId],
    );
    await ds.query(
      `INSERT INTO reweigh_item_tare_types (item_id, tare_type_id, units) VALUES ($1, $2, 1)`,
      [first.id, tareType.id],
    );
    const [second] = await ds.query(
      `INSERT INTO reweigh_items (reweigh_id, item_order, product_grade_id,
           gross_kg, pallet_kg, tare_weight_kg, net_kg, weighed_by_user_id, created_at)
       VALUES ($1, 2, $2, '50.00', '0.00', '0.00', '50.00', $3, now() - interval '1 hour') RETURNING id`,
      [reweigh.id, grade.id, ownerId],
    );
    // Voided — §5.3 says the NON-VOIDED lines, so this one must not appear.
    await ds.query(
      `INSERT INTO reweigh_items (reweigh_id, item_order, product_grade_id,
           gross_kg, pallet_kg, tare_weight_kg, net_kg, weighed_by_user_id,
           voided_at, voided_by_user_id, void_reason)
       VALUES ($1, 3, $2, '9.00', '0.00', '0.00', '9.00', $3, now(), $3, 'переважили не ту партію')`,
      [reweigh.id, grade.id, ownerId],
    );

    const out = await service.forShift(actor(), shift.id);

    expect(out.items.map((i) => i.id)).toEqual([second.id, first.id]);
    expect(out.items[0].net_kg).toBe('50.00');
    expect(out.items[1].product_name).toBe(`Малина ${tag}`);
    expect(out.items[1].product_grade_name).toBe(`Сорт ${tag}`);
    expect(out.items[1].tare).toEqual([
      { tare_type_id: tareType.id, tare_type_name: `Чешка ${tag}`, units: 1 },
    ]);
  });
});

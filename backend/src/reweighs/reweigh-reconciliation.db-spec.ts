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

  /**
   * `gradeTotals`'s `GROUP BY`/`SELECT` changed to carry `pg.name` — exactly
   * the kind of thing a mocked `dataSource.query` cannot see. Two grades of
   * one product, both accepted: `grades[]` must name both, distinctly, all
   * pointing at the same product.
   *
   * The ids are DELIBERATELY INVERTED relative to the names: 'Малина 1' (the
   * alphabetically first name) gets the LARGER uuid, 'Малина 3' the smaller
   * one. `ORDER BY p.name, pg.name` therefore prints ['Малина 1', 'Малина 3']
   * while the old `ORDER BY p.name, pg.id` would deterministically print the
   * reverse — a plain `.sort()`-before-compare (or an unsorted assertion with
   * randomly generated ids) cannot tell the two orderings apart, since id
   * order is random relative to name order about half the time. Do not
   * "simplify" this back to random ids; that reintroduces the flake.
   */
  it('returns one grade row per accepted grade, named, in NAME order', async () => {
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

    // Larger id → 'Малина 1' (alphabetically first), smaller id → 'Малина 3'.
    // See the doc comment above for why this inversion is the point.
    const idOne = randomUUID();
    const idTwo = randomUUID();
    const [biggerId, smallerId] = idOne > idTwo ? [idOne, idTwo] : [idTwo, idOne];
    const [gradeA] = await ds.query(
      `INSERT INTO product_grades (id, product_id, name) VALUES ($1, $2, 'Малина 1') RETURNING id`,
      [biggerId, product.id],
    );
    const [gradeB] = await ds.query(
      `INSERT INTO product_grades (id, product_id, name) VALUES ($1, $2, 'Малина 3') RETURNING id`,
      [smallerId, product.id],
    );

    const [intake] = await ds.query(
      `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id)
       VALUES ($1, $2, $3, '300.00', $4) RETURNING id`,
      [`${short}-GR-1`, shift.id, supplier.id, ownerId],
    );
    await ds.query(
      `INSERT INTO intake_items (intake_id, item_order, product_grade_id,
           gross_kg, pallet_kg, tare_weight_kg, net_kg, price, bonus, amount)
       VALUES ($1, 1, $2, '100.00', '0.00', '0.00', '100.00', '2.00', '0.00', '200.00')`,
      [intake.id, gradeA.id],
    );
    await ds.query(
      `INSERT INTO intake_items (intake_id, item_order, product_grade_id,
           gross_kg, pallet_kg, tare_weight_kg, net_kg, price, bonus, amount)
       VALUES ($1, 2, $2, '50.00', '0.00', '0.00', '50.00', '2.00', '0.00', '100.00')`,
      [intake.id, gradeB.id],
    );

    const res = await service.forShift(actor(), shift.id);

    // Order-sensitive: proves `ORDER BY p.name, pg.name`, not `pg.id`.
    expect(res.grades.map((g) => g.product_grade_name)).toEqual(['Малина 1', 'Малина 3']);
    expect(res.grades.every((g) => g.product_id === product.id)).toBe(true);
  });

  /**
   * The mocked unit spec can only assert the `where` object literal handed
   * to `itemRepo.find` — it cannot show that TypeORM's nested
   * `where: { reweigh: { shift_id } }`, with `voided_at` omitted, actually
   * returns a voided row from real Postgres, or that `voided_at: IsNull()`
   * actually withholds one. This is that proof, plus the requirement the
   * whole task exists for: a voided line must never move `products[]`,
   * whichever way the flag is set.
   */
  it('surfaces a voided line in items[] only when asked, and never moves products[]', async () => {
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

    const [intake] = await ds.query(
      `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id)
       VALUES ($1, $2, $3, '200.00', $4) RETURNING id`,
      [`${short}-IV-1`, shift.id, supplier.id, ownerId],
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
    const [live] = await ds.query(
      `INSERT INTO reweigh_items (reweigh_id, item_order, product_grade_id,
           gross_kg, pallet_kg, tare_weight_kg, net_kg, weighed_by_user_id)
       VALUES ($1, 1, $2, '95.00', '0.00', '0.00', '95.00', $3) RETURNING id`,
      [reweigh.id, grade.id, ownerId],
    );
    const [voided] = await ds.query(
      `INSERT INTO reweigh_items (reweigh_id, item_order, product_grade_id,
           gross_kg, pallet_kg, tare_weight_kg, net_kg, weighed_by_user_id,
           voided_at, voided_by_user_id, void_reason)
       VALUES ($1, 2, $2, '9.00', '0.00', '0.00', '9.00', $3, now(), $3, 'зважили не той сорт')
       RETURNING id`,
      [reweigh.id, grade.id, ownerId],
    );

    const withVoided = await service.forShift(actor(), shift.id, true);
    const withoutVoided = await service.forShift(actor(), shift.id, false);
    const defaulted = await service.forShift(actor(), shift.id);

    // §8.7 — the voided row APPEARS, with its reason and author, when asked.
    expect(withVoided.items.map((i) => i.id).sort()).toEqual([live.id, voided.id].sort());
    const voidedResponse = withVoided.items.find((i) => i.id === voided.id);
    expect(voidedResponse?.voided_at).not.toBeNull();
    expect(voidedResponse?.void_reason).toBe('зважили не той сорт');

    // Omitted and explicit-false both hide it, same as before this task.
    expect(withoutVoided.items.map((i) => i.id)).toEqual([live.id]);
    expect(defaulted.items.map((i) => i.id)).toEqual([live.id]);

    // §3.6/§8.2 — the flag governs items[] alone. products[] is built by
    // `gradeTotals`, which filters `ri.voided_at IS NULL` itself, so the
    // voided 9.00 кг line must never appear in any of these three figures.
    const productRow = (out: typeof withVoided) =>
      out.products.find((row) => row.product_id === product.id);
    expect(productRow(withVoided)).toBeDefined();
    expect(productRow(withVoided)).toEqual(productRow(withoutVoided));
    expect(productRow(withVoided)).toEqual(productRow(defaulted));
  });
});

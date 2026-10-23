import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { ReweighReconciliationService } from './reweigh-reconciliation.service';
import { productCostRows } from '../day-costs/product-cost-rows';
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
      { tare_type_id: tareType.id, tare_type_name: `Чешка ${tag}`, units: 1, unit_weight_kg: '1.20' },
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

  /**
   * §3.4's actual promise: the picker offers exactly what the API enforces.
   *
   * `ReweighsService.acceptedGrades` — the source of `GRADE_NOT_ACCEPTED` — is
   * DERIVED from `gradeTotals`, the same statement behind `grades[]`, so this
   * one assertion covers both halves of that promise. Before they were unified
   * they were two independent statements that agreed only by coincidence; this
   * case is the coincidence made falsifiable.
   *
   * The fixture is the case most likely to break first, and the one a mocked
   * spec cannot reach at all, because it turns on `i.voided_at IS NULL` being
   * evaluated by Postgres: a grade whose ONLY receipt was voided. It was
   * accepted, then it was not. It must vanish from the picker — an owner
   * offered it would be refused at the POST with a rule they were just invited
   * to break.
   */
  it('drops a grade from grades[] once its only intake is voided — the picker and the refusal agree', async () => {
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
    const [kept] = await ds.query(
      `INSERT INTO product_grades (product_id, name) VALUES ($1, $2) RETURNING id`,
      [product.id, `Сорт живий ${tag}`],
    );
    const [orphaned] = await ds.query(
      `INSERT INTO product_grades (product_id, name) VALUES ($1, $2) RETURNING id`,
      [product.id, `Сорт анульований ${tag}`],
    );

    // One live receipt, for `kept`.
    const [live] = await ds.query(
      `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id)
       VALUES ($1, $2, $3, '200.00', $4) RETURNING id`,
      [`${short}-AC-1`, shift.id, supplier.id, ownerId],
    );
    await ds.query(
      `INSERT INTO intake_items (intake_id, item_order, product_grade_id,
           gross_kg, pallet_kg, tare_weight_kg, net_kg, price, bonus, amount)
       VALUES ($1, 1, $2, '100.00', '0.00', '0.00', '100.00', '2.00', '0.00', '200.00')`,
      [live.id, kept.id],
    );

    // One VOIDED receipt, and it is the only place `orphaned` was ever accepted.
    const [voided] = await ds.query(
      `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id,
           voided_at, voided_by_user_id, void_reason)
       VALUES ($1, $2, $3, '100.00', $4, now(), $4, 'помилково') RETURNING id`,
      [`${short}-AC-2`, shift.id, supplier.id, ownerId],
    );
    await ds.query(
      `INSERT INTO intake_items (intake_id, item_order, product_grade_id,
           gross_kg, pallet_kg, tare_weight_kg, net_kg, price, bonus, amount)
       VALUES ($1, 1, $2, '50.00', '0.00', '0.00', '50.00', '2.00', '0.00', '100.00')`,
      [voided.id, orphaned.id],
    );

    const res = await service.forShift(actor(), shift.id);
    const offered = res.grades.map((g) => g.product_grade_id);

    expect(offered).toContain(kept.id);
    expect(offered).not.toContain(orphaned.id);
    // And the grade that survived is the ONLY one — a `grades[]` that leaked
    // the voided receipt's grade would still contain `kept`, so the negative
    // assertion above is the one carrying the weight, and this pins the size.
    expect(offered).toHaveLength(1);
  });
  /** One closed shift with a point, a supplier and an owner-made product. */
  const closedDay = async (tag: string) => {
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
    return { shiftId: shift.id as string, supplierId: supplier.id as string };
  };

  const product = async (name: string, grades: string[]) => {
    const [p] = await ds.query(`INSERT INTO products (name) VALUES ($1) RETURNING id`, [name]);
    const ids: string[] = [];
    for (const g of grades) {
      const [row] = await ds.query(
        `INSERT INTO product_grades (product_id, name) VALUES ($1, $2) RETURNING id`,
        [p.id, g],
      );
      ids.push(row.id);
    }
    return { productId: p.id as string, gradeIds: ids };
  };

  const intakeLine = async (
    intakeId: string,
    order: number,
    gradeId: string,
    netKg: string,
    amount: string,
  ): Promise<string> => {
    const [row] = await ds.query(
      `INSERT INTO intake_items (intake_id, item_order, product_grade_id,
           gross_kg, pallet_kg, tare_weight_kg, net_kg, price, bonus, amount)
       VALUES ($1, $2, $3, $4, '0.00', '0.00', $4, '1.00', '0.00', $5) RETURNING id`,
      [intakeId, order, gradeId, netKg, amount],
    );
    return row.id;
  };

  const reweighLine = async (
    reweighId: string,
    order: number,
    gradeId: string,
    netKg: string,
    voided = false,
  ): Promise<string> => {
    const [row] = await ds.query(
      `INSERT INTO reweigh_items (reweigh_id, item_order, product_grade_id,
           gross_kg, pallet_kg, tare_weight_kg, net_kg, weighed_by_user_id,
           voided_at, voided_by_user_id, void_reason)
       VALUES ($1, $2, $3, $4, '0.00', '0.00', $4, $5,
               ${voided ? "now(), $5, 'не та машина'" : 'NULL, NULL, NULL'}) RETURNING id`,
      [reweighId, order, gradeId, netKg, ownerId],
    );
    return row.id;
  };

  /**
   * Spec 2026-10-23 §0/W2 — Гайове 19.10 reproduced: Малина 333,70 + 263,10 кг
   * at the point for 41 977,00 + 56 067,20 ₴, one 15 000,00 доплата, 227,40 +
   * 368,00 кг at the base. The shortfall is 1,40 кг at 189,42 = 265,19 ₴ —
   * receipts AND доплати — and cost-of-day prints the very same figure. Кизил
   * comes back 2,00 кг heavier and must not offset it in the day's total.
   */
  it('prices a Гайове-style shortfall WITH the доплата, the same as cost-of-day, totals shortfalls only', async () => {
    const tag = randomUUID();
    const short = tag.slice(0, 8).toUpperCase();
    const { shiftId, supplierId } = await closedDay(tag);
    const rasp = await product(`Малина ${tag}`, ['1 сорт', '2 сорт']);
    const cornel = await product(`Кизил ${tag}`, ['1 сорт']);

    const [first] = await ds.query(
      `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id)
       VALUES ($1, $2, $3, '41977.00', $4) RETURNING id`,
      [`${short}-HA-1`, shiftId, supplierId, ownerId],
    );
    await intakeLine(first.id, 1, rasp.gradeIds[0], '333.70', '41977.00');
    const [second] = await ds.query(
      `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id)
       VALUES ($1, $2, $3, '56667.20', $4) RETURNING id`,
      [`${short}-HA-2`, shiftId, supplierId, ownerId],
    );
    await intakeLine(second.id, 1, rasp.gradeIds[1], '263.10', '56067.20');
    await intakeLine(second.id, 2, cornel.gradeIds[0], '15.70', '600.00');
    await ds.query(
      `INSERT INTO intake_top_ups (intake_id, amount, reason, created_by_user_id)
       VALUES ($1, '15000.00', 'доплата', $2)`,
      [first.id, ownerId],
    );
    // A VOIDED доплата never prices anything.
    await ds.query(
      `INSERT INTO intake_top_ups (intake_id, amount, reason, created_by_user_id,
           voided_at, voided_by_user_id, void_reason)
       VALUES ($1, '9999.00', 'помилка', $2, now(), $2, 'помилка')`,
      [first.id, ownerId],
    );

    const [reweigh] = await ds.query(`INSERT INTO reweighs (shift_id) VALUES ($1) RETURNING id`, [
      shiftId,
    ]);
    await reweighLine(reweigh.id, 1, rasp.gradeIds[0], '227.40');
    await reweighLine(reweigh.id, 2, rasp.gradeIds[1], '368.00');
    await reweighLine(reweigh.id, 3, cornel.gradeIds[0], '17.70');

    const out = await service.forShift(actor(), shiftId);
    const raspRow = out.products.find((p) => p.product_id === rasp.productId);
    const cornelRow = out.products.find((p) => p.product_id === cornel.productId);

    expect(raspRow?.missing_kg).toBe('1.40');
    expect(raspRow?.rate).toBe('189.42');
    expect(raspRow?.missing_amount).toBe('265.19');
    expect(cornelRow?.missing_kg).toBe('-2.00');

    // Shortfalls only: Кизил's surplus does not net against Малина.
    expect(out.missing_total_kg).toBe('1.40');
    expect(out.missing_total_amount).toBe('265.19');

    // One price for the shortfall on both screens (spec §0).
    const costRows = await productCostRows(ds, shiftId);
    expect(costRows.find((r) => r.product_id === rasp.productId)?.shortfall).toBe(
      raspRow?.missing_amount,
    );
  });

  /**
   * W5 — tare UNITS point vs base, per grade and per product, from
   * `intake_item_tare_types` / `reweigh_item_tare_types`. A voided receipt's
   * units and a voided reweigh line's units never count, and two tare types
   * stay apart in `by_type`. The 19.10 пересорт shape: 136 crates either side,
   * 34 of them moved from 1 сорт to 2 сорт.
   */
  it('counts crate units point vs base per grade and product, live documents only', async () => {
    const tag = randomUUID();
    const short = tag.slice(0, 8).toUpperCase();
    const { shiftId, supplierId } = await closedDay(tag);
    const rasp = await product(`Малина ${tag}`, ['1 сорт', '2 сорт']);
    const [crate] = await ds.query(
      `INSERT INTO tare_types (name, weight_kg, deposit_price) VALUES ($1, '1.20', '0.00') RETURNING id`,
      [`Ящик ${tag}`],
    );
    const [lub] = await ds.query(
      `INSERT INTO tare_types (name, weight_kg, deposit_price) VALUES ($1, '0.30', '0.00') RETURNING id`,
      [`Лубянка ${tag}`],
    );
    const units = (table: string, itemId: string, tareId: string, n: number) =>
      ds.query(`INSERT INTO ${table} (item_id, tare_type_id, units) VALUES ($1, $2, $3)`, [
        itemId,
        tareId,
        n,
      ]);

    const [live] = await ds.query(
      `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id)
       VALUES ($1, $2, $3, '600.00', $4) RETURNING id`,
      [`${short}-CR-1`, shiftId, supplierId, ownerId],
    );
    const i1 = await intakeLine(live.id, 1, rasp.gradeIds[0], '333.70', '333.70');
    const i2 = await intakeLine(live.id, 2, rasp.gradeIds[1], '263.10', '263.10');
    await units('intake_item_tare_types', i1, crate.id, 82);
    await units('intake_item_tare_types', i2, crate.id, 54);
    await units('intake_item_tare_types', i2, lub.id, 4);

    const [dead] = await ds.query(
      `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id,
           voided_at, voided_by_user_id, void_reason)
       VALUES ($1, $2, $3, '10.00', $4, now(), $4, 'помилково') RETURNING id`,
      [`${short}-CR-2`, shiftId, supplierId, ownerId],
    );
    const iDead = await intakeLine(dead.id, 1, rasp.gradeIds[0], '10.00', '10.00');
    await units('intake_item_tare_types', iDead, crate.id, 500);

    const [reweigh] = await ds.query(`INSERT INTO reweighs (shift_id) VALUES ($1) RETURNING id`, [
      shiftId,
    ]);
    const r1 = await reweighLine(reweigh.id, 1, rasp.gradeIds[0], '227.40');
    const r2 = await reweighLine(reweigh.id, 2, rasp.gradeIds[1], '368.00');
    const rDead = await reweighLine(reweigh.id, 3, rasp.gradeIds[1], '9.00', true);
    await units('reweigh_item_tare_types', r1, crate.id, 48);
    await units('reweigh_item_tare_types', r2, crate.id, 88);
    await units('reweigh_item_tare_types', r2, lub.id, 4);
    await units('reweigh_item_tare_types', rDead, crate.id, 700);

    const out = await service.forShift(actor(), shiftId);
    const byGrade = (id: string) => out.grades.find((g) => g.product_grade_id === id)?.crates;
    expect(byGrade(rasp.gradeIds[0])).toMatchObject({ point: 82, base: 48 });
    expect(byGrade(rasp.gradeIds[1])).toMatchObject({ point: 58, base: 92 });

    const p = out.products.find((row) => row.product_id === rasp.productId);
    expect(p?.crates.point).toBe(140);
    expect(p?.crates.base).toBe(140);
    expect(p?.crates.by_type).toEqual(
      expect.arrayContaining([
        { tare_type_id: crate.id, tare_type_name: `Ящик ${tag}`, point: 136, base: 136 },
        { tare_type_id: lub.id, tare_type_name: `Лубянка ${tag}`, point: 4, base: 4 },
      ]),
    );
    expect(p?.crates.by_type).toHaveLength(2);
  });
});

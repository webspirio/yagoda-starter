import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { NetworkAverageService } from './network-average.service';
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
 * §8.6's acceptance test, seeded for real: the client's own worked table —
 * Шипинки 790 кг / 126 400,00 ₴, Гайове 210 кг / 32 550,00 ₴, one shared
 * raspberry product/grade (the real catalog is global across points, so both
 * points' receipts must reference the SAME `product_grades` row for the
 * network-average query to have anything to sum) — read back through the
 * ACTUAL `network-average` SQL (`shifts` ⋈ `collection_points`, then
 * `productCostRows`'s `intake_items`/`reweigh_items`/`intake_top_ups`
 * joins), not the `DataSource.query` mock the unit spec uses. That mock
 * proves the arithmetic on top of the rows; it cannot prove the query
 * itself parses, joins correctly, or returns what the code expects — this
 * spec is what proves that, the same way `cost-of-day.db-spec.ts` does for
 * §8.4.
 */
describe('NetworkAverageService.forDate (DB)', () => {
  let ds: DataSource;
  let service: NetworkAverageService;
  let ownerId: string;

  beforeAll(async () => {
    ds = await openTestDataSource();
    service = new NetworkAverageService(ds);

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

  /** One point's shift with a single receipt against `gradeId`, reweighed in
   *  full (so сума = accrued exactly, no shortfall) — the simplest fixture
   *  that still exercises the real query end to end. Pass `reweigh: false`
   *  to leave the intake unweighed. */
  const seedPoint = async (
    tag: string,
    businessDate: string,
    pointName: string,
    gradeId: string,
    netKg: string,
    amount: string,
    reweigh: boolean,
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
      `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
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
        [reweighHeader.id, gradeId, netKg, ownerId],
      );
    }

    return { pointId: point.id, shiftId: shift.id };
  };

  it('§8.6 end to end: sums then divides, matches the client’s worked table', async () => {
    const tag = randomUUID();
    const businessDate = businessDateFor(tag, '2020-01-');
    const { gradeId } = await seedProduct(`Малина ${tag}`);

    await seedPoint(`${tag}-shp`, businessDate, `Шипинки ${tag}`, gradeId, '790.00', '126400.00', true);
    await seedPoint(`${tag}-hai`, businessDate, `Гайове ${tag}`, gradeId, '210.00', '32550.00', true);

    const out = await service.forDate(actor(), businessDate);
    const raspberry = out.products.find((p) => p.product_name === `Малина ${tag}`);
    expect(raspberry).toBeDefined();
    expect(raspberry!.total_kg).toBe('1000.00');
    expect(raspberry!.total_amount).toBe('158950.00');
    expect(raspberry!.average_price).toBe('158.95');
    expect(raspberry!.average_price).not.toBe('157.50'); // (160,00 + 155,00) ÷ 2 — the trap

    const shypynky = raspberry!.points.find((p) => p.point_name === `Шипинки ${tag}`);
    expect(shypynky?.weight_kg).toBe('790.00');
    expect(shypynky?.amount).toBe('126400.00');
    const haiove = raspberry!.points.find((p) => p.point_name === `Гайове ${tag}`);
    expect(haiove?.weight_kg).toBe('210.00');
    expect(haiove?.amount).toBe('32550.00');
  });

  it('excludes a point that accepted raspberry but has weighed nothing — real DB, real null', async () => {
    const tag = randomUUID();
    const businessDate = businessDateFor(tag, '2020-02-');
    const { gradeId } = await seedProduct(`Малина ${tag}`);

    await seedPoint(`${tag}-shp`, businessDate, `Шипинки ${tag}`, gradeId, '790.00', '126400.00', true);
    await seedPoint(`${tag}-hai`, businessDate, `Гайове ${tag}`, gradeId, '210.00', '32550.00', true);
    await seedPoint(
      `${tag}-un`,
      businessDate,
      `Не зважений ${tag}`,
      gradeId,
      '100.00',
      '15000.00',
      false, // accepted, never weighed
    );

    const out = await service.forDate(actor(), businessDate);
    const raspberry = out.products.find((p) => p.product_name === `Малина ${tag}`);
    expect(raspberry).toBeDefined();

    // The третій point's cell is present (it DID accept the product) but
    // null — real Postgres, real absent reweigh row, not a mocked '0.00'.
    const cell = raspberry!.points.find((p) => p.point_name === `Не зважений ${tag}`);
    expect(cell).toBeDefined();
    expect(cell?.weight_kg).toBeNull();
    expect(cell?.amount).toBeNull();

    // The sums are UNCHANGED by the unweighed point's presence — it entered
    // neither sum.
    expect(raspberry!.total_kg).toBe('1000.00');
    expect(raspberry!.total_amount).toBe('158950.00');
    expect(raspberry!.average_price).toBe('158.95');
  });
});

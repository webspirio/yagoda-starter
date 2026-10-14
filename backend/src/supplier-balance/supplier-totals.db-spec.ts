import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { ListSupplierTotalsQuery } from './queries/list-supplier-totals.query';
import { SupplierBalanceBreakdownQuery } from './queries/supplier-balance-breakdown.query';
import { ListSupplierTotalsQueryDto } from './dto/list-supplier-totals.query';
import { Supplier } from '../suppliers/supplier.entity';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * `/supplier-totals`'s SQL against a real Postgres — the unit spec can only
 * assert the builder calls. Point A, products Малина (two grades) and Полуниця:
 *
 *   Іван    R1 live: Малина-1 300 + Малина-2 250 kg, 5500.00, live top-up 150
 *           R2 live: Полуниця 400 kg, 4000.00, VOIDED top-up 70
 *           R3 VOIDED: Полуниця 1000 kg, 99999.00, live top-up 999
 *             → 950.00 kg · 9650.00 · Малина (by product, not grade)
 *   Ольга   Малина-1 100 kg, 3000.00          → 100.00 · 3000.00 · Малина
 *   Марія   Полуниця 30 + Малина-1 30 kg, 600  → 60.00 · 600.00 · Малина (tie → name)
 *   Андрій  Полуниця 9.50 kg, 95.00            → 9.50 — sorts BELOW 100 (numeric, not text)
 *   Петро   nothing                            → 0.00 · 0.00 · null
 *   Степан  INACTIVE, 10 kg                    → absent
 *   Ольга²  second «Ольга Ярема» at A, nothing → same name, told apart by id
 * Point B: Богдан 500 kg — an operator at A never sees him.
 */
describe('ListSupplierTotalsQuery.list (Postgres)', () => {
  let ds: DataSource;
  let service: ListSupplierTotalsQuery;
  let breakdown: SupplierBalanceBreakdownQuery;
  let run: string;
  let pointA: string;
  let pointB: string;
  let userId: string;
  let shiftA: string;
  let ivanId: string;
  let raspberry1: string;
  let raspberry2: string;
  let strawberry: string;
  let operatorAtA: AuthenticatedUser;
  const owner: AuthenticatedUser = {
    sub: 'u-owner',
    username: 'owner',
    role: UserRole.NetworkOwner,
    collection_point_id: null,
  };
  const q = (over: Partial<ListSupplierTotalsQueryDto> = {}): ListSupplierTotalsQueryDto =>
    ({ page: 1, limit: 100, sort: 'weight', collection_point_id: pointA, ...over }) as ListSupplierTotalsQueryDto;

  let seq = 0;
  const insertSupplier = async (point: string, first: string, last: string, active = true) => {
    const [row] = await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name, is_active)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [point, first, `${last}-${run}`, active],
    );
    return row.id as string;
  };
  /** One receipt with its lines; `lines` is [grade, net kg]. Amount is given, not derived — the SQL under test only sums it. */
  const insertIntake = async (
    shift: string,
    supplier: string,
    amount: string,
    lines: [string, string][],
    voided = false,
  ): Promise<string> => {
    const [intake] = await ds.query(
      `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id,
                            voided_at, voided_by_user_id, void_reason)
       VALUES ($1, $2, $3, $4, $5,
               CASE WHEN $6 THEN now() END, CASE WHEN $6 THEN $5::uuid END,
               CASE WHEN $6 THEN 'test' END) RETURNING id`,
      [`IN-${run}-${++seq}`, shift, supplier, amount, userId, voided],
    );
    for (const [i, [grade, kg]] of lines.entries()) {
      await ds.query(
        `INSERT INTO intake_items (intake_id, item_order, product_grade_id,
             gross_kg, pallet_kg, tare_weight_kg, net_kg, price, bonus, amount)
         VALUES ($1, $2, $3, $4, '0.00', '0.00', $4, '0.00', '0.00', '0.00')`,
        [intake.id, i + 1, grade, kg],
      );
    }
    return intake.id as string;
  };
  const insertTopUp = async (intake: string, amount: string, voided = false) => {
    await ds.query(
      `INSERT INTO intake_top_ups (intake_id, amount, reason, created_by_user_id,
                                   voided_at, voided_by_user_id, void_reason)
       VALUES ($1, $2, 'test', $3,
               CASE WHEN $4 THEN now() END, CASE WHEN $4 THEN $3::uuid END,
               CASE WHEN $4 THEN 'test' END)`,
      [intake, amount, userId, voided],
    );
  };

  beforeAll(async () => {
    ds = await openTestDataSource();
    service = new ListSupplierTotalsQuery(ds.getRepository(Supplier));
    breakdown = new SupplierBalanceBreakdownQuery(ds);
    run = randomUUID();
    const short = run.slice(0, 4).toUpperCase();

    const [a] = await ds.query(
      `INSERT INTO collection_points (name, kind, code) VALUES ($1, 'reception', $2) RETURNING id`,
      [`Підсумки А-${run}`, `A${short}`],
    );
    const [b] = await ds.query(
      `INSERT INTO collection_points (name, kind, code) VALUES ($1, 'reception', $2) RETURNING id`,
      [`Підсумки Б-${run}`, `B${short}`],
    );
    pointA = a.id;
    pointB = b.id;
    operatorAtA = { sub: 'u-op', username: 'op', role: UserRole.PointOperator, collection_point_id: pointA };

    const [user] = await ds.query(
      `INSERT INTO users (first_name, last_name, role) VALUES ('Оксана', 'Тест', 'network_owner') RETURNING id`,
    );
    userId = user.id;
    const [sa] = await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date)
       VALUES ($1, $2, '2026-09-08') RETURNING id`,
      [pointA, userId],
    );
    const [sb] = await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date)
       VALUES ($1, $2, '2026-09-08') RETURNING id`,
      [pointB, userId],
    );
    shiftA = sa.id;

    const [rasp] = await ds.query(`INSERT INTO products (name) VALUES ($1) RETURNING id`, [`Малина ${run}`]);
    const [straw] = await ds.query(`INSERT INTO products (name) VALUES ($1) RETURNING id`, [`Полуниця ${run}`]);
    const grade = async (product: string, name: string) =>
      (
        await ds.query(`INSERT INTO product_grades (product_id, name) VALUES ($1, $2) RETURNING id`, [
          product,
          name,
        ])
      )[0].id as string;
    raspberry1 = await grade(rasp.id, 'Перший');
    raspberry2 = await grade(rasp.id, 'Другий');
    strawberry = await grade(straw.id, 'Стандарт');

    ivanId = await insertSupplier(pointA, 'Іван', 'Коваль');
    const r1 = await insertIntake(shiftA, ivanId, '5500.00', [[raspberry1, '300.00'], [raspberry2, '250.00']]);
    await insertTopUp(r1, '150.00');
    const r2 = await insertIntake(shiftA, ivanId, '4000.00', [[strawberry, '400.00']]);
    await insertTopUp(r2, '70.00', true);
    const r3 = await insertIntake(shiftA, ivanId, '99999.00', [[strawberry, '1000.00']], true);
    await insertTopUp(r3, '999.00');

    const olha = await insertSupplier(pointA, 'Ольга', 'Ярема');
    await insertIntake(shiftA, olha, '3000.00', [[raspberry1, '100.00']]);
    const maria = await insertSupplier(pointA, 'Марія', 'Бондар');
    await insertIntake(shiftA, maria, '600.00', [[strawberry, '30.00'], [raspberry1, '30.00']]);
    const andriy = await insertSupplier(pointA, 'Андрій', 'Шевчук');
    await insertIntake(shiftA, andriy, '95.00', [[strawberry, '9.50']]);
    await insertSupplier(pointA, 'Петро', 'Мельник');
    await insertSupplier(pointA, 'Ольга', 'Ярема');
    const stepan = await insertSupplier(pointA, 'Степан', 'Гнатюк', false);
    await insertIntake(shiftA, stepan, '100.00', [[strawberry, '10.00']]);

    const bohdan = await insertSupplier(pointB, 'Богдан', 'Сусід');
    await insertIntake(sb.id, bohdan, '5000.00', [[strawberry, '500.00']]);
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  const row = <T extends { id: string }>(page: { data: T[] }, id: string) => page.data.find((r) => r.id === id);
  const names = (page: { data: { first_name: string }[] }) => page.data.map((r) => r.first_name);

  it('sums live weight, accrues receipts plus live top-ups on live receipts, and names the main PRODUCT', async () => {
    const page = await service.list(owner, q());
    expect(row(page, ivanId)).toMatchObject({
      kg_total: '950.00',
      accrued: '9650.00',
      main_product_name: `Малина ${run}`,
    });
  });

  it('breaks a main-product tie by name', async () => {
    const page = await service.list(owner, q());
    expect(page.data.find((r) => r.first_name === 'Марія')?.main_product_name).toBe(`Малина ${run}`);
  });

  it('reads 0.00 / 0.00 / null for a supplier with no receipts', async () => {
    const page = await service.list(owner, q());
    expect(page.data.find((r) => r.first_name === 'Петро')).toMatchObject({
      kg_total: '0.00',
      accrued: '0.00',
      main_product_name: null,
    });
  });

  it('orders weight numerically, heaviest first — 9.50 below 100.00 — and leaves inactive suppliers out', async () => {
    const page = await service.list(owner, q());
    expect(names(page)).toEqual(['Іван', 'Ольга', 'Марія', 'Андрій', 'Петро', 'Ольга']);
    expect(page.total).toBe(6);
  });

  it('orders by accrued ascending on request', async () => {
    const page = await service.list(owner, q({ sort: 'amount', order: 'asc' }));
    expect(names(page).slice(0, 4)).toEqual(['Петро', 'Ольга', 'Андрій', 'Марія']);
  });

  it('narrows page AND total by q while keeping the sort', async () => {
    const page = await service.list(owner, q({ q: 'Ярема' }));
    expect(page.total).toBe(2);
    expect(page.data.map((r) => r.kg_total)).toEqual(['100.00', '0.00']);
  });

  it('walks pages of 2 with no row repeated or dropped, same-named people included', async () => {
    const all = await service.list(owner, q());
    const walked: string[] = [];
    for (let p = 1; p <= 3; p++) {
      walked.push(...(await service.list(owner, q({ page: p, limit: 2 }))).data.map((r) => r.id));
    }
    expect(walked).toEqual(all.data.map((r) => r.id));
  });

  it('keeps an operator to their own point', async () => {
    const page = await service.list(operatorAtA, q({ collection_point_id: pointB }));
    expect(names(page)).not.toContain('Богдан');
    expect(page.total).toBe(6);
  });

  it('agrees with the supplier card on kg_total', async () => {
    const page = await service.list(owner, q());
    const card = await breakdown.breakdownFor(ivanId);
    expect(row(page, ivanId)?.kg_total).toBe(card.kg_total);
  });
});

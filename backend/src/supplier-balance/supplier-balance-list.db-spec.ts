import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { SupplierBalanceService } from './supplier-balance.service';
import { ListSupplierBalancesQueryDto } from './dto/list-supplier-balances.query';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * `GET /supplier-balances` against a real Postgres, through the service and
 * not the route: what is under test is the SQL — a correlated `SUM` over two
 * tables, filtered, ordered and paginated in the database — and the unit spec
 * can only assert the text of it. Every fixture carries a per-run uuid: the
 * throwaway database persists between runs and nothing here truncates.
 *
 * Point A holds six suppliers chosen so each rule has a row that would fail
 * without it:
 *
 *   Іван      100 + 50(voided) intakes, 30 + 20(voided) payouts → 70.00
 *   Андрій    40 intake                                          → 40.00
 *   Ольга     40 intake, DEACTIVATED                             → 40.00
 *   Степан    25 intake VOIDED, 25 payout                        → −25.00
 *   Марія     10 intake, 10 payout                               → 0.00
 *   Петро     nothing                                            → 0.00
 *
 * Point B holds one supplier with 500.00, for the scope tests.
 */
describe('SupplierBalanceService.list (Postgres)', () => {
  let ds: DataSource;
  let service: SupplierBalanceService;
  let run: string;
  let pointA: string;
  let pointB: string;
  let userId: string;
  let bohdanId: string;

  const owner: AuthenticatedUser = {
    sub: 'u-owner',
    username: 'owner',
    role: UserRole.NetworkOwner,
    collection_point_id: null,
  };
  let operatorAtA: AuthenticatedUser;

  const query = (
    over: Partial<ListSupplierBalancesQueryDto> = {},
  ): ListSupplierBalancesQueryDto => ({
    page: 1,
    limit: 20,
    include_zero: false,
    ...over,
  });

  const insertSupplier = async (
    point: string,
    first: string,
    last: string,
    active = true,
  ): Promise<string> => {
    const [row] = await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name, is_active)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [point, first, `${last}-${run}`, active],
    );
    return row.id as string;
  };

  let seq = 0;
  const insertIntake = async (shift: string, supplier: string, amount: string, voided = false) => {
    await ds.query(
      `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id,
                            voided_at, voided_by_user_id, void_reason)
       VALUES ($1, $2, $3, $4, $5,
               CASE WHEN $6 THEN now() END, CASE WHEN $6 THEN $5::uuid END,
               CASE WHEN $6 THEN 'test' END)`,
      [`IN-${run}-${++seq}`, shift, supplier, amount, userId, voided],
    );
  };
  const insertPayout = async (shift: string, supplier: string, amount: string, voided = false) => {
    await ds.query(
      `INSERT INTO payouts (code, shift_id, supplier_id, amount, paid_by_user_id,
                            voided_at, voided_by_user_id, void_reason)
       VALUES ($1, $2, $3, $4, $5,
               CASE WHEN $6 THEN now() END, CASE WHEN $6 THEN $5::uuid END,
               CASE WHEN $6 THEN 'test' END)`,
      [`PO-${run}-${++seq}`, shift, supplier, amount, userId, voided],
    );
  };

  beforeAll(async () => {
    ds = await openTestDataSource();
    service = new SupplierBalanceService(ds);
    run = randomUUID();
    const short = run.slice(0, 4).toUpperCase();

    const [a] = await ds.query(
      `INSERT INTO collection_points (name, kind, code) VALUES ($1, 'reception', $2) RETURNING id`,
      [`Залишки А-${run}`, `A${short}`],
    );
    const [b] = await ds.query(
      `INSERT INTO collection_points (name, kind, code) VALUES ($1, 'reception', $2) RETURNING id`,
      [`Залишки Б-${run}`, `B${short}`],
    );
    pointA = a.id;
    pointB = b.id;
    operatorAtA = {
      sub: 'u-oksana',
      username: 'oksana',
      role: UserRole.PointOperator,
      collection_point_id: pointA,
    };

    const [user] = await ds.query(
      `INSERT INTO users (first_name, last_name, role)
       VALUES ('Оксана', 'Приймальник', 'network_owner') RETURNING id`,
    );
    userId = user.id;

    const [shiftA] = await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date)
       VALUES ($1, $2, '2026-09-08') RETURNING id`,
      [pointA, userId],
    );
    const [shiftB] = await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date)
       VALUES ($1, $2, '2026-09-08') RETURNING id`,
      [pointB, userId],
    );

    const ivan = await insertSupplier(pointA, 'Іван', 'Коваль');
    await insertIntake(shiftA.id, ivan, '100.00');
    await insertIntake(shiftA.id, ivan, '50.00', true);
    await insertPayout(shiftA.id, ivan, '30.00');
    await insertPayout(shiftA.id, ivan, '20.00', true);

    const andriy = await insertSupplier(pointA, 'Андрій', 'Бондар');
    await insertIntake(shiftA.id, andriy, '40.00');

    const olha = await insertSupplier(pointA, 'Ольга', 'Ярема', false);
    await insertIntake(shiftA.id, olha, '40.00');

    const stepan = await insertSupplier(pointA, 'Степан', 'Мороз');
    await insertIntake(shiftA.id, stepan, '25.00', true);
    await insertPayout(shiftA.id, stepan, '25.00');

    const maria = await insertSupplier(pointA, 'Марія', 'Литвин');
    await insertIntake(shiftA.id, maria, '10.00');
    await insertPayout(shiftA.id, maria, '10.00');

    await insertSupplier(pointA, 'Петро', 'Мельник');

    bohdanId = await insertSupplier(pointB, 'Богдан', 'Сусід');
    await insertIntake(shiftB.id, bohdanId, '500.00');
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  const names = (page: { data: { first_name: string }[] }) => page.data.map((r) => r.first_name);

  it('shows Σ intakes − Σ payouts per supplier, with voided rows out of BOTH halves', async () => {
    const page = await service.list(owner, query({ collection_point_id: pointA }));

    const ivan = page.data.find((r) => r.first_name === 'Іван');
    // 100 (not 150) − 30 (not 50). Either voided row counted gives a different number.
    expect(ivan?.debt).toBe('70.00');
    expect(typeof ivan?.debt).toBe('string');
    expect(ivan?.collection_point_id).toBe(pointA);
  });

  it('hides zero balances by default — never delivered and fully paid alike', async () => {
    const page = await service.list(owner, query({ collection_point_id: pointA }));

    expect(names(page)).not.toContain('Петро');
    expect(names(page)).not.toContain('Марія');
    expect(page.total).toBe(4);
  });

  it('lists a DEACTIVATED supplier who is still owed money', async () => {
    // A person owed money must not vanish from the debts list because their
    // card was deactivated.
    const page = await service.list(owner, query({ collection_point_id: pointA }));

    const olha = page.data.find((r) => r.first_name === 'Ольга');
    expect(olha?.debt).toBe('40.00');
    expect(olha?.is_active).toBe(false);
  });

  it('shows every supplier at the point with include_zero', async () => {
    const page = await service.list(
      owner,
      query({ collection_point_id: pointA, include_zero: true }),
    );

    expect(page.total).toBe(6);
    expect(page.data.find((r) => r.first_name === 'Петро')?.debt).toBe('0.00');
    expect(page.data.find((r) => r.first_name === 'Марія')?.debt).toBe('0.00');
  });

  it('orders by debt DESC, then last name, first name, id', async () => {
    const page = await service.list(owner, query({ collection_point_id: pointA }));

    // Андрій Бондар and Ольга Ярема tie at 40.00 and fall to the name order;
    // Степан's negative balance is real and sorts last, not clamped away.
    expect(names(page)).toEqual(['Іван', 'Андрій', 'Ольга', 'Степан']);
    expect(page.data.map((r) => r.debt)).toEqual(['70.00', '40.00', '40.00', '-25.00']);
  });

  it('paginates in SQL with the total held across pages', async () => {
    const first = await service.list(owner, query({ collection_point_id: pointA, limit: 3 }));
    const second = await service.list(
      owner,
      query({ collection_point_id: pointA, limit: 3, page: 2 }),
    );
    const third = await service.list(
      owner,
      query({ collection_point_id: pointA, limit: 3, page: 3 }),
    );

    expect(first).toMatchObject({ total: 4, page: 1, limit: 3 });
    expect(names(first)).toEqual(['Іван', 'Андрій', 'Ольга']);
    expect(second).toMatchObject({ total: 4, page: 2, limit: 3 });
    expect(names(second)).toEqual(['Степан']);
    expect(third).toMatchObject({ total: 4, page: 3, limit: 3, data: [] });
  });

  it('pins an operator to their own point even when they name another', async () => {
    const page = await service.list(operatorAtA, query({ collection_point_id: pointB }));

    expect(page.total).toBe(4);
    expect(page.data.every((r) => r.collection_point_id === pointA)).toBe(true);
    expect(names(page)).not.toContain('Богдан');
  });

  it('lets the owner filter to one point, and see all points without a filter', async () => {
    const b = await service.list(owner, query({ collection_point_id: pointB }));
    expect(b.total).toBe(1);
    expect(b.data[0]).toMatchObject({
      supplier_id: bohdanId,
      first_name: 'Богдан',
      debt: '500.00',
    });

    // Unfiltered: the whole persisted database, so only a lower bound is knowable.
    const all = await service.list(owner, query({ limit: 1 }));
    expect(all.total).toBeGreaterThanOrEqual(4 + 1);
  });
});

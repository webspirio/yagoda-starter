import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { AllocationsService } from './services/allocations';
import { ListSupplierBalancesQuery } from './queries/list-supplier-balances.query';
import { ListSupplierBalancesQueryDto } from './dto/list-supplier-balances.query';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * «Найстаріший залишок» (#101) against a real Postgres: each row's `oldest_open_date` and the
 * envelope's. Every payout goes through `AllocationsService.allocate`, as every real write path
 * does, so «open» here is read off STORED allocations — the fixture cannot agree with the query
 * by accident. One point, eight suppliers, one rule each:
 *
 *   Ганна   07-01 100, 07-05 50; payout 120 → 07-01 closed, 07-05 open 30  → 2026-07-05
 *   Василь  07-03 40 paid in full, then a 10 top-up on it; 07-10 25        → 2026-07-03
 *   Зіна    07-02 60 VOIDED; 07-08 15                                      → 2026-07-08
 *   Ніна    07-04 50 paid in full, then the payout VOIDED (rows released)  → 2026-07-04
 *   Тарас   07-02 40 paid, a 10 top-up on it VOIDED; 07-10 20              → 2026-07-10
 *   Олег    07-01 30 + a 5 top-up, the receipt VOIDED; 07-08 12            → 2026-07-08
 *   Марко   07-04 30, payout 30                                            → null (zero, hidden)
 *   Лука    payout 20, nothing delivered                                   → null (−20.00)
 *
 * Ніна, Тарас and Олег each pin one `voided_at IS NULL` filter of the expression: on the
 * allocation, on the top-up, on the top-up's parent receipt.
 *
 * Point-level, among rows owed money: Василь's 07-03 — not Зіна's voided 07-02, not Ганна's
 * fully paid 07-01.
 */
describe('ListSupplierBalancesQuery — oldest open date (Postgres, #101)', () => {
  let ds: DataSource;
  let service: ListSupplierBalancesQuery;
  let run: string;
  let point: string;
  let userId: string;
  const shiftOn = new Map<string, string>();
  const alloc = new AllocationsService();
  let seq = 0;

  const owner: AuthenticatedUser = {
    sub: 'u-owner',
    username: 'owner',
    role: UserRole.NetworkOwner,
    collection_point_id: null,
  };
  const query = (
    over: Partial<ListSupplierBalancesQueryDto> = {},
  ): ListSupplierBalancesQueryDto => ({
    page: 1,
    limit: 20,
    include_zero: false,
    collection_point_id: point,
    ...over,
  });

  const supplier = async (first: string): Promise<string> => {
    const [row] = await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name)
       VALUES ($1, $2, $3) RETURNING id`,
      [point, first, `Найстаріший-${run}`],
    );
    return row.id as string;
  };

  /** One write event, as the commands run it: supplier lock, the write, one allocate. */
  const event = <T>(s: string, write: (m: EntityManager) => Promise<T>): Promise<T> =>
    ds.transaction(async (m) => {
      await alloc.lockSupplier(m, s);
      const out = await write(m);
      await alloc.allocate(m, s);
      return out;
    });

  const intake = (s: string, date: string, amount: string, voided = false): Promise<string> =>
    event(s, async (m) => {
      const [row] = await m.query(
        `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id,
                              created_at, voided_at, voided_by_user_id, void_reason)
         VALUES ($1, $2, $3, $4, $5, clock_timestamp(),
                 CASE WHEN $6 THEN now() END, CASE WHEN $6 THEN $5::uuid END,
                 CASE WHEN $6 THEN 'test' END)
         RETURNING id`,
        [`OO-IN-${run}-${++seq}`, shiftOn.get(date), s, amount, userId, voided],
      );
      return row.id as string;
    });

  const payout = (s: string, date: string, amount: string) =>
    event(s, async (m) => {
      const [row] = await m.query(
        `INSERT INTO payouts (code, shift_id, supplier_id, amount, paid_by_user_id,
                              created_at, balance_after)
         VALUES ($1, $2, $3, $4, $5, clock_timestamp(), '0.00') RETURNING id`,
        [`OO-PO-${run}-${++seq}`, shiftOn.get(date), s, amount, userId],
      );
      return row.id as string;
    });

  const topUp = (s: string, intakeId: string, amount: string) =>
    event(s, async (m) => {
      const [row] = await m.query(
        `INSERT INTO intake_top_ups (intake_id, amount, reason, created_by_user_id)
         VALUES ($1, $2, 'доплата за спеціальною ціною', $3) RETURNING id`,
        [intakeId, amount, userId],
      );
      return row.id as string;
    });

  /** A void as the commands run it: release the document's live rows, stamp it, re-allocate. */
  const voidDoc = (
    s: string,
    table: 'intakes' | 'payouts' | 'intake_top_ups',
    target: Parameters<AllocationsService['release']>[1],
    id: string,
  ) =>
    event(s, async (m) => {
      await alloc.release(m, target);
      await m.query(
        `UPDATE ${table} SET voided_at = now(), voided_by_user_id = $2, void_reason = 'test'
          WHERE id = $1`,
        [id, userId],
      );
    });

  beforeAll(async () => {
    ds = await openTestDataSource();
    service = new ListSupplierBalancesQuery(ds);
    run = randomUUID().slice(0, 8);

    const [p] = await ds.query(
      `INSERT INTO collection_points (name, kind, code) VALUES ($1, 'reception', $2) RETURNING id`,
      [`Найстаріший-${run}`, `O${run.slice(0, 4).toUpperCase()}`],
    );
    point = p.id;
    const [user] = await ds.query(
      `INSERT INTO users (first_name, last_name, role)
       VALUES ('Оксана', 'Приймальник', 'network_owner') RETURNING id`,
    );
    userId = user.id;

    // CLOSED shifts: a point may hold only one open shift, and these are seven past days.
    for (const date of ['01', '02', '03', '04', '05', '08', '10'].map((d) => `2026-07-${d}`)) {
      const [shift] = await ds.query(
        `INSERT INTO shifts (collection_point_id, opened_by_user_id, closed_by_user_id,
                             business_date, closed_at, status)
         VALUES ($1, $2, $2, $3, now(), 'closed') RETURNING id`,
        [point, userId, date],
      );
      shiftOn.set(date, shift.id as string);
    }

    const hanna = await supplier('Ганна');
    await intake(hanna, '2026-07-01', '100.00');
    await intake(hanna, '2026-07-05', '50.00');
    await payout(hanna, '2026-07-05', '120.00');

    const vasyl = await supplier('Василь');
    const paid = await intake(vasyl, '2026-07-03', '40.00');
    await payout(vasyl, '2026-07-03', '40.00');
    await topUp(vasyl, paid, '10.00');
    await intake(vasyl, '2026-07-10', '25.00');

    const zina = await supplier('Зіна');
    await intake(zina, '2026-07-02', '60.00', true);
    await intake(zina, '2026-07-08', '15.00');

    const nina = await supplier('Ніна');
    await intake(nina, '2026-07-04', '50.00');
    const ninaPayout = await payout(nina, '2026-07-04', '50.00');
    await voidDoc(nina, 'payouts', { payoutId: ninaPayout }, ninaPayout);

    const taras = await supplier('Тарас');
    const tarasPaid = await intake(taras, '2026-07-02', '40.00');
    await payout(taras, '2026-07-02', '40.00');
    const tarasTopUp = await topUp(taras, tarasPaid, '10.00');
    await voidDoc(taras, 'intake_top_ups', { topUpId: tarasTopUp }, tarasTopUp);
    await intake(taras, '2026-07-10', '20.00');

    const oleh = await supplier('Олег');
    const olehVoided = await intake(oleh, '2026-07-01', '30.00');
    await topUp(oleh, olehVoided, '5.00');
    await voidDoc(oleh, 'intakes', { intakeId: olehVoided }, olehVoided);
    await intake(oleh, '2026-07-08', '12.00');

    const marko = await supplier('Марко');
    await intake(marko, '2026-07-04', '30.00');
    await payout(marko, '2026-07-04', '30.00');

    const luka = await supplier('Лука');
    await payout(luka, '2026-07-01', '20.00');
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  const oldestBy = (page: { data: { first_name: string; oldest_open_date: string | null }[] }) =>
    Object.fromEntries(page.data.map((r) => [r.first_name, r.oldest_open_date]));

  it("dates each row by its oldest line still open — a partly paid receipt counts, a fully paid one doesn't", async () => {
    const page = await service.list(owner, query());

    expect(oldestBy(page)).toEqual({
      Ганна: '2026-07-05',
      Василь: '2026-07-03',
      Зіна: '2026-07-08',
      Ніна: '2026-07-04',
      Тарас: '2026-07-10',
      Олег: '2026-07-08',
      Лука: null,
    });
    expect(page.data.find((r) => r.first_name === 'Ганна')?.debt).toBe('30.00');
  });

  it('gives a zero balance no date', async () => {
    const page = await service.list(owner, query({ include_zero: true }));

    expect(oldestBy(page).Марко).toBeNull();
  });

  it('puts the oldest date among rows OWED money on the envelope', async () => {
    await expect(service.list(owner, query())).resolves.toMatchObject({
      total: 7,
      oldest_open_date: '2026-07-03',
    });
  });

  it("reads the envelope's date over every visible row, not the loaded page", async () => {
    // Debt DESC is Ніна 50, Василь 35, Ганна 30, Тарас 20, Зіна 15, Олег 12, Лука −20: page 3
    // holds Ганна's 07-05 alone, and the tile still owes the point's oldest date.
    const page = await service.list(owner, query({ limit: 1, page: 3 }));

    expect(page.data.map((r) => r.first_name)).toEqual(['Ганна']);
    expect(page.oldest_open_date).toBe('2026-07-03');
  });

  it('sums «Всього винні» over every row OWED money, past the loaded page (#229)', async () => {
    // 50 + 35 + 30 + 20 + 15 + 12 — Лука's −20 credit must not shrink what the others wait for.
    await expect(service.list(owner, query({ limit: 1, page: 3 }))).resolves.toMatchObject({
      total_owed: '162.00',
    });
  });

  it('is null for a point where nothing is open', async () => {
    const [empty] = await ds.query(
      `INSERT INTO collection_points (name, kind, code) VALUES ($1, 'reception', $2) RETURNING id`,
      [`Найстаріший-порожня-${run}`, `E${run.slice(0, 4).toUpperCase()}`],
    );

    await expect(
      service.list(owner, query({ collection_point_id: empty.id as string })),
    ).resolves.toMatchObject({ total: 0, data: [], oldest_open_date: null, total_owed: '0.00' });
  });
});

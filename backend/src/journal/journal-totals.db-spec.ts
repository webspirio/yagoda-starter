import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { JournalTotalsQuery } from './queries/journal-totals.query';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * `/journal-totals`' SQL against a real Postgres. October 2026, point A unless noted:
 *
 *   09-30  Іван    receipt 7000.00, payout 7000.00          — the day before: out
 *   10-01  Іван    receipt 1000.00, payout 400.00           — first day: in
 *   10-15  Іван    receipt 2000.00 VOIDED, payout 300 VOIDED — never counted
 *   10-15  Ольга   receipt 500.00, payout 500.00
 *   10-31  Ольга   receipt 250.00, payout 100.00             — last day: in
 *   11-01  Іван    receipt 9000.00                          — the day after: out
 *   10-15  Богдан  at point B, receipt 3000.00, payout 1200.00
 *
 * October at A: accrued 1750.00, paid 1000.00. Network-wide: 4750.00, 2200.00.
 *
 * The fixtures insert intakes and payouts by raw SQL WITHOUT calling `allocate`,
 * which backend/CLAUDE.md requires of such fixtures — safe here only because this
 * query never reads `payout_allocations`. A spec that does must allocate.
 */
describe('JournalTotalsQuery.totals (Postgres)', () => {
  let ds: DataSource;
  let query: JournalTotalsQuery;
  let run: string;
  let pointA: string;
  let pointB: string;
  let userId: string;
  let ivan: string;
  let olha: string;
  let emptyPoint: string;
  let operatorAtA: AuthenticatedUser;
  const owner: AuthenticatedUser = {
    sub: 'u-owner',
    username: 'owner',
    role: UserRole.NetworkOwner,
    collection_point_id: null,
  };
  const october = { from: '2026-10-01', to: '2026-10-31' };

  let seq = 0;
  const insertPoint = async (label: string) => {
    const [row] = await ds.query(
      `INSERT INTO collection_points (name, kind, code) VALUES ($1, 'reception', $2) RETURNING id`,
      [`Журнал ${label}-${run}`, `${label}${run.slice(0, 4).toUpperCase()}`],
    );
    return row.id as string;
  };
  const insertSupplier = async (point: string, first: string) => {
    const [row] = await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name) VALUES ($1, $2, $3) RETURNING id`,
      [point, first, `Тест-${run}`],
    );
    return row.id as string;
  };
  const shifts = new Map<string, string>();
  const shiftOn = async (point: string, date: string) => {
    const key = `${point}:${date}`;
    const known = shifts.get(key);
    if (known) return known;
    const [row] = await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date,
                           status, closed_at, closed_by_user_id)
       VALUES ($1, $2, $3, 'closed', now(), $2) RETURNING id`,
      [point, userId, date],
    );
    shifts.set(key, row.id);
    return row.id as string;
  };
  const voidCols = `voided_at, voided_by_user_id, void_reason`;
  const voidVals = (flag: string, user: string) =>
    `CASE WHEN ${flag} THEN now() END, CASE WHEN ${flag} THEN ${user}::uuid END, CASE WHEN ${flag} THEN 'test' END`;
  const insertIntake = async (point: string, date: string, supplier: string, amount: string, voided = false) => {
    await ds.query(
      `INSERT INTO intakes (code, shift_id, supplier_id, amount, balance_after, received_by_user_id, ${voidCols})
       VALUES ($1, $2, $3, $4, '0.00', $5, ${voidVals('$6', '$5')})`,
      [`IN-${run}-${++seq}`, await shiftOn(point, date), supplier, amount, userId, voided],
    );
  };
  const insertPayout = async (point: string, date: string, supplier: string, amount: string, voided = false) => {
    await ds.query(
      `INSERT INTO payouts (code, shift_id, supplier_id, amount, paid_by_user_id, balance_after, ${voidCols})
       VALUES ($1, $2, $3, $4, $5, '0.00', ${voidVals('$6', '$5')})`,
      [`PO-${run}-${++seq}`, await shiftOn(point, date), supplier, amount, userId, voided],
    );
  };

  beforeAll(async () => {
    ds = await openTestDataSource();
    query = new JournalTotalsQuery(ds);
    run = randomUUID();
    pointA = await insertPoint('A');
    pointB = await insertPoint('B');
    emptyPoint = await insertPoint('C');
    operatorAtA = { sub: 'u-op', username: 'op', role: UserRole.PointOperator, collection_point_id: pointA };

    const [user] = await ds.query(
      `INSERT INTO users (first_name, last_name, role) VALUES ('Оксана', 'Тест', 'network_owner') RETURNING id`,
    );
    userId = user.id;
    ivan = await insertSupplier(pointA, 'Іван');
    olha = await insertSupplier(pointA, 'Ольга');
    const bohdan = await insertSupplier(pointB, 'Богдан');

    await insertIntake(pointA, '2026-09-30', ivan, '7000.00');
    await insertPayout(pointA, '2026-09-30', ivan, '7000.00');
    await insertIntake(pointA, '2026-10-01', ivan, '1000.00');
    await insertPayout(pointA, '2026-10-01', ivan, '400.00');
    await insertIntake(pointA, '2026-10-15', ivan, '2000.00', true);
    await insertPayout(pointA, '2026-10-15', ivan, '300.00', true);
    await insertIntake(pointA, '2026-10-15', olha, '500.00');
    await insertPayout(pointA, '2026-10-15', olha, '500.00');
    await insertIntake(pointA, '2026-10-31', olha, '250.00');
    await insertPayout(pointA, '2026-10-31', olha, '100.00');
    await insertIntake(pointA, '2026-11-01', ivan, '9000.00');
    await insertIntake(pointB, '2026-10-15', bohdan, '3000.00');
    await insertPayout(pointB, '2026-10-15', bohdan, '1200.00');
  });

  afterAll(async () => {
    await ds.destroy();
  });

  it('sums live receipts and payouts inside the inclusive range at one point', async () => {
    await expect(query.totals(owner, { ...october, collection_point_id: pointA })).resolves.toEqual({
      accrued: '1750.00',
      paid: '1000.00',
    });
  });

  it('narrows to one supplier', async () => {
    await expect(
      query.totals(owner, { ...october, collection_point_id: pointA, supplier_id: olha }),
    ).resolves.toEqual({ accrued: '750.00', paid: '600.00' });
  });

  it('reads a one-day range', async () => {
    await expect(
      query.totals(owner, { from: '2026-10-01', to: '2026-10-01', collection_point_id: pointA }),
    ).resolves.toEqual({ accrued: '1000.00', paid: '400.00' });
  });

  it('pins an operator to their own point even when another is requested', async () => {
    await expect(query.totals(operatorAtA, { ...october, collection_point_id: pointB })).resolves.toEqual({
      accrued: '1750.00',
      paid: '1000.00',
    });
  });

  it('answers 0.00, not null, when nothing matches', async () => {
    await expect(query.totals(owner, { ...october, collection_point_id: emptyPoint })).resolves.toEqual({
      accrued: '0.00',
      paid: '0.00',
    });
  });

  it('spans every point for the owner without a point filter', async () => {
    // `openTestDataSource()` recreates the database, so these rows are all there is.
    await expect(query.totals(owner, october)).resolves.toEqual({ accrued: '4750.00', paid: '2200.00' });
  });
});

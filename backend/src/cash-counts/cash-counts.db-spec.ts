import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { CashCountsService } from './cash-counts.service';
import { ListCashCountsQueryDto } from './dto/list-cash-counts.query';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * `GET /cash-counts` against a real Postgres, through the service and not the
 * route: what is under test is the hand-written SQL — a `scope` fragment
 * shared between the page query and the count query, SEVEN bind positions,
 * and a `JOIN` onto `shifts` for point scoping and `only_discrepancies` — none
 * of which a mocked unit spec can catch a bind-position mismatch or a
 * statement that simply fails to parse in. Every fixture carries a per-run
 * uuid: the throwaway database persists between runs and nothing here
 * truncates.
 *
 * Point A carries four shifts, each on a distinct business date
 * (`UQ_shifts_point_business_date` forbids two on the same day), chosen so
 * every predicate in the WHERE clause has a row that would fail without it:
 *
 *   2026-09-01  opening, MATCHING (counted = expected)        — not open
 *   2026-09-03  opening match + closing MISMATCH, unexplained — open
 *   2026-09-06  closing MISMATCH, shift EXPLAINED             — closed by explanation, not by the numbers
 *   2026-09-08  a MIDDAY count, mismatched, unexplained       — §6.3's demotion:
 *               reopening a shift turns its `closing` count into a `midday`
 *               one. The evidence stays VISIBLE in the unfiltered list and
 *               stays OFF the working list — one drift must not be reported
 *               twice, and `unexplained_difference` already excludes it.
 *
 * Point B holds one mismatched, unexplained count, for the point-scoping test.
 */
describe('CashCountsService.list (Postgres)', () => {
  let ds: DataSource;
  let service: CashCountsService;
  let pointA: string;
  let pointB: string;
  let userId: string;

  const owner: AuthenticatedUser = {
    sub: 'u-owner',
    username: 'owner',
    role: UserRole.NetworkOwner,
    collection_point_id: null,
  };
  let operatorAtA: AuthenticatedUser;

  const query = (over: Partial<ListCashCountsQueryDto> = {}): ListCashCountsQueryDto => ({
    page: 1,
    limit: 20,
    only_discrepancies: false,
    ...over,
  });

  let shiftMatch: string;
  let shiftMismatch: string;
  let shiftExplained: string;
  let shiftMidday: string;
  let shiftB: string;
  let mismatchCountId: string;
  let middayCountId: string;

  const insertShift = async (
    point: string,
    businessDate: string,
    closed = true,
  ): Promise<string> => {
    const [{ id }] = (await ds.query(
      closed
        ? `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date,
                               closed_at, closed_by_user_id, status)
           VALUES ($1, $2, $3, now(), $2, 'closed') RETURNING id`
        : `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date, status)
           VALUES ($1, $2, $3, 'open') RETURNING id`,
      [point, userId, businessDate],
    )) as { id: string }[];
    return id;
  };

  const insertCount = async (
    shift: string,
    kind: 'opening' | 'midday' | 'closing',
    counted: string,
    expected: string,
    countedAt: string,
  ): Promise<string> => {
    const [{ id }] = (await ds.query(
      `INSERT INTO cash_counts (shift_id, book, kind, counted_amount, expected_amount,
                                counted_by_user_id, counted_at)
       VALUES ($1, 'berry', $2, $3, $4, $5, $6) RETURNING id`,
      [shift, kind, counted, expected, userId, countedAt],
    )) as { id: string }[];
    return id;
  };

  beforeAll(async () => {
    ds = await openTestDataSource();
    // `list` (the only method this file exercises) never touches
    // `shifts`/`cash`/`audit` — those three back `recount` alone, which has
    // its own db-spec (`cash-count-recount.db-spec.ts`) wired through real
    // Nest DI. Stubbing them here keeps this file's fixture unchanged.
    service = new CashCountsService(ds, {} as never, {} as never, {} as never);
    const run = randomUUID();
    const short = run.slice(0, 4).toUpperCase();

    const [a] = await ds.query(
      `INSERT INTO collection_points (name, code, kind, is_active)
       VALUES ($1, $2, 'reception', true) RETURNING id`,
      [`Каса А-${run}`, `A${short}`],
    );
    const [b] = await ds.query(
      `INSERT INTO collection_points (name, code, kind, is_active)
       VALUES ($1, $2, 'reception', true) RETURNING id`,
      [`Каса Б-${run}`, `B${short}`],
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
      `INSERT INTO users (first_name, last_name, role, is_active)
       VALUES ('Оксана', $1, 'network_owner', true) RETURNING id`,
      [`Тест-${run}`],
    );
    userId = user.id;

    // 2026-09-01 — a point's FIRST count: expected := counted by construction,
    // so this row is a discrepancy of exactly zero and must never read "open".
    shiftMatch = await insertShift(pointA, '2026-09-01');
    await insertCount(shiftMatch, 'opening', '1000.00', '1000.00', '2026-09-01T08:00:00Z');

    // 2026-09-03 — a real, unexplained shortage. This is the row
    // `only_discrepancies=true` must surface.
    shiftMismatch = await insertShift(pointA, '2026-09-03');
    await insertCount(shiftMismatch, 'opening', '1000.00', '1000.00', '2026-09-03T08:00:00Z');
    mismatchCountId = await insertCount(
      shiftMismatch,
      'closing',
      '900.00',
      '1000.00',
      '2026-09-03T18:00:00Z',
    );

    // 2026-09-06 — a shortage the owner has written down. §7.7: the number
    // itself never moves, but it must drop out of the "open" list.
    shiftExplained = await insertShift(pointA, '2026-09-06');
    await insertCount(shiftExplained, 'closing', '750.00', '800.00', '2026-09-06T18:00:00Z');
    await ds.query(`UPDATE shifts SET explanation = $1 WHERE id = $2`, [
      'касир помилився решткою',
      shiftExplained,
    ]);

    // 2026-09-08 — models §6.3's reopen demotion directly (rather than through
    // ShiftsService.reopen): what is under test here is that THIS LIST still
    // surfaces a `midday` row with its discrepancy evidence intact, not the
    // reopen flow itself. Left OPEN (no closed_at), as a reopened shift is —
    // it is the only open shift at point A, so it does not collide with
    // `UQ_shifts_open_per_point`.
    shiftMidday = await insertShift(pointA, '2026-09-08', false);
    middayCountId = await insertCount(
      shiftMidday,
      'midday',
      '500.00',
      '600.00',
      '2026-09-08T11:00:00Z',
    );

    // Point B — for the point-scoping test only.
    shiftB = await insertShift(pointB, '2026-09-03');
    await insertCount(shiftB, 'closing', '450.00', '500.00', '2026-09-03T18:00:00Z');
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it('parses and binds — a plain, unfiltered list returns rows', async () => {
    const page = await service.list(owner, query());

    expect(page.data.length).toBeGreaterThan(0);
    expect(page.total).toBeGreaterThanOrEqual(page.data.length);
  });

  it('only_discrepancies=true filters IN SQL: only the mismatched, unexplained rows come back', async () => {
    const page = await service.list(
      owner,
      query({ collection_point_id: pointA, only_discrepancies: true }),
    );

    expect(page.total).toBe(page.data.length);
    // ONE row, not two: the demoted `midday` count is excluded. It is a real
    // discrepancy on an unexplained shift and would otherwise qualify — see
    // the demotion test below for why it must not.
    expect(page.total).toBe(1);
    expect(page.data.map((r) => r.id)).toEqual([mismatchCountId]);
    expect(page.data.every((r) => r.discrepancy !== '0.00')).toBe(true);
    expect(page.data.every((r) => r.is_open)).toBe(true);
  });

  it('an explained discrepancy drops out of only_discrepancies but stays in the unfiltered list', async () => {
    const unfiltered = await service.list(owner, query({ collection_point_id: pointA }));
    const explainedRow = unfiltered.data.find((r) => r.shift_id === shiftExplained);
    expect(explainedRow).toBeDefined();
    // §7.7 — «розбіжність у документі лишається, її не підганяють»: the
    // number itself is untouched by the explanation.
    expect(explainedRow?.discrepancy).toBe('-50.00');
    expect(explainedRow?.is_open).toBe(false);

    const openOnly = await service.list(
      owner,
      query({ collection_point_id: pointA, only_discrepancies: true }),
    );
    expect(openOnly.data.some((r) => r.shift_id === shiftExplained)).toBe(false);
  });

  it('pins an operator to their own point even when they name another', async () => {
    const page = await service.list(operatorAtA, query({ collection_point_id: pointB }));

    expect(page.data.length).toBeGreaterThan(0);
    expect(page.data.every((r) => r.collection_point_id === pointA)).toBe(true);
    expect(page.data.some((r) => r.shift_id === shiftB)).toBe(false);
  });

  it('keeps a demoted midday count as evidence but off the working list', async () => {
    // §7.6 — the row is NOT destroyed and NOT adjusted: the unfiltered list
    // still carries it, discrepancy intact.
    const unfiltered = await service.list(owner, query({ collection_point_id: pointA }));
    const row = unfiltered.data.find((r) => r.id === middayCountId);

    expect(row).toBeDefined();
    expect(row?.kind).toBe('midday');
    expect(row?.discrepancy).toBe('-100.00');

    // WHAT IT IS NOT: something still to be worked. A reopen demotes the first
    // closing count and the re-close writes a second — one drift, two rows.
    // Counting both would report −180 to an owner whose point is −90 out, and
    // would disagree with `unexplained_difference`, which excludes `midday`
    // for exactly this reason (see b5952bb).
    expect(row?.is_open).toBe(false);

    const working = await service.list(
      owner,
      query({ collection_point_id: pointA, only_discrepancies: true }),
    );
    expect(working.data.some((r) => r.id === middayCountId)).toBe(false);
  });

  it('binds a shift_id filter, scoping to exactly that shift regardless of point', async () => {
    const page = await service.list(owner, query({ shift_id: shiftMismatch }));

    expect(page.total).toBe(2);
    expect(page.data.every((r) => r.shift_id === shiftMismatch)).toBe(true);
  });

  it('binds from/to on the shift business date, not the count timestamp', async () => {
    const page = await service.list(
      owner,
      query({ collection_point_id: pointA, from: '2026-09-04', to: '2026-09-07' }),
    );

    expect(page.total).toBe(1);
    expect(page.data[0].shift_id).toBe(shiftExplained);
    expect(page.data[0].business_date).toBe('2026-09-06');
  });

  it('paginates in SQL with the total held across pages', async () => {
    const first = await service.list(owner, query({ collection_point_id: pointA, limit: 2 }));
    const second = await service.list(
      owner,
      query({ collection_point_id: pointA, limit: 2, page: 2 }),
    );

    expect(first).toMatchObject({ total: 5, page: 1, limit: 2 });
    expect(first.data.length).toBe(2);
    expect(second).toMatchObject({ total: 5, page: 2, limit: 2 });
    expect(second.data.length).toBe(2);
    const firstIds = first.data.map((r) => r.id);
    expect(second.data.every((r) => !firstIds.includes(r.id))).toBe(true);
  });
});

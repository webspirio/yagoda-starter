import { randomUUID } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { GradePricesService } from './grade-prices.service';
import { GradePrice } from './grade-price.entity';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import type { PriceChangesQueryDto } from './dto/price-changes.query';

/**
 * `GET /grade-prices/changes` against a real Postgres — #151's «Зміни протягом
 * дня».
 *
 * WHAT IS UNDER TEST IS SQL a unit spec cannot reach: the LOCAL-date filter
 * (`AT TIME ZONE`, which a mocked manager would accept whatever it said) and
 * the «was → became» pairing, whose «was» may live on an EARLIER day than the
 * change it describes.
 *
 * Rows are placed in time RELATIVE TO THE DATABASE'S `now()`, in the app zone,
 * so the file passes whatever the wall clock says and whatever the session
 * timezone is. The DB is shared with other specs, so every assertion reads
 * only this run's points.
 */
describe('GradePricesService.changes (Postgres)', () => {
  const TZ = 'Europe/Kyiv';

  let ds: DataSource;
  let service: GradePricesService;
  let run: string;
  let ownerId: string;
  let pointA: string;
  let pointB: string;
  let gradeId: string;
  let today: string;
  let yesterday: string;
  let twoDaysAgo: string;

  const owner = (): AuthenticatedUser =>
    ({ sub: ownerId, role: UserRole.NetworkOwner, collection_point_id: null }) as AuthenticatedUser;
  const operatorAt = (pointId: string): AuthenticatedUser =>
    ({
      sub: ownerId,
      role: UserRole.PointOperator,
      collection_point_id: pointId,
    }) as AuthenticatedUser;

  /** Local midnight today in `TZ`, shifted by `offset` — as a `timestamptz`. */
  const todayAt = (offset: string) =>
    `(date_trunc('day', now() AT TIME ZONE '${TZ}') + interval '${offset}') AT TIME ZONE '${TZ}'`;

  const price = async (
    pointId: string,
    base: string,
    createdAt: string,
    reason: string | null = null,
  ): Promise<string> => {
    const [row] = await ds.query(
      `INSERT INTO grade_prices
         (collection_point_id, product_grade_id, base_price, max_markup, max_discount,
          created_by_user_id, reason, created_at)
       VALUES ($1, $2, $3, '0.00', '0.00', $4, $5, ${createdAt})
       RETURNING id`,
      [pointId, gradeId, base, ownerId, reason],
    );
    return row.id;
  };

  const ours = async (actor: AuthenticatedUser, query: PriceChangesQueryDto = {}) => {
    const result = await service.changes(actor, query);
    return result.changes.filter((c) => c.product_grade_id === gradeId);
  };

  beforeAll(async () => {
    ds = await openTestDataSource();
    run = randomUUID().slice(0, 8);

    const [user] = await ds.query(
      `INSERT INTO users (first_name, last_name, role)
       VALUES ('Оксана', $1, 'network_owner') RETURNING id`,
      [`Зміни-${run}`],
    );
    ownerId = user.id;

    const makePoint = async (label: string) => {
      const [row] = await ds.query(
        `INSERT INTO collection_points (name, kind, code)
         VALUES ($1, 'reception'::point_kind, $2) RETURNING id`,
        [`Зміни ${label} ${run}`, `${label}${run.slice(0, 4).toUpperCase()}`],
      );
      return row.id as string;
    };
    pointA = await makePoint('A');
    pointB = await makePoint('B');

    const [product] = await ds.query(`INSERT INTO products (name) VALUES ($1) RETURNING id`, [
      `Смородина ${run}`,
    ]);
    const [grade] = await ds.query(
      `INSERT INTO product_grades (product_id, name, is_active) VALUES ($1, $2, true) RETURNING id`,
      [product.id, `Чорна ${run}`],
    );
    gradeId = grade.id;

    service = new GradePricesService(ds.getRepository(GradePrice), {} as never, {} as never, {
      appTimezone: TZ,
    });

    const [days] = await ds.query(
      `SELECT d::text AS today, (d - 1)::text AS yesterday, (d - 2)::text AS two_days_ago
         FROM (SELECT (now() AT TIME ZONE '${TZ}')::date AS d) t`,
    );
    today = days.today;
    yesterday = days.yesterday;
    twoDaysAgo = days.two_days_ago;

    // Point A: priced the day before yesterday, yesterday evening, then twice today.
    await price(pointA, '40.00', todayAt('-2 days'));
    await price(pointA, '45.00', todayAt('-1 hour'));
    await price(pointA, '71.00', todayAt('1 minute'));
    await price(pointA, '74.00', todayAt('1 minute 30 seconds'), 'конкуренти підняли');
    // Point B: priced for the first time ever, today.
    await price(pointB, '130.00', todayAt('2 minutes'));
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it("lists only today's changes, newest first", async () => {
    const changes = await ours(owner());
    expect(changes.map((c) => [c.point_name, c.base_price])).toEqual([
      [`Зміни B ${run}`, '130.00'],
      [`Зміни A ${run}`, '74.00'],
      [`Зміни A ${run}`, '71.00'],
    ]);
  });

  /**
   * THE PAIRING. The first change of the day is measured against YESTERDAY's
   * price — the one the point was actually trading at — not left blank because
   * no earlier row falls on today.
   */
  it('pairs each change with the price it replaced, even across midnight', async () => {
    const changes = await ours(owner());
    const byNew = Object.fromEntries(changes.map((c) => [c.base_price, c.previous_base_price]));
    expect(byNew['71.00']).toBe('45.00');
    expect(byNew['74.00']).toBe('71.00');
  });

  it('gives a first-ever price no «was»', async () => {
    const changes = await ours(owner());
    expect(changes.find((c) => c.base_price === '130.00')!.previous_base_price).toBeNull();
  });

  it('names the point, the grade, the author and the reason', async () => {
    const [latestAtA] = (await ours(owner())).filter((c) => c.collection_point_id === pointA);
    expect(latestAtA).toMatchObject({
      product_name: `Смородина ${run}`,
      grade_name: `Чорна ${run}`,
      author_name: `Оксана Зміни-${run}`,
      reason: 'конкуренти підняли',
    });
    expect(typeof latestAtA.created_at).toBe('string');
  });

  it('shows an operator their own point only', async () => {
    const changes = await ours(operatorAt(pointA));
    expect(changes.map((c) => c.collection_point_id)).toEqual([pointA, pointA]);
  });

  it("defaults to the app zone's today, reported as both bounds", async () => {
    const result = await service.changes(owner(), {});
    expect(result).toMatchObject({ from: today, to: today });
  });

  describe('over a period', () => {
    it('reads one past day with `to` alone', async () => {
      const changes = await ours(owner(), { to: yesterday });
      expect(changes.map((c) => [c.base_price, c.previous_base_price])).toEqual([
        ['45.00', '40.00'],
      ]);
    });

    it('runs `from` alone up to today, both ends inclusive, newest first', async () => {
      const result = await service.changes(owner(), { from: twoDaysAgo });
      expect(result).toMatchObject({ from: twoDaysAgo, to: today });
      const changes = result.changes.filter((c) => c.product_grade_id === gradeId);
      expect(changes.map((c) => c.base_price)).toEqual([
        '130.00',
        '74.00',
        '71.00',
        '45.00',
        '40.00',
      ]);
    });

    it('keeps the operator on their own point across the period', async () => {
      const changes = await ours(operatorAt(pointB), { from: twoDaysAgo, to: today });
      expect(changes.map((c) => c.base_price)).toEqual(['130.00']);
    });

    it('rejects `to` before `from`', async () => {
      await expect(service.changes(owner(), { from: today, to: yesterday })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a period longer than 31 days', async () => {
      await expect(
        service.changes(owner(), { from: '2026-01-01', to: '2026-02-01' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.changes(owner(), { from: '2026-01-01', to: '2026-01-31' }),
      ).resolves.toMatchObject({ from: '2026-01-01', to: '2026-01-31' });
    });

    it('rejects a date that is not on the calendar', async () => {
      await expect(service.changes(owner(), { to: '2026-02-30' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});

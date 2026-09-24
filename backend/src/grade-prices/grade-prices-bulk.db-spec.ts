import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { GradePricesService } from './grade-prices.service';
import { GradePrice } from './grade-price.entity';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * `POST /grade-prices/bulk` and `GET /grade-prices/sheet` against a real
 * Postgres.
 *
 * WHAT IS UNDER TEST IS ATOMICITY, and a unit spec cannot reach it: a mocked
 * `manager.transaction` proves the callback was called, not that Postgres
 * rolled anything back. Spec `2026-09-07` §8.1 asked for this route to be ONE
 * transaction, and the reason was what a half-applied write LOOKS LIKE — three
 * points at 150 and two at 145 render as «різні · 145–150», indistinguishable
 * from a spread the owner set on purpose. That is the claim this file checks.
 *
 * `CollectionPointsService` and `ProductGradesService` are stood in for rather
 * than constructed: their real constructors pull in users, products and the
 * audit log, none of which this route touches. The stand-ins read the SAME ROWS
 * from the SAME database, so the existence checks are real — only the wiring is
 * short.
 */
describe('GradePricesService.bulk (Postgres)', () => {
  let ds: DataSource;
  let service: GradePricesService;
  let run: string;
  let ownerId: string;
  let pointA: string;
  let pointB: string;
  let warehouse: string;
  let gradeId: string;
  let retiredGradeId: string;

  const owner = (): AuthenticatedUser =>
    ({ sub: ownerId, role: UserRole.NetworkOwner, collection_point_id: null }) as AuthenticatedUser;
  const operatorAt = (pointId: string): AuthenticatedUser =>
    ({
      sub: ownerId,
      role: UserRole.PointOperator,
      collection_point_id: pointId,
    }) as AuthenticatedUser;

  const makePoint = async (label: string, kind: 'reception' | 'base'): Promise<string> => {
    const [row] = await ds.query(
      `INSERT INTO collection_points (name, kind, code) VALUES ($1, $2::point_kind, $3) RETURNING id`,
      [`Аркуш ${label} ${run}`, kind, `${label}${run.slice(0, 4).toUpperCase()}`],
    );
    return row.id;
  };

  const priceRows = async (grade: string): Promise<number> => {
    const [row] = await ds.query(
      `SELECT count(*)::int AS n FROM grade_prices WHERE product_grade_id = $1`,
      [grade],
    );
    return row.n;
  };

  beforeAll(async () => {
    ds = await openTestDataSource();
    run = randomUUID().slice(0, 8);

    const [user] = await ds.query(
      `INSERT INTO users (first_name, last_name, role)
       VALUES ('Власник', $1, 'network_owner') RETURNING id`,
      [`Аркуш-${run}`],
    );
    ownerId = user.id;

    pointA = await makePoint('A', 'reception');
    pointB = await makePoint('B', 'reception');
    warehouse = await makePoint('W', 'base');

    const [product] = await ds.query(
      `INSERT INTO products (name) VALUES ($1) RETURNING id`,
      [`Малина ${run}`],
    );
    const [grade] = await ds.query(
      `INSERT INTO product_grades (product_id, name, is_active) VALUES ($1, $2, true) RETURNING id`,
      [product.id, `Вищий ${run}`],
    );
    gradeId = grade.id;
    const [retired] = await ds.query(
      `INSERT INTO product_grades (product_id, name, is_active) VALUES ($1, $2, false) RETURNING id`,
      [product.id, `Нестандарт ${run}`],
    );
    retiredGradeId = retired.id;

    const byId = async (table: string, id: string) => {
      const [row] = await ds.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
      return row ?? null;
    };
    service = new GradePricesService(
      ds.getRepository(GradePrice),
      { findOneRaw: (id: string) => byId('collection_points', id) } as never,
      { findOneRaw: (id: string) => byId('product_grades', id) } as never,
      { appTimezone: 'Europe/Kyiv' },
    );
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it('writes one row per named point, in one go', async () => {
    const before = await priceRows(gradeId);

    const result = await service.bulk(owner(), {
      product_grade_id: gradeId,
      collection_point_ids: [pointA, pointB],
      base_price: '150.00',
      max_markup: '30.00',
      max_discount: '20.00',
      reason: 'Ціна дня загальна',
    } as never);

    expect(result).toEqual({ created: 2 });
    expect(await priceRows(gradeId)).toBe(before + 2);
  });

  /**
   * THE ASSERTION THIS FILE EXISTS FOR. A refusal must leave the journal
   * exactly as it found it — not «mostly», not «the first one got through».
   */
  it('writes NOTHING when one named point does not exist', async () => {
    const before = await priceRows(gradeId);

    await expect(
      service.bulk(owner(), {
        product_grade_id: gradeId,
        collection_point_ids: [pointA, randomUUID()],
        base_price: '999.00',
        max_markup: '30.00',
        max_discount: '20.00',
      } as never),
    ).rejects.toThrow();

    expect(await priceRows(gradeId)).toBe(before);
    const [row] = await ds.query(
      `SELECT count(*)::int AS n FROM grade_prices WHERE base_price = '999.00' AND product_grade_id = $1`,
      [gradeId],
    );
    expect(row.n).toBe(0);
  });

  it('writes nothing for a retired grade', async () => {
    const before = await priceRows(retiredGradeId);
    await expect(
      service.bulk(owner(), {
        product_grade_id: retiredGradeId,
        collection_point_ids: [pointA],
        base_price: '10.00',
        max_markup: '0.00',
        max_discount: '0.00',
      } as never),
    ).rejects.toMatchObject({ response: { code: 'PRODUCT_GRADE_INACTIVE' } });
    expect(await priceRows(retiredGradeId)).toBe(before);
  });

  /**
   * §4.2 — a price is never overwritten. The bulk route APPENDS like every
   * other write here, and «latest wins» is what makes the second gesture the
   * effective one.
   */
  it('appends rather than overwriting, so the journal keeps both gestures', async () => {
    const before = await priceRows(gradeId);
    await service.bulk(owner(), {
      product_grade_id: gradeId,
      collection_point_ids: [pointA],
      base_price: '155.00',
      max_markup: '30.00',
      max_discount: '20.00',
    } as never);
    expect(await priceRows(gradeId)).toBe(before + 1);

    const sheet = await service.sheet(owner(), {});
    const row = sheet.rows.find((r) => r.product_grade_id === gradeId)!;
    expect(row.prices[pointA].base_price).toBe('155.00');
  });

  it('reads back through the sheet as one agreed price per point', async () => {
    await service.bulk(owner(), {
      product_grade_id: gradeId,
      collection_point_ids: [pointA, pointB],
      base_price: '150.00',
      max_markup: '30.00',
      max_discount: '20.00',
    } as never);

    const sheet = await service.sheet(owner(), {});
    const row = sheet.rows.find((r) => r.product_grade_id === gradeId)!;
    expect(row.prices[pointA].base_price).toBe('150.00');
    expect(row.prices[pointB].base_price).toBe('150.00');
    // The warehouse was never named, so it holds no price for this grade — the
    // §4.8 exclusion, seen from the read side.
    expect(warehouse in row.prices).toBe(false);
  });

  it('gives an operator a one-column sheet of their own point', async () => {
    const sheet = await service.sheet(operatorAt(pointA), {});
    expect(sheet.points).toHaveLength(1);
    expect(sheet.points[0].id).toBe(pointA);
    const row = sheet.rows.find((r) => r.product_grade_id === gradeId)!;
    expect(Object.keys(row.prices)).toEqual([pointA]);
  });

  it('keeps the warehouse as a COLUMN even though the gesture skips it', async () => {
    const sheet = await service.sheet(owner(), {});
    const column = sheet.points.find((p) => p.id === warehouse);
    expect(column).toBeDefined();
    // `base` — §4.8's «склад». The enum spells it `base` because §8.1 also
    // re-weighs there; the client's «поставити всім» filter reads this value.
    expect(column!.kind).toBe('base');
  });

  it('never lists a retired grade on the sheet', async () => {
    const sheet = await service.sheet(owner(), {});
    expect(sheet.rows.some((r) => r.product_grade_id === retiredGradeId)).toBe(false);
  });
});

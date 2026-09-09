import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';

/** A unique, CHECK-valid `collection_points.code` per insert. The column became
 *  NOT NULL + UNIQUE with the intakes & payouts migration; 8 hex characters
 *  upper-cased satisfies `^[A-Z0-9]{2,8}$` and never collides across runs. */
const pointCode = (): string => randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();


/**
 * Everything in this slice's schema that exists ONLY in hand-written SQL and
 * is invisible to a mocked repository.
 *
 * Every fixture value carries a per-RUN uuid: `app_test` persists between runs
 * and this suite never truncates, so a literal would pass on a fresh database
 * and then fail on every later run with a duplicate-key error from the WRONG
 * insert. Same convention as `catalog-schema.db-spec.ts`.
 */
describe('YagodaSuppliersAndPrices', () => {
  let ds: DataSource;
  let pointA: string;
  let pointB: string;
  let gradeId: string;
  let userId: string;

  beforeAll(async () => {
    ds = await openTestDataSource();

    const run = randomUUID();
    const [a] = await ds.query(
      `INSERT INTO collection_points (name, kind, code) VALUES ($1, 'reception', $2) RETURNING id`,
      [`Точка А-${run}`, pointCode()],
    );
    const [b] = await ds.query(
      `INSERT INTO collection_points (name, kind, code) VALUES ($1, 'reception', $2) RETURNING id`,
      [`Точка Б-${run}`, pointCode()],
    );
    pointA = a.id;
    pointB = b.id;

    const [product] = await ds.query(`INSERT INTO products (name) VALUES ($1) RETURNING id`, [
      `Малина-${run}`,
    ]);
    const [grade] = await ds.query(
      `INSERT INTO product_grades (product_id, name) VALUES ($1, $2) RETURNING id`,
      [product.id, `1 сорт-${run}`],
    );
    gradeId = grade.id;

    const [user] = await ds.query(
      `INSERT INTO users (first_name, last_name, role) VALUES ('Ціно', 'Ставник', 'network_owner')
       RETURNING id`,
    );
    userId = user.id;
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it.each(['suppliers', 'grade_prices'])('creates the %s table', async (table) => {
    const [row] = await ds.query(`SELECT to_regclass($1) IS NOT NULL AS present`, [
      `public.${table}`,
    ]);
    expect(row.present).toBe(true);
  });

  const insertSupplier = (point: string, phone: string | null, last = 'Коваль') =>
    ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name, phone)
       VALUES ($1, 'Іван', $2, $3) RETURNING id`,
      [point, last, phone],
    );

  describe('phone uniqueness', () => {
    it('rejects the same phone twice at one point', async () => {
      const phone = `+38067${String(Math.floor(1e6 + Math.random() * 9e6))}`;
      await insertSupplier(pointA, phone);
      await expect(insertSupplier(pointA, phone)).rejects.toThrow(/duplicate key/i);
    });

    it('PERMITS the same phone at a different point', async () => {
      // §3.9 — a person delivering to two points is two rows, and debt does
      // not cross between them. If this ever starts failing, the constraint
      // has been widened to the network and §3.9 is broken.
      const phone = `+38067${String(Math.floor(1e6 + Math.random() * 9e6))}`;
      await insertSupplier(pointA, phone);
      await expect(insertSupplier(pointB, phone)).resolves.toBeDefined();
    });

    it('permits MANY suppliers with no phone at one point', async () => {
      // правка 8's «без номеру телефону» escape hatch. It works only because
      // Postgres unique indexes treat NULLs as distinct (NULLS DISTINCT), and
      // no unit test can reach that fact.
      await insertSupplier(pointA, null, `Безномерний-${randomUUID()}`);
      await expect(
        insertSupplier(pointA, null, `Безномерний-${randomUUID()}`),
      ).resolves.toBeDefined();
    });
  });

  describe('phone shape', () => {
    it.each(['067123', 'not-a-phone', '+3806712345678901', '0671234567', '+0671234567'])(
      'rejects %s',
      async (bad) => {
        await expect(insertSupplier(pointA, bad)).rejects.toThrow(/violates check constraint/i);
      },
    );

    it('accepts a canonical E.164 value', async () => {
      const phone = `+38067${String(Math.floor(1e6 + Math.random() * 9e6))}`;
      await expect(insertSupplier(pointA, phone)).resolves.toBeDefined();
    });
  });

  it('rejects an unknown supplier_kind', async () => {
    await expect(
      ds.query(
        `INSERT INTO suppliers (collection_point_id, first_name, last_name, kind)
         VALUES ($1, 'Іван', 'Коваль', 'reseller')`,
        [pointA],
      ),
    ).rejects.toThrow(/invalid input value for enum/i);
  });

  it('defaults supplier_kind to none and is_active to true', async () => {
    const [row] = await insertSupplier(pointA, null, `Дефолт-${randomUUID()}`);
    const [saved] = await ds.query(`SELECT kind, is_active FROM suppliers WHERE id = $1`, [row.id]);
    expect(saved).toEqual({ kind: 'none', is_active: true });
  });

  it('rejects a supplier pointing at no collection point', async () => {
    await expect(insertSupplier(randomUUID(), null)).rejects.toThrow(/foreign key/i);
  });

  const insertPrice = (base: string, markup = '30.00', discount = '20.00') =>
    ds.query(
      `INSERT INTO grade_prices
         (collection_point_id, product_grade_id, base_price, max_markup, max_discount,
          created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [pointA, gradeId, base, markup, discount, userId],
    );

  describe('grade_prices', () => {
    it.each([
      ['base_price', () => insertPrice('-1')],
      ['max_markup', () => insertPrice('50.00', '-1')],
      ['max_discount', () => insertPrice('50.00', '30.00', '-1')],
    ])('rejects a negative %s', async (_column, attempt) => {
      await expect(attempt()).rejects.toThrow(/violates check constraint/i);
    });

    it('permits zero in all three columns', async () => {
      // Zero means "no adjustment permitted" and is a real, expressible state.
      await expect(insertPrice('0', '0', '0')).resolves.toBeDefined();
    });

    it('PERMITS two rows for the same point and grade', async () => {
      // An INVERTED assertion, proving an ABSENCE. §4.2 requires history —
      // «записи не перетираються, а додаються» — and a UNIQUE on this pair is
      // exactly what forbade it in the old `shift_grade_prices`. If a future
      // `migration:generate` run helpfully adds that constraint, this test is
      // the only thing that notices before history is destroyed.
      await insertPrice('50.00');
      await expect(insertPrice('55.00')).resolves.toBeDefined();
    });

    it('returns all three money columns as STRINGS', async () => {
      const [row] = await insertPrice('51.50', '30.00', '20.00');
      const [saved] = await ds.query(
        `SELECT base_price, max_markup, max_discount FROM grade_prices WHERE id = $1`,
        [row.id],
      );
      expect(typeof saved.base_price).toBe('string');
      expect(typeof saved.max_markup).toBe('string');
      expect(typeof saved.max_discount).toBe('string');
      expect(saved.base_price).toBe('51.50');
    });

    it('rejects a price pointing at no grade', async () => {
      await expect(
        ds.query(
          `INSERT INTO grade_prices
             (collection_point_id, product_grade_id, base_price, max_markup, max_discount,
              created_by_user_id)
           VALUES ($1, $2, '50.00', '30.00', '20.00', $3)`,
          [pointA, randomUUID(), userId],
        ),
      ).rejects.toThrow(/foreign key/i);
    });

    it('has no updated_at column — the table is append-only', async () => {
      const [row] = await ds.query(
        `SELECT count(*)::int AS n FROM information_schema.columns
          WHERE table_name = 'grade_prices' AND column_name = 'updated_at'`,
      );
      expect(row.n).toBe(0);
    });
  });
});

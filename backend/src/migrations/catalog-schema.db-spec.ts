import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';

/** A unique, CHECK-valid `collection_points.code` per insert. The column became
 *  NOT NULL + UNIQUE with the intakes & payouts migration; 8 hex characters
 *  upper-cased satisfies `^[A-Z0-9]{2,8}$` and never collides across runs. */
const pointCode = (): string => randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();


/**
 * Everything in the catalog schema that exists ONLY in hand-written SQL.
 *
 * Every name is suffixed with a per-RUN uuid: `app_test` persists between runs
 * and this suite never truncates, so a literal name passes on a fresh database
 * and then fails on every later run — with a duplicate-key error that looks
 * exactly like the one being asserted, from the WRONG insert. Same convention
 * as `schema.db-spec.ts` and `pipeline.db-spec.ts`.
 */
describe('YagodaCatalog', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = await openTestDataSource();
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  const tables = ['products', 'product_grades', 'tare_types'];

  it.each(tables)('creates the %s table', async (table) => {
    const [row] = await ds.query(`SELECT to_regclass($1) IS NOT NULL AS present`, [
      `public.${table}`,
    ]);
    expect(row.present).toBe(true);
  });

  const insertProduct = async (name: string): Promise<string> => {
    const [row] = await ds.query(`INSERT INTO products (name) VALUES ($1) RETURNING id`, [name]);
    return row.id;
  };

  it('rejects a product whose name differs only by case', async () => {
    const name = `Малина-${randomUUID()}`;
    await insertProduct(name);
    await expect(insertProduct(name.toLowerCase())).rejects.toThrow(/duplicate key/i);
  });

  it('keeps the capitalization exactly as written', async () => {
    const name = `Ожина-${randomUUID()}`;
    const id = await insertProduct(name);
    const [row] = await ds.query(`SELECT name FROM products WHERE id = $1`, [id]);
    expect(row.name).toBe(name);
  });

  it('rejects a grade whose name differs only by case WITHIN one product', async () => {
    const productId = await insertProduct(`Смородина-${randomUUID()}`);
    await ds.query(`INSERT INTO product_grades (product_id, name) VALUES ($1, '1 сорт')`, [
      productId,
    ]);
    await expect(
      ds.query(`INSERT INTO product_grades (product_id, name) VALUES ($1, '1 СОРТ')`, [productId]),
    ).rejects.toThrow(/duplicate key/i);
  });

  it('allows the same grade name under two different products', async () => {
    const first = await insertProduct(`Аґрус-${randomUUID()}`);
    const second = await insertProduct(`Порічка-${randomUUID()}`);
    await ds.query(`INSERT INTO product_grades (product_id, name) VALUES ($1, 'Екстра')`, [first]);
    await expect(
      ds.query(`INSERT INTO product_grades (product_id, name) VALUES ($1, 'Екстра')`, [second]),
    ).resolves.toBeDefined();
  });

  it('rejects a grade pointing at no product', async () => {
    await expect(
      ds.query(`INSERT INTO product_grades (product_id, name) VALUES ($1, '1 сорт')`, [
        randomUUID(),
      ]),
    ).rejects.toThrow(/foreign key/i);
  });

  const insertTare = (name: string, weight: string, deposit: string) =>
    ds.query(
      `INSERT INTO tare_types (name, weight_kg, deposit_price) VALUES ($1, $2, $3) RETURNING id`,
      [name, weight, deposit],
    );

  it('rejects a tare type whose name differs only by case', async () => {
    const name = `Ящик-${randomUUID()}`;
    await insertTare(name, '1.20', '120.00');
    await expect(insertTare(name.toLowerCase(), '1.20', '120.00')).rejects.toThrow(
      /duplicate key/i,
    );
  });

  it('permits a zero weight and a zero deposit', async () => {
    await expect(insertTare(`Відро-${randomUUID()}`, '0.00', '0.00')).resolves.toBeDefined();
  });

  it('rejects a negative weight', async () => {
    await expect(insertTare(`Bad-w-${randomUUID()}`, '-1.00', '0.00')).rejects.toThrow(
      /CHK_tare_types_weight_kg/,
    );
  });

  it('rejects a negative deposit', async () => {
    await expect(insertTare(`Bad-d-${randomUUID()}`, '0.00', '-1.00')).rejects.toThrow(
      /CHK_tare_types_deposit_price/,
    );
  });

  it('returns numeric columns as strings, never numbers', async () => {
    const [row] = await insertTare(`Чешка-${randomUUID()}`, '0.85', '95.50');
    const [read] = await ds.query(
      `SELECT weight_kg, deposit_price FROM tare_types WHERE id = $1`,
      [row.id],
    );
    expect(typeof read.weight_kg).toBe('string');
    expect(read.weight_kg).toBe('0.85');
    expect(read.deposit_price).toBe('95.50');
  });

  it('no longer carries the case-sensitive point-name constraint', async () => {
    const [row] = await ds.query(
      `SELECT COUNT(*)::int AS n FROM pg_constraint WHERE conname = 'UQ_collection_points_name'`,
    );
    expect(row.n).toBe(0);
  });

  it('rejects a collection point whose name differs only by case', async () => {
    const name = `Копайгород-${randomUUID()}`;
    await ds.query(`INSERT INTO collection_points (name, code) VALUES ($1, $2)`, [
      name,
      pointCode(),
    ]);
    await expect(
      ds.query(`INSERT INTO collection_points (name, code) VALUES ($1, $2)`, [
        name.toLowerCase(),
        pointCode(),
      ]),
    ).rejects.toThrow(/duplicate key/i);
  });
});

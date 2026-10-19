import { randomUUID } from 'crypto';
import { DataSource, QueryRunner } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { CollectionPoint } from '../collection-points/collection-point.entity';
import { PointKind } from '../collection-points/point-kind.enum';
import { User } from '../users/user.entity';
import { UserRole } from '../users/user-role.enum';
import { PointAndUserNumbers1788600000024 } from './1788600000024-PointAndUserNumbers';

/**
 * #145 — `collection_points.number` / `users.number`: the backfill in creation order, the
 * sequence continuing past it, and `ALWAYS` refusing a typed number. A fresh test database
 * migrates an empty `collection_points` and a one-row `users`, so only a replay over real rows
 * — `down()`, fixtures, `up()` — reaches the path production takes.
 */
describe('collection_points.number and users.number (Postgres)', () => {
  let ds: DataSource;
  const migration = new PointAndUserNumbers1788600000024();
  // Later than anything else in the database, so the fixtures take the highest numbers.
  const at = (minute: number) => `2099-01-01T10:${String(minute).padStart(2, '0')}:00Z`;
  const code = () => `N${randomUUID().slice(0, 6).toUpperCase()}`;

  const point = (q: QueryRunner, t: number, id?: string) =>
    q
      .query(
        `INSERT INTO collection_points (id, name, code, kind, created_at)
         VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, 'reception', $4) RETURNING id`,
        [id ?? null, `Точка ${randomUUID().slice(0, 8)}`, code(), at(t)],
      )
      .then((rows: { id: string }[]) => rows[0].id);
  const owner = (q: QueryRunner, t: number) =>
    q
      .query(
        `INSERT INTO users (first_name, last_name, role, created_at)
         VALUES ('Тест', $1, 'network_owner', $2) RETURNING id`,
        [`Власник ${randomUUID().slice(0, 8)}`, at(t)],
      )
      .then((rows: { id: string }[]) => rows[0].id);
  const numberOf = async (table: string, id: string) =>
    ((await ds.query(`SELECT "number" FROM "${table}" WHERE id = $1`, [id])) as { number: number }[])[0]
      .number;
  const max = async (table: string) =>
    ((await ds.query(`SELECT MAX("number")::int AS n FROM "${table}"`)) as { n: number }[])[0].n;

  /** `down()`, fixtures through `seed`, `up()`; the schema is always restored. */
  const replay = async <T>(seed: (q: QueryRunner) => Promise<T>): Promise<T> => {
    const qr = ds.createQueryRunner();
    try {
      await migration.down(qr);
      try {
        return await seed(qr);
      } finally {
        await migration.up(qr);
      }
    } finally {
      await qr.release();
    }
  };

  beforeAll(async () => {
    ds = await openTestDataSource();
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('numbers existing points in creation order, an id breaking a created_at tie', async () => {
    // Inserted out of order; the two at minute 1 share a created_at, so `id` decides.
    const [late, tieHigh, tieLow] = await replay(async (q) => [
      await point(q, 2),
      await point(q, 1, 'ffffffff-0000-4000-8000-000000000000'),
      await point(q, 1, '00000000-0000-4000-8000-000000000000'),
    ]);

    const top = await max('collection_points');
    expect(await numberOf('collection_points', tieLow)).toBe(top - 2);
    expect(await numberOf('collection_points', tieHigh)).toBe(top - 1);
    expect(await numberOf('collection_points', late)).toBe(top);
  });

  it('numbers existing users in creation order', async () => {
    const [second, first] = await replay(async (q) => [await owner(q, 5), await owner(q, 4)]);

    const top = await max('users');
    expect(await numberOf('users', first)).toBe(top - 1);
    expect(await numberOf('users', second)).toBe(top);
  });

  it('gives a point created after the backfill the next number, not a taken one', async () => {
    await replay(async (q) => {
      await point(q, 6);
      await point(q, 7);
    });
    const top = await max('collection_points');

    const created = await ds.getRepository(CollectionPoint).save({
      name: `Нова ${randomUUID().slice(0, 8)}`,
      code: code(),
      kind: PointKind.Reception,
    });

    expect(created.number).toBe(top + 1);
  });

  it('gives a user created after the backfill the next number', async () => {
    await replay(async (q) => {
      await owner(q, 8);
    });
    const top = await max('users');

    const created = await ds.getRepository(User).save({
      first_name: 'Новий',
      last_name: randomUUID().slice(0, 8),
      role: UserRole.NetworkOwner,
    });

    expect(created.number).toBe(top + 1);
  });

  it('refuses a typed number — ALWAYS, so no insert can leave the sequence behind', async () => {
    await expect(
      ds.query(
        `INSERT INTO collection_points (name, code, kind, number) VALUES ($1, $2, 'reception', 999999)`,
        [`Ручна ${randomUUID().slice(0, 8)}`, code()],
      ),
    ).rejects.toThrow(/non-DEFAULT value into column "number"/);
    await expect(
      ds.query(
        `INSERT INTO users (first_name, last_name, role, number) VALUES ('Ручний', $1, 'network_owner', 999999)`,
        [randomUUID().slice(0, 8)],
      ),
    ).rejects.toThrow(/non-DEFAULT value into column "number"/);
  });

  it('keeps the column NOT NULL and UNIQUE on both tables', async () => {
    const rows = (await ds.query(
      `SELECT c.table_name, c.is_nullable, c.identity_generation,
              EXISTS (SELECT 1 FROM pg_constraint k
                       WHERE k.conname = 'UQ_' || c.table_name || '_number' AND k.contype = 'u') AS uq
         FROM information_schema.columns c
        WHERE c.column_name = 'number' AND c.table_name IN ('collection_points', 'users')
        ORDER BY c.table_name`,
    )) as { table_name: string; is_nullable: string; identity_generation: string; uq: boolean }[];

    expect(rows).toEqual([
      { table_name: 'collection_points', is_nullable: 'NO', identity_generation: 'ALWAYS', uq: true },
      { table_name: 'users', is_nullable: 'NO', identity_generation: 'ALWAYS', uq: true },
    ]);
  });
});

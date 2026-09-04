import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { User } from '../users/user.entity';
import { UserIdentity } from '../users/user-identity.entity';

describe('InitialSchema', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = await openTestDataSource();
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  const tables = ['users', 'user_identities', 'user_credentials', 'audit_log', 'media_files'];

  it.each(tables)('creates the %s table', async (table) => {
    const [row] = await ds.query(
      `SELECT to_regclass($1) IS NOT NULL AS present`,
      [`public.${table}`],
    );
    expect(row.present).toBe(true);
  });

  it('enforces one identity per (provider, provider_user_id)', async () => {
    const [user] = await ds.query(
      `INSERT INTO users (display_name) VALUES ('dupe') RETURNING id`,
    );
    await ds.query(
      `INSERT INTO user_identities (provider, provider_user_id, "user_id") VALUES ('local', 'taken', $1)`,
      [user.id],
    );

    await expect(
      ds.query(
        `INSERT INTO user_identities (provider, provider_user_id, "user_id") VALUES ('local', 'taken', $1)`,
        [user.id],
      ),
    ).rejects.toThrow(/duplicate key/);
  });

  it('cascades credentials away when the user is deleted', async () => {
    const [user] = await ds.query(
      `INSERT INTO users (display_name) VALUES ('cascade') RETURNING id`,
    );
    await ds.query(`INSERT INTO user_credentials (user_id, password) VALUES ($1, 'pw')`, [user.id]);

    await ds.query(`DELETE FROM users WHERE id = $1`, [user.id]);

    const rows = await ds.query(`SELECT 1 FROM user_credentials WHERE user_id = $1`, [user.id]);
    expect(rows).toHaveLength(0);
  });

  it('refuses to delete a user who is an audit actor', async () => {
    const [user] = await ds.query(
      `INSERT INTO users (display_name) VALUES ('actor') RETURNING id`,
    );
    await ds.query(`INSERT INTO audit_log (action, actor_id) VALUES ('user.logged-in', $1)`, [
      user.id,
    ]);

    await expect(ds.query(`DELETE FROM users WHERE id = $1`, [user.id])).rejects.toThrow(
      /violates foreign key constraint/,
    );
  });

  // Proves the entity metadata actually agrees with the DDL above: a raw-SQL
  // insert can succeed against a column name TypeORM itself would never emit
  // (e.g. it wouldn't catch a "userId" vs "user_id" mismatch). Only a save/find
  // through the repositories forces TypeORM to generate SQL against the exact
  // columns UserIdentity's @JoinColumn and User's mapping expect.
  it('round-trips a User and its UserIdentity through the TypeORM repositories', async () => {
    const userRepo = ds.getRepository(User);
    const identityRepo = ds.getRepository(UserIdentity);

    const savedUser = await userRepo.save(
      userRepo.create({ display_name: 'Round Trip', is_active: true }),
    );

    const savedIdentity = await identityRepo.save(
      identityRepo.create({
        provider: 'local',
        provider_user_id: 'round-trip',
        user: savedUser,
      }),
    );

    const foundIdentity = await identityRepo.findOne({
      where: { id: savedIdentity.id },
      relations: { user: true },
    });

    expect(foundIdentity).not.toBeNull();
    expect(foundIdentity?.user.id).toBe(savedUser.id);
    expect(foundIdentity?.provider_user_id).toBe('round-trip');
  });
});

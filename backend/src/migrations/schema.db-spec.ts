import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { User } from '../users/user.entity';
import { UserIdentity } from '../users/user-identity.entity';
import { CollectionPoint } from '../collection-points/collection-point.entity';
import { PointKind } from '../collection-points/point-kind.enum';
import { UserRole } from '../users/user-role.enum';

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

  // A UNIQUE value per RUN, not a literal. `app_test` persists between runs and
  // this suite deliberately never truncates (see db-harness.ts), so a fixed
  // 'taken' passes on a fresh database and then fails on every later run — with
  // a duplicate-key error that looks exactly like the one being asserted, from
  // the WRONG insert. pipeline.db-spec.ts already documents this convention.
  it('enforces one identity per (provider, provider_user_id)', async () => {
    const providerUserId = `taken-${randomUUID()}`;
    const [user] = await ds.query(
      `INSERT INTO users (first_name, last_name, role) VALUES ('Dupe', 'User', 'network_owner') RETURNING id`,
    );
    await ds.query(
      `INSERT INTO user_identities (provider, provider_user_id, "user_id") VALUES ('local', $1, $2)`,
      [providerUserId, user.id],
    );

    await expect(
      ds.query(
        `INSERT INTO user_identities (provider, provider_user_id, "user_id") VALUES ('local', $1, $2)`,
        [providerUserId, user.id],
      ),
    ).rejects.toThrow(/duplicate key/);
  });

  it('cascades credentials away when the user is deleted', async () => {
    const [user] = await ds.query(
      `INSERT INTO users (first_name, last_name, role) VALUES ('Cascade', 'User', 'network_owner') RETURNING id`,
    );
    await ds.query(`INSERT INTO user_credentials (user_id, password_hash) VALUES ($1, 'pw')`, [user.id]);

    await ds.query(`DELETE FROM users WHERE id = $1`, [user.id]);

    const rows = await ds.query(`SELECT 1 FROM user_credentials WHERE user_id = $1`, [user.id]);
    expect(rows).toHaveLength(0);
  });

  it('refuses to delete a user who is an audit actor', async () => {
    const [user] = await ds.query(
      `INSERT INTO users (first_name, last_name, role) VALUES ('Actor', 'User', 'network_owner') RETURNING id`,
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
      userRepo.create({
        first_name: 'Round',
        last_name: 'Trip',
        role: UserRole.NetworkOwner,
        is_active: true,
      }),
    );

    // Unique per run, for the reason documented on the duplicate-key test above.
    const providerUserId = `round-trip-${randomUUID()}`;
    const savedIdentity = await identityRepo.save(
      identityRepo.create({
        provider: 'local',
        provider_user_id: providerUserId,
        user: savedUser,
      }),
    );

    const foundIdentity = await identityRepo.findOne({
      where: { id: savedIdentity.id },
      relations: { user: true },
    });

    expect(foundIdentity).not.toBeNull();
    expect(foundIdentity?.user.id).toBe(savedUser.id);
    expect(foundIdentity?.provider_user_id).toBe(providerUserId);
  });
});

describe('YagodaFoundation', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = await openTestDataSource();
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  const point = async (name: string): Promise<string> => {
    const [row] = await ds.query(`INSERT INTO collection_points (name) VALUES ($1) RETURNING id`, [
      name,
    ]);
    return row.id;
  };

  it('creates the collection_points table', async () => {
    const [row] = await ds.query(`SELECT to_regclass('public.collection_points') IS NOT NULL AS present`);
    expect(row.present).toBe(true);
  });

  it.each(['user_role', 'point_kind'])('creates the %s enum type', async (typeName) => {
    const [row] = await ds.query(`SELECT to_regtype($1) IS NOT NULL AS present`, [typeName]);
    expect(row.present).toBe(true);
  });

  it('rejects a value outside the user_role enum', async () => {
    await expect(
      ds.query(`INSERT INTO users (first_name, last_name, role) VALUES ('X', 'Y', 'point_manager')`),
    ).rejects.toThrow(/invalid input value for enum/);
  });

  // A unique name per run: `app_test` persists between runs and is never
  // truncated, so a fixed literal would fail with "duplicate key" on the
  // SECOND run for the wrong reason. Same convention as pipeline.db-spec.ts.
  it('enforces one collection point per name', async () => {
    const name = `Копайгород-${randomUUID()}`;
    await point(name);
    await expect(point(name)).rejects.toThrow(/duplicate key/);
  });

  // §6.9 and §7.10: an unset target means "not known", NOT zero. A default of 0
  // would make the two indistinguishable; this asserts the column really does
  // come back NULL rather than 0.
  it('leaves both targets NULL when they are not given', async () => {
    const id = await point(`no-targets-${Date.now()}`);
    const [row] = await ds.query(
      `SELECT target_cash, target_crates FROM collection_points WHERE id = $1`,
      [id],
    );
    expect(row.target_cash).toBeNull();
    expect(row.target_crates).toBeNull();
  });

  it.each([
    ['target_cash', "'-1'"],
    ['target_crates', '-1'],
  ])('rejects a negative %s', async (column, value) => {
    await expect(
      ds.query(
        `INSERT INTO collection_points (name, ${column}) VALUES ('neg-${column}', ${value})`,
      ),
    ).rejects.toThrow(/violates check constraint/);
  });

  it('refuses a point_operator with no collection point', async () => {
    await expect(
      ds.query(`INSERT INTO users (first_name, last_name, role) VALUES ('No', 'Point', 'point_operator')`),
    ).rejects.toThrow(/violates check constraint "CHK_users_role_point"/);
  });

  it('refuses a network_owner pinned to a collection point', async () => {
    const pointId = await point(`owner-pinned-${Date.now()}`);
    await expect(
      ds.query(
        `INSERT INTO users (first_name, last_name, role, collection_point_id)
         VALUES ('Pinned', 'Owner', 'network_owner', $1)`,
        [pointId],
      ),
    ).rejects.toThrow(/violates check constraint "CHK_users_role_point"/);
  });

  it('accepts a point_operator that has a collection point', async () => {
    const pointId = await point(`operator-home-${Date.now()}`);
    const [row] = await ds.query(
      `INSERT INTO users (first_name, last_name, role, collection_point_id)
       VALUES ('Оксана', 'Приймальник', 'point_operator', $1) RETURNING id`,
      [pointId],
    );
    expect(row.id).toEqual(expect.any(String));
  });

  it('refuses to delete a collection point that still has a user', async () => {
    const pointId = await point(`restricted-${Date.now()}`);
    await ds.query(
      `INSERT INTO users (first_name, last_name, role, collection_point_id)
       VALUES ('Held', 'Back', 'point_operator', $1)`,
      [pointId],
    );
    await expect(ds.query(`DELETE FROM collection_points WHERE id = $1`, [pointId])).rejects.toThrow(
      /violates foreign key constraint/,
    );
  });

  it('renamed the credential column and dropped display_name', async () => {
    const columns = await ds.query(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (table_name, column_name) IN (
            ('user_credentials','password'), ('user_credentials','password_hash'), ('users','display_name')
          )`,
    );
    const found = columns.map((c: { table_name: string; column_name: string }) =>
      `${c.table_name}.${c.column_name}`,
    );
    expect(found).toEqual(['user_credentials.password_hash']);
  });

  it('stores instants as timestamptz on the reshaped tables', async () => {
    const rows = await ds.query(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name IN ('created_at','updated_at')
          AND table_name IN ('users','user_identities','collection_points')`,
    );
    expect(rows).not.toHaveLength(0);
    for (const row of rows) expect(row.data_type).toBe('timestamp with time zone');
  });

  // Proves the entity metadata agrees with the hand-written DDL — a raw insert
  // above would still pass against a column TypeORM itself would never emit.
  it('round-trips a CollectionPoint and an operator through the repositories', async () => {
    const pointRepo = ds.getRepository(CollectionPoint);
    const userRepo = ds.getRepository(User);

    const savedPoint = await pointRepo.save(
      pointRepo.create({
        name: `round-trip-${Date.now()}`,
        kind: PointKind.Base,
        target_cash: '1500.00',
        target_crates: 800,
      }),
    );
    // A SECOND point, so the null case and the string case are both covered by
    // this test: the assertions below need one point with a target_cash and one
    // without, and `target_cash` cannot be both at once.
    const savedEmptyPoint = await pointRepo.save(
      pointRepo.create({ name: `round-trip-empty-${Date.now()}` }),
    );
    const savedUser = await userRepo.save(
      userRepo.create({
        first_name: 'Round',
        last_name: 'Trip',
        role: UserRole.PointOperator,
        collection_point_id: savedPoint.id,
      }),
    );

    const found = await userRepo.findOne({ where: { id: savedUser.id } });
    expect(found?.role).toBe(UserRole.PointOperator);
    expect(found?.collection_point_id).toBe(savedPoint.id);

    const foundPoint = await pointRepo.findOne({ where: { id: savedPoint.id } });
    // numeric arrives as a STRING, and is expected to: see the spec's §5.1.
    // Money must never pass through a binary float, so this asserts the exact
    // string rather than a loose equality — `toBe('1500.00')` fails for the
    // number 1500, which is the regression a number-converting transformer
    // would introduce. If this ever comes back as a number, the fix is to
    // remove the transformer, NOT to relax the assertion.
    expect(foundPoint?.target_cash).toBe('1500.00');
    expect(typeof foundPoint?.target_cash).toBe('string');
    expect(foundPoint?.target_crates).toBe(800);
    expect(foundPoint?.kind).toBe(PointKind.Base);

    // …and an unset target is NULL, not 0 and not '0.00' — §6.9/§7.10 depend on
    // the two being distinguishable.
    const foundEmptyPoint = await pointRepo.findOne({ where: { id: savedEmptyPoint.id } });
    expect(foundEmptyPoint?.target_cash).toBeNull();
    expect(foundEmptyPoint?.target_crates).toBeNull();
  });
});

describe('BootstrapOwner', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = await openTestDataSource();
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  // The test database is not empty (SeedDevAdmin ran), and BOOTSTRAP_OWNER_*
  // is unset here. Both are reasons to no-op, and this asserts the migration
  // took neither as licence to invent an account.
  it('creates no owner when the users table is not empty', async () => {
    const rows = await ds.query(
      `SELECT 1 FROM user_identities WHERE provider = 'local' AND provider_user_id = 'bootstrap-owner'`,
    );
    expect(rows).toHaveLength(0);
  });

  it('left the dev admin as a usable network owner', async () => {
    const [row] = await ds.query(
      `SELECT u.role, u.collection_point_id, c.password_hash
         FROM user_identities i
         JOIN users u ON u.id = i.user_id
         JOIN user_credentials c ON c.user_id = u.id
        WHERE i.provider = 'local' AND i.provider_user_id = 'admin'`,
    );
    expect(row.role).toBe('network_owner');
    expect(row.collection_point_id).toBeNull();
    // The migration re-hashed the plain-text seed value in place.
    expect(row.password_hash.startsWith('scrypt$')).toBe(true);
  });
});

describe('IndexUserIdentityUser', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = await openTestDataSource();
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  // JwtStrategy.validate() runs findAuthContext (filtered on provider +
  // user_id) on EVERY authenticated request; without this index that lookup
  // is a sequential scan pretending to be indexed.
  it('indexes user_identities(user_id)', async () => {
    const [row] = await ds.query(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename = 'user_identities' AND indexname = 'IDX_user_identities_user'`,
    );
    expect(row?.indexdef).toContain('(user_id)');
  });
});

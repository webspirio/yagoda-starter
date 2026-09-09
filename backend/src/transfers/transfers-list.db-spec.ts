import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { Transfer } from './transfer.entity';
import { TransfersService } from './transfers.service';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * THE DATE FILTER, AGAINST A REAL POSTGRES. The unit spec can assert that the
 * clause CONTAINS `AT TIME ZONE`; only this one can assert that the statement
 * parses at all and that it puts the evening runs on the right day.
 *
 * Two things here have never been exercised by a mocked builder: `AT TIME ZONE`
 * is overloaded on `text` and `interval`, so an untyped placeholder is an
 * ambiguity error rather than a wrong answer; and TypeORM's textual `:name`
 * scan is what forces the ANSI `CAST(... AS ...)` form over `::`.
 *
 * THE ZONE IS PINNED to `Europe/Kyiv` and the session's is left alone. That IS
 * the test: in September, Kyiv is UTC+3, so 01:00 local on the 10th is stored
 * as `2026-09-09T22:00Z`. A filter resolving in the session zone (UTC here)
 * files that transfer on the 9th — spec §4 says it belongs to the 10th.
 */
describe('TransfersService.list date filter (Postgres)', () => {
  let ds: DataSource;
  let service: TransfersService;
  let pointId: string;
  let ownerId: string;

  const owner: AuthenticatedUser = {
    sub: 'placeholder',
    username: 'owner',
    role: UserRole.NetworkOwner,
    collection_point_id: null,
  };

  const query = (over: Record<string, unknown> = {}) => ({
    page: 1,
    limit: 50,
    include_voided: false,
    collection_point_id: pointId,
    ...over,
  });

  beforeAll(async () => {
    ds = await openTestDataSource();
    service = new TransfersService(
      ds.getRepository(Transfer),
      // `list` reads none of these: no point lookup, no audit entry, no clock,
      // no transaction. Only the repository and the timezone are live.
      {} as never,
      {} as never,
      {} as never,
      ds,
      { appTimezone: 'Europe/Kyiv' },
    );

    const tag = randomUUID().slice(0, 8);
    [{ id: ownerId }] = (await ds.query(
      `INSERT INTO users (first_name, last_name, role, is_active)
       VALUES ('Тест', $1, 'network_owner', true) RETURNING id`,
      [`Owner tz ${tag}`],
    )) as { id: string }[];
    owner.sub = ownerId;

    [{ id: pointId }] = (await ds.query(
      `INSERT INTO collection_points (name, code, kind, is_active)
       VALUES ($1, $2, 'reception', true) RETURNING id`,
      [`Точка ${tag}`, `Z${tag.slice(0, 6).toUpperCase()}`],
    )) as { id: string }[];

    // 01:00 on the 10th in Kyiv. Stored 22:00Z on the 9th — the whole hazard.
    await ds.query(
      `INSERT INTO transfers (collection_point_id, cash, crates, carrier, sent_by_user_id,
                              sent_at, status)
       VALUES ($1, '1000.00', 0, 'Іван', $2, '2026-09-09T22:00:00Z', 'sent')`,
      [pointId, ownerId],
    );
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it('files a 01:00-local dispatch on ITS OWN local day, not the UTC one', async () => {
    const page = await service.list(owner, query({ from: '2026-09-10', to: '2026-09-10' }) as never);
    expect(page.total).toBe(1);
  });

  it('does NOT file it on the previous day, which is where UTC would put it', async () => {
    const page = await service.list(owner, query({ from: '2026-09-09', to: '2026-09-09' }) as never);
    expect(page.total).toBe(0);
  });

  it('the upper bound is INCLUSIVE — a range ending on the send day still finds it', async () => {
    const page = await service.list(owner, query({ from: '2026-09-01', to: '2026-09-10' }) as never);
    expect(page.total).toBe(1);
  });

  it('each bound parses on its own — the statement is valid with only one given', async () => {
    await expect(
      service.list(owner, query({ from: '2026-09-10' }) as never),
    ).resolves.toMatchObject({ total: 1 });
    await expect(service.list(owner, query({ to: '2026-09-09' }) as never)).resolves.toMatchObject({
      total: 0,
    });
  });
});

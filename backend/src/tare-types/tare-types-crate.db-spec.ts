import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { TareTypesService } from './tare-types.service';
import { TareType } from './tare-type.entity';
import { AuditService } from '../audit/audit.service';
import { AuditLog } from '../audit/audit-log.entity';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * UNVERIFIED AT WRITE TIME — no Postgres was reachable in this environment
 * (see `crates-schema.db-spec.ts`'s own header for the same constraint). This
 * spec MUST be run — `npm run test:db -w backend -- tare-types-crate` — and
 * pass before this slice merges.
 *
 * THE REGRESSION THIS FILE GUARDS: `UQ_tare_types_single_crate`
 * (`1788600000012-YagodaCrates.ts`) is a BARE unique index — Postgres checks
 * it at the end of each statement, not at commit, because it carries no
 * `DEFERRABLE INITIALLY DEFERRED`. `TareTypesService.update`/`.create`
 * therefore MUST demote every other flagged row BEFORE they save/insert the
 * one being flagged, inside the same transaction — demoting after would let
 * the save/insert itself collide with the still-flagged row and abort with
 * `23505` before the demotion ever ran, leaving the owner permanently unable
 * to switch crate types. A mocked `*.spec.ts` can assert the demotion query
 * was issued and even assert it ran before the save (see
 * `tare-types.service.spec.ts`), but it cannot prove Postgres actually
 * enforces the index the way this file assumes — only a real unique index,
 * hit by a real second statement inside a real transaction, can.
 */
describe('TareTypesService — one crate type, against a real unique index', () => {
  let ds: DataSource;
  let service: TareTypesService;
  // `is_crate` is one flag across the WHOLE table — a per-run uuid on a row's
  // NAME cannot isolate it the way it isolates every other fixture in this
  // repo. `app_test` is never truncated, so whichever row (if any) was
  // flagged before this suite ran is state this suite does not own; capture
  // it here and restore it in `afterAll` rather than clearing every flag and
  // leaving the table with none — `dev-seed.ts`'s crate step depends on
  // exactly one row being flagged, and a suite that runs after this one and
  // relies on that (directly or via a leftover from a previous run) must find
  // the table exactly as this suite found it.
  let originalCrateId: string | null;
  const createdIds: string[] = [];

  const owner: AuthenticatedUser = {
    sub: '',
    username: 'owner',
    role: UserRole.NetworkOwner,
    collection_point_id: null,
  };

  beforeAll(async () => {
    ds = await openTestDataSource();
    service = new TareTypesService(
      ds.getRepository(TareType),
      ds,
      new AuditService(ds.getRepository(AuditLog)),
    );

    const [user] = await ds.query(`SELECT id FROM users WHERE role = 'network_owner' LIMIT 1`);
    owner.sub = user.id;

    const [existing] = await ds.query(`SELECT id FROM tare_types WHERE is_crate = true LIMIT 1`);
    originalCrateId = existing?.id ?? null;
  });

  afterAll(async () => {
    // Remove only the rows this suite created — never anything it merely
    // flagged or unflagged — then put the flag back where it was.
    if (createdIds.length > 0) {
      await ds.query(`DELETE FROM tare_types WHERE id = ANY($1::uuid[])`, [createdIds]);
    }
    await ds.query(`UPDATE tare_types SET is_crate = false WHERE is_crate`);
    if (originalCrateId) {
      await ds.query(`UPDATE tare_types SET is_crate = true WHERE id = $1`, [originalCrateId]);
    }
    await ds?.destroy();
  });

  /** Clears every existing flag and inserts two fresh, unflagged rows. */
  const twoTareTypes = async (): Promise<{ aId: string; bId: string }> => {
    const tag = randomUUID().slice(0, 8);
    await ds.query(`UPDATE tare_types SET is_crate = false`);
    const [a] = await ds.query(
      `INSERT INTO tare_types (name, weight_kg, deposit_price, is_crate)
       VALUES ($1, '1.20', '120.00', true) RETURNING id`,
      [`Ящик ${tag}`],
    );
    const [b] = await ds.query(
      `INSERT INTO tare_types (name, weight_kg, deposit_price, is_crate)
       VALUES ($1, '2.00', '20.00', false) RETURNING id`,
      [`Чешка ${tag}`],
    );
    createdIds.push(a.id, b.id);
    return { aId: a.id, bId: b.id };
  };

  it('flagging row B through the service succeeds while row A is still flagged, and leaves exactly one flagged row', async () => {
    const { aId, bId } = await twoTareTypes();

    await expect(service.update(owner, bId, { is_crate: true })).resolves.toBeDefined();

    const flagged = await ds.query(`SELECT id FROM tare_types WHERE is_crate = true`);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].id).toBe(bId);

    const [reloadedA] = await ds.query(`SELECT is_crate FROM tare_types WHERE id = $1`, [aId]);
    expect(reloadedA.is_crate).toBe(false);
  });

  it('creating a new flagged row through the service succeeds while another row is still flagged, and leaves exactly one flagged row', async () => {
    const tag = randomUUID().slice(0, 8);
    await ds.query(`UPDATE tare_types SET is_crate = false`);
    const [existing] = await ds.query(
      `INSERT INTO tare_types (name, weight_kg, deposit_price, is_crate)
       VALUES ($1, '1.20', '120.00', true) RETURNING id`,
      [`Ящик ${tag}`],
    );
    createdIds.push(existing.id);

    const created = await service.create(owner, {
      name: `Новий ящик ${tag}`,
      weight_kg: '1.30',
      deposit_price: '130.00',
      is_crate: true,
    });
    createdIds.push(created.id);

    const flagged = await ds.query(`SELECT id FROM tare_types WHERE is_crate = true`);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].id).toBe(created.id);

    const [reloadedExisting] = await ds.query(`SELECT is_crate FROM tare_types WHERE id = $1`, [
      existing.id,
    ]);
    expect(reloadedExisting.is_crate).toBe(false);
  });
});

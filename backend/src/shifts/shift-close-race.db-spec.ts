import { randomUUID } from 'crypto';
import { ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { ShiftsService } from './shifts.service';
import { Shift } from './shift.entity';
import { AuditService } from '../audit/audit.service';
import { AuditLog } from '../audit/audit-log.entity';
import { TimeService } from '../time/time.service';
import { CrateStockGuard } from '../crate-stock/crate-stock.guard';
import { PointCashService } from '../point-cash/point-cash.service';
import type { CollectionPointsService } from '../collection-points/collection-points.service';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * TWO CLOSES ARRIVING AT ONCE, and two reopens after them.
 *
 * A double-tapped button on a flaky connection is the realistic source, and
 * before this spec `close` read `shift.closed_at` OUTSIDE the transaction it
 * then opened: both requests saw `null`, both entered, and the loser's INSERT
 * hit `UQ_cash_counts_shift_book_kind` as a bare 23505. That constraint is not
 * one of the two `translateUniqueViolation` knows, so it fell through to
 * `AllExceptionsFilter` as a **500** — on the flagship money path, where every
 * sibling write in this slice (`TransfersService.transition`,
 * `VoidPayoutCommand.void`) takes `pessimistic_write` and re-checks state under
 * the lock, returning a 409.
 *
 * WHAT THE LOCK BUYS, precisely: the loser BLOCKS until the winner commits,
 * then re-reads the row it locked and sees `closed_at` set. The 409 is
 * produced by the same branch that produces it for a sequential second close,
 * which is the property worth having — one code path, not two.
 *
 * WHY THIS IS A DB-SPEC AND NOT A UNIT SPEC: the whole subject is what two
 * Postgres transactions do to each other. A mocked repository cannot block on
 * a row lock, so a unit spec asserting this would be asserting its own mock.
 *
 * `CollectionPointsService` is `null` for the reason `shift-close.db-spec.ts`
 * sets out at length: `ShiftsService` injects it and never calls it.
 */
describe('ShiftsService close/reopen under concurrency (Postgres)', () => {
  let ds: DataSource;
  let service: ShiftsService;
  let owner: AuthenticatedUser;
  let operator: AuthenticatedUser;
  let pointId: string;

  beforeAll(async () => {
    ds = await openTestDataSource();
    service = new ShiftsService(
      ds.getRepository(Shift),
      null as unknown as CollectionPointsService,
      new AuditService(ds.getRepository(AuditLog)),
      new TimeService({ appTimezone: 'Europe/Kyiv' }),
      ds,
      new PointCashService(ds, { appTimezone: 'Europe/Kyiv' }),
      new CrateStockGuard(),
    );

    const run = randomUUID().slice(0, 8);
    // A FRESH POINT per run — `UQ_shifts_point_business_date` allows one shift
    // per point per day, so a shared point makes the second run of the day red.
    [{ id: pointId }] = (await ds.query(
      `INSERT INTO collection_points (name, code, kind, is_active)
       VALUES ($1, $2, 'reception', true) RETURNING id`,
      [`Точка ${run}`, `R${run.slice(0, 6).toUpperCase()}`],
    )) as { id: string }[];

    const [{ id: ownerId }] = (await ds.query(
      `INSERT INTO users (first_name, last_name, role, is_active)
       VALUES ('Тест', $1, 'network_owner', true) RETURNING id`,
      [`Owner ${run}`],
    )) as { id: string }[];
    owner = {
      sub: ownerId,
      username: `owner-${run}`,
      role: UserRole.NetworkOwner,
      collection_point_id: null,
    };

    const [{ id: operatorId }] = (await ds.query(
      `INSERT INTO users (first_name, last_name, role, collection_point_id, is_active)
       VALUES ('Оксана', $1, 'point_operator', $2, true) RETURNING id`,
      [`Приймальник ${run}`, pointId],
    )) as { id: string }[];
    operator = {
      sub: operatorId,
      username: `oksana-${run}`,
      role: UserRole.PointOperator,
      collection_point_id: pointId,
    };
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  // Another backend waiting on a lock in a statement that reads `shifts` FOR
  // UPDATE — the close's `loadVisible`, not just any wait in the database.
  const blockedOnLock = async () => {
    const [{ n }] = (await ds.query(
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND wait_event_type = 'Lock'
          AND query ILIKE '%FROM "shifts"%FOR UPDATE%'`,
    )) as { n: number }[];
    return n > 0;
  };

  it('closes once and 409s the loser when two closes race', async () => {
    const shift = await service.open(operator, { counted_amount: '1000.00', counted_deposits: '0.00' });

    // Both promises are created before either is awaited, so the two
    // `close` calls are genuinely in flight together.
    const results = await Promise.allSettled([
      service.close(operator, shift.id, { counted_amount: '1000.00', counted_deposits: '0.00', broken_crates: 0 }),
      service.close(operator, shift.id, { counted_amount: '1000.00', counted_deposits: '0.00', broken_crates: 0 }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // THE ASSERTION THIS FILE EXISTS FOR: a 409 naming the situation, not the
    // 500 a raw 23505 becomes.
    const error = (rejected[0] as PromiseRejectedResult).reason as ConflictException;
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ code: 'SHIFT_ALREADY_CLOSED' });

    // One physical close, one closing count — the drawer was counted once.
    const rows = (await ds.query(
      `SELECT id FROM cash_counts WHERE shift_id = $1 AND kind = 'closing' AND book = 'berry'`,
      [shift.id],
    )) as { id: string }[];
    expect(rows).toHaveLength(1);

    const audits = (await ds.query(
      `SELECT id FROM audit_log WHERE target_id = $1 AND action = 'shift.closed'`,
      [shift.id],
    )) as { id: string }[];
    expect(audits).toHaveLength(1);
  });

  // #178 review: a document write's open-shift check held no lock, so a close
  // committed between the check and the insert and the document landed 201 in
  // a closed shift. Under `FOR SHARE` the close waits for the write instead,
  // and a write after the close finds no open shift at all.
  it('makes a close wait for a document write that already found the shift open', async () => {
    const run = randomUUID().slice(0, 8);
    const [{ id: racePoint }] = (await ds.query(
      `INSERT INTO collection_points (name, code, kind, is_active)
       VALUES ($1, $2, 'reception', true) RETURNING id`,
      [`Точка ${run}`, `R${run.slice(0, 6).toUpperCase()}`],
    )) as { id: string }[];
    const raceOperator: AuthenticatedUser = { ...operator, collection_point_id: racePoint };
    const shift = await service.open(raceOperator, { counted_amount: '0.00', counted_deposits: '0.00' });

    const writer = ds.createQueryRunner();
    await writer.connect();
    await writer.startTransaction();
    try {
      const found = await service.findOpenAtPoint(racePoint, writer.manager);
      expect(found?.id).toBe(shift.id);

      let closed = false;
      const closing = service
        .close(raceOperator, shift.id, { counted_amount: '0.00', counted_deposits: '0.00', broken_crates: 0 })
        .then(() => (closed = true));
      // Wait until the close is SEEN blocked on a lock, or has finished. A
      // fixed sleep would pass for the wrong reason on a slow runner; this
      // fails by `closed` being true, never by timing.
      for (let i = 0; i < 100 && !closed && !(await blockedOnLock()); i++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(closed).toBe(false);
      expect(await blockedOnLock()).toBe(true);

      await writer.commitTransaction();
      await closing;
      expect(closed).toBe(true);
    } finally {
      if (writer.isTransactionActive) await writer.rollbackTransaction();
      await writer.release();
    }

    const late = ds.createQueryRunner();
    await late.connect();
    await late.startTransaction();
    try {
      await expect(service.findOpenAtPoint(racePoint, late.manager)).resolves.toBeNull();
    } finally {
      await late.rollbackTransaction();
      await late.release();
    }
  });

  // #178 second review: every void (crate issuance/return, receipt, payout)
  // reads its document's shift through `findOneRaw` inside its transaction and
  // decides from `closed_at` — a void the close overtook would land in a closed
  // shift whose crates count already expected the document live. Under
  // `FOR SHARE` the close waits for the void instead.
  it('makes a close wait for a void that already read the shift open', async () => {
    const run = randomUUID().slice(0, 8);
    const [{ id: racePoint }] = (await ds.query(
      `INSERT INTO collection_points (name, code, kind, is_active)
       VALUES ($1, $2, 'reception', true) RETURNING id`,
      [`Точка ${run}`, `R${run.slice(0, 6).toUpperCase()}`],
    )) as { id: string }[];
    const raceOperator: AuthenticatedUser = { ...operator, collection_point_id: racePoint };
    const shift = await service.open(raceOperator, { counted_amount: '0.00', counted_deposits: '0.00' });

    const voider = ds.createQueryRunner();
    await voider.connect();
    await voider.startTransaction();
    try {
      const found = await service.findOneRaw(shift.id, voider.manager);
      expect(found?.closed_at).toBeNull();

      let closed = false;
      const closing = service
        .close(raceOperator, shift.id, { counted_amount: '0.00', counted_deposits: '0.00', broken_crates: 0 })
        .then(() => (closed = true));
      for (let i = 0; i < 100 && !closed && !(await blockedOnLock()); i++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(closed).toBe(false);
      expect(await blockedOnLock()).toBe(true);

      await voider.commitTransaction();
      await closing;
      expect(closed).toBe(true);
    } finally {
      if (voider.isTransactionActive) await voider.rollbackTransaction();
      await voider.release();
    }
  });

  it('reopens once and 409s the loser when two reopens race', async () => {
    // A second point: the shift above is already spent for today.
    const run = randomUUID().slice(0, 8);
    const [{ id: secondPoint }] = (await ds.query(
      `INSERT INTO collection_points (name, code, kind, is_active)
       VALUES ($1, $2, 'reception', true) RETURNING id`,
      [`Точка ${run}`, `R${run.slice(0, 6).toUpperCase()}`],
    )) as { id: string }[];
    const secondOperator: AuthenticatedUser = { ...operator, collection_point_id: secondPoint };

    const shift = await service.open(secondOperator, { counted_amount: '500.00', counted_deposits: '0.00' });
    await service.close(secondOperator, shift.id, { counted_amount: '500.00', counted_deposits: '0.00', broken_crates: 0 });

    const results = await Promise.allSettled([
      service.reopen(owner, shift.id, { reason: 'Помилково закрито' }),
      service.reopen(owner, shift.id, { reason: 'Помилково закрито' }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(1);

    // Without the lock BOTH succeed: the second reopen re-demotes an already
    // demoted count, writes a second `shift.reopened` audit entry, and leaves
    // the owner's log claiming the shift was reopened twice.
    const error = (rejected[0] as PromiseRejectedResult).reason as ConflictException;
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ code: 'SHIFT_NOT_CLOSED' });

    const audits = (await ds.query(
      `SELECT id FROM audit_log WHERE target_id = $1 AND action = 'shift.reopened'`,
      [shift.id],
    )) as { id: string }[];
    expect(audits).toHaveLength(1);
  });
});

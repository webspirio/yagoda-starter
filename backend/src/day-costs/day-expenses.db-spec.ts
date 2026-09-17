import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { DayExpensesService } from './day-expenses.service';
import { DayExpense } from './day-expense.entity';
import { AuditService } from '../audit/audit.service';
import { AuditLog } from '../audit/audit-log.entity';
import { Shift } from '../shifts/shift.entity';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { UserRole } from '../users/user-role.enum';

const pointCode = (): string => randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();

/**
 * `day_expenses` IS THE ONE MUTABLE MONEY TABLE IN THIS SCHEMA, and the only
 * thing standing in for the void-plus-new-document trail every neighbour has
 * is an audit entry per write. The service's doc comment makes a specific
 * promise about that entry — it commits with the row or not at all — and the
 * unit spec can only show the WIRING (that `audit.record` is handed the
 * transaction's manager), because its `transaction` mock has no rollback.
 *
 * These tests are the other half. They run against real Postgres and force
 * the audit insert to fail INSIDE the transaction, using `FK_audit_log_actor`:
 * an `actor_id` naming no user is a foreign-key violation raised at the audit
 * insert, after the `day_expenses` write has already happened in the same
 * transaction. If the two were not atomic, the expense row would survive.
 *
 * That is the failure this table cannot afford: a row whose money moved with
 * no entry saying who moved it or from what — untracked drift in a past day's
 * собівартість, which is precisely what the mutability argument assumes
 * cannot happen.
 */
describe('DayExpensesService audit atomicity (DB)', () => {
  let ds: DataSource;
  let service: DayExpensesService;
  let ownerId: string;
  let shiftId: string;

  const shiftsStub = {
    findOneRaw: async (id: string) => ds.manager.getRepository(Shift).findOne({ where: { id } }),
  };

  beforeAll(async () => {
    ds = await openTestDataSource();
    service = new DayExpensesService(
      ds.getRepository(DayExpense),
      ds,
      shiftsStub as never,
      new AuditService(ds.getRepository(AuditLog)),
    );

    const [owner] = await ds.query(
      `INSERT INTO users (first_name, last_name, role) VALUES ('Керівник', 'Тест', 'network_owner')
       RETURNING id`,
    );
    ownerId = owner.id;

    const [point] = await ds.query(
      `INSERT INTO collection_points (name, code, kind) VALUES ($1, $2, 'reception') RETURNING id`,
      [`Пункт ${pointCode()}`, pointCode()],
    );
    const [shift] = await ds.query(
      `INSERT INTO shifts (collection_point_id, business_date, status, opened_by_user_id, closed_at, closed_by_user_id)
       VALUES ($1, '2026-08-04', 'closed', $2, now(), $2) RETURNING id`,
      [point.id, ownerId],
    );
    shiftId = shift.id;
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  const actor = (sub: string): AuthenticatedUser =>
    ({
      sub,
      username: 'owner',
      role: UserRole.NetworkOwner,
      collection_point_id: null,
    }) as AuthenticatedUser;

  /** A user id that satisfies the uuid type but names no row. */
  const ghost = (): string => randomUUID();

  const expensesForShift = async (): Promise<DayExpense[]> =>
    ds.getRepository(DayExpense).find({ where: { shift_id: shiftId } });

  it('rolls the EXPENSE back when its audit entry cannot be written — create', async () => {
    const before = await expensesForShift();

    await expect(
      service.create(actor(ghost()), shiftId, { label: 'пальне', amount: '1000.00' }),
    ).rejects.toThrow();

    // The row write happened first and still did not survive: same transaction.
    const after = await expensesForShift();
    expect(after).toHaveLength(before.length);
    expect(after.map((e) => e.label)).not.toContain('пальне');
  });

  it('rolls the EDIT back when its audit entry cannot be written — update', async () => {
    const created = await service.create(actor(ownerId), shiftId, {
      label: 'оренда',
      amount: '500.00',
    });

    await expect(
      service.update(actor(ghost()), created.id, { amount: '900.00' }),
    ).rejects.toThrow();

    const reread = await ds.getRepository(DayExpense).findOneOrFail({ where: { id: created.id } });
    expect(reread.amount).toBe('500.00');
  });

  it('rolls the DELETE back when its audit entry cannot be written — remove', async () => {
    const created = await service.create(actor(ownerId), shiftId, {
      label: 'вантажник',
      amount: '300.00',
    });

    await expect(service.remove(actor(ghost()), created.id)).rejects.toThrow();

    const reread = await ds.getRepository(DayExpense).findOne({ where: { id: created.id } });
    expect(reread).not.toBeNull();
    expect(reread?.amount).toBe('300.00');
  });

  /**
   * The mirror image, and the reason the tests above are not merely proving
   * that a broken actor id throws: a WELL-FORMED write must leave exactly one
   * expense row AND exactly one audit entry naming it.
   */
  it('commits the row and its entry together on a good write', async () => {
    const created = await service.create(actor(ownerId), shiftId, {
      label: 'пальне 1 000,00',
      amount: '1000.00',
    });

    const entries = await ds.getRepository(AuditLog).find({
      where: { target_type: 'day_expense', target_id: created.id },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe('day-expense.created');

    // And a PATCH that moves a field adds a second entry carrying before/after.
    await service.update(actor(ownerId), created.id, { amount: '1200.00' });
    const afterPatch = await ds.getRepository(AuditLog).find({
      where: { target_type: 'day_expense', target_id: created.id },
      order: { at: 'ASC' },
    });
    expect(afterPatch).toHaveLength(2);
    expect(afterPatch[1].action).toBe('day-expense.updated');
    expect(afterPatch[1].before).toMatchObject({ amount: '1000.00' });
    expect(afterPatch[1].after).toMatchObject({ amount: '1200.00' });
  });

  /**
   * §3.8's no-op rule, proven where it actually matters — against a real row
   * and a real `updated_at`. A PATCH that moves nothing still SAVES (so
   * `updated_at` bumps) but must write NO audit entry, or the log fills with
   * entries describing changes that never happened and stops being readable
   * as the compensating control it is.
   */
  it('saves but writes NO audit entry for a PATCH that moves nothing', async () => {
    const created = await service.create(actor(ownerId), shiftId, {
      label: 'мішки',
      amount: '250.00',
    });

    await service.update(actor(ownerId), created.id, { amount: '250.00', label: 'мішки' });

    const entries = await ds.getRepository(AuditLog).find({
      where: { target_type: 'day_expense', target_id: created.id },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe('day-expense.created');
  });
});

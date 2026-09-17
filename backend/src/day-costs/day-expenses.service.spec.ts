import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DayExpensesService } from './day-expenses.service';
import { UserRole } from '../users/user-role.enum';

const owner = { sub: 'u-owner', role: UserRole.NetworkOwner, collection_point_id: null } as never;

describe('DayExpensesService', () => {
  const build = () => {
    const manager = {
      // Same shape as the real `EntityManager` calls the service makes —
      // `save`/`delete`/`findOne` take the entity class first, matching
      // `m.save(DayExpense, …)`/`m.delete(DayExpense, id)`/
      // `m.findOne(DayExpense, …)`.
      save: jest.fn(async (_e: unknown, row: Record<string, unknown>) => ({
        id: 'e-1',
        created_at: new Date(),
        updated_at: new Date(),
        ...row,
      })),
      delete: jest.fn(async () => ({ affected: 1 })),
      // `update`/`remove` read the row through the TRANSACTION's manager, not
      // the bare repository, and under `pessimistic_write` — see the service.
      findOne: jest.fn(
        async (
          _e: unknown,
          _opts: unknown,
        ): Promise<{ id: string; shift_id: string; label: string; amount: string } | null> => ({
          id: 'e-1',
          shift_id: 's-1',
          label: 'пальне',
          amount: '1000.00',
        }),
      ),
    };
    const repo = {
      find: jest.fn(async () => []),
    };
    // Real `DataSource.transaction` runs the callback against one EntityManager
    // and commits/rolls back the whole thing together — that atomicity is
    // exactly what this fix is proving, so the mock hands the same `manager`
    // to whatever callback the service passes in, rather than a bare
    // `undefined` the way a fire-and-forget audit call would have looked.
    const dataSource = { transaction: jest.fn(async (cb: (m: unknown) => unknown) => cb(manager)) };
    const shifts = { findOneRaw: jest.fn(async () => ({ id: 's-1' })) };
    const audit = { record: jest.fn() };
    return {
      service: new DayExpensesService(
        repo as never,
        dataSource as never,
        shifts as never,
        audit as never,
      ),
      repo,
      manager,
      dataSource,
      audit,
    };
  };

  it('records a free-text line against the shift — §8.3', async () => {
    const { service, audit, manager } = build();
    const out = await service.create(owner, 's-1', { label: 'пальне', amount: '1000.00' });
    expect(out.label).toBe('пальне');
    expect(out.amount).toBe('1000.00');
    // The audit entry travels on the SAME transaction manager as the row
    // write, not a bare `undefined` — that atomicity is this table's
    // compensating control for being mutable at all (see the service's doc
    // comment).
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'day-expense.created' }),
      manager,
    );
  });

  it('trims the label and refuses an empty one', async () => {
    const { service } = build();
    await expect(
      service.create(owner, 's-1', { label: '   ', amount: '10.00' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('EDITS a row in place — spec §3.8, the one table in this slice that is mutable', async () => {
    const { service, audit, manager } = build();
    const out = await service.update(owner, 'e-1', { amount: '1200.00' });
    expect(out.amount).toBe('1200.00');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'day-expense.updated' }),
      manager,
    );
  });

  it('writes no audit entry on a no-op PATCH — diffFields found nothing to move', async () => {
    const { service, audit } = build();
    // Same amount the fixture's `findOne` already returns — no field moves.
    await service.update(owner, 'e-1', { amount: '1000.00' });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('deletes a row outright — no void trio here', async () => {
    const { service, audit, manager } = build();
    await service.remove(owner, 'e-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'day-expense.deleted' }),
      manager,
    );
  });

  it('404s an unknown expense', async () => {
    const { service, manager } = build();
    manager.findOne = jest.fn(async (_e: unknown, _opts: unknown) => null);
    await expect(service.update(owner, 'nope', { amount: '1.00' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  /**
   * The audit entry is this table's ONLY compensating control for being
   * mutable, and a `before` read off an unlocked row is one another writer may
   * already have moved: two concurrent PATCHes would each log
   * `before: '1000.00'` and one of those transitions never happened. So the
   * read happens inside the transaction AND takes the row lock.
   */
  it('reads the row under a write lock, inside the transaction — the before/after is a claim', async () => {
    const { service, manager, dataSource } = build();
    await service.update(owner, 'e-1', { amount: '1200.00' });

    expect(manager.findOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
    // Ordering, not just presence: the lock is worthless if the row is read
    // before the transaction that will write it has even opened.
    expect(dataSource.transaction).toHaveBeenCalled();
    expect(manager.findOne.mock.invocationCallOrder[0]).toBeGreaterThan(
      dataSource.transaction.mock.invocationCallOrder[0],
    );
  });

  it('takes the same lock before deleting — the delete is exactly-once', async () => {
    const { service, manager } = build();
    await service.remove(owner, 'e-1');
    expect(manager.findOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
  });

  it('404s an unknown expense on DELETE rather than logging a phantom removal', async () => {
    const { service, manager, audit } = build();
    manager.findOne = jest.fn(async (_e: unknown, _opts: unknown) => null);
    await expect(service.remove(owner, 'nope')).rejects.toBeInstanceOf(NotFoundException);
    expect(audit.record).not.toHaveBeenCalled();
  });

  /**
   * `CHK_day_expenses_amount` is `amount > 0`, and nothing in this backend
   * maps a `QueryFailedError`, so a '0.00' that reaches Postgres comes back
   * as a 500. `IntakeTopUpsService` answers the identical case with a 400 and
   * a `code`; so does this one, and for the same reason.
   */
  it('REFUSES a zero amount with a code, not an opaque 500 — CHK_day_expenses_amount', async () => {
    const { service, manager } = build();
    await expect(service.create(owner, 's-1', { label: 'пальне', amount: '0.00' })).rejects.toThrow(
      BadRequestException,
    );
    await expect(
      service.create(owner, 's-1', { label: 'пальне', amount: '0.00' }),
    ).rejects.toMatchObject({ response: { code: 'EXPENSE_AMOUNT_NOT_POSITIVE' } });
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('REFUSES a zero amount on PATCH too — the row is mutable, the CHECK is not', async () => {
    const { service, manager } = build();
    await expect(service.update(owner, 'e-1', { amount: '0.00' })).rejects.toMatchObject({
      response: { code: 'EXPENSE_AMOUNT_NOT_POSITIVE' },
    });
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('writes NO audit entry for a PATCH that changes nothing', async () => {
    const { service, audit } = build();
    // The repo stub holds `amount: '1000.00'`; `@CanonicalDecimal()` has
    // already turned the caller's '1000' into '1000.00' by the time it
    // arrives, so `diffFields` sees no change at all.
    await service.update(owner, 'e-1', { amount: '1000.00' });
    expect(audit.record).not.toHaveBeenCalled();
  });
});

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { VoidIntakeTopUpCommand } from './void-intake-top-up.command';
import { Intake } from '../../intakes/intake.entity';
import { IntakeTopUp } from '../intake-top-up.entity';
import { UserRole } from '../../users/user-role.enum';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

const OWNER: AuthenticatedUser = {
  sub: 'owner-1',
  role: UserRole.NetworkOwner,
  collection_point_id: null,
} as AuthenticatedUser;

const OPERATOR: AuthenticatedUser = {
  sub: 'op-1',
  role: UserRole.PointOperator,
  collection_point_id: 'point-1',
} as AuthenticatedUser;

const INTAKE = {
  id: 'intake-1',
  code: 'KPG-IN-20260908-04412',
  supplier_id: 'supplier-1',
  voided_at: null,
} as Intake;

describe('VoidIntakeTopUpCommand', () => {
  let command: VoidIntakeTopUpCommand;
  let manager: { findOne: jest.Mock; save: jest.Mock };
  let dataSource: { transaction: jest.Mock; manager: unknown };
  let audit: { record: jest.Mock };
  let allocations: {
    lockSupplier: jest.Mock;
    release: jest.Mock;
    allocate: jest.Mock;
    withinSupplierLedger: jest.Mock;
  };

  const live = (): IntakeTopUp =>
    ({
      id: 'top-up-1',
      intake_id: 'intake-1',
      amount: '2000.00',
      reason: 'доплата',
      created_by_user_id: 'owner-1',
      voided_at: null,
      voided_by_user_id: null,
      void_reason: null,
      created_at: new Date('2026-09-11T08:00:00.000Z'),
      updated_at: new Date('2026-09-11T08:00:00.000Z'),
    }) as IntakeTopUp;

  beforeEach(() => {
    manager = {
      findOne: jest
        .fn()
        .mockImplementation((entity: unknown) => (entity === IntakeTopUp ? live() : INTAKE)),
      save: jest.fn().mockImplementation((_e, row: IntakeTopUp) => row),
    };
    dataSource = {
      transaction: jest.fn().mockImplementation((cb: (m: unknown) => unknown) => cb(manager)),
      manager,
    };
    audit = { record: jest.fn() };
    allocations = {
      lockSupplier: jest.fn(),
      release: jest.fn(),
      allocate: jest.fn().mockResolvedValue(0),
      withinSupplierLedger: jest.fn(),
    };
    // Mirrors AllocationsService.withinSupplierLedger (lock → work → allocate); the real
    // order is pinned in supplier-balance/services/allocations.spec.ts.
    allocations.withinSupplierLedger.mockImplementation(
      async (m: unknown, id: string, work: () => Promise<unknown>) => {
        await allocations.lockSupplier(m, id);
        const result = await work();
        await allocations.allocate(m, id);
        return result;
      },
    );
    command = new VoidIntakeTopUpCommand(dataSource as never, audit as never, allocations as never);
  });

  it('writes the whole trio and stops counting', async () => {
    const res = await command.void(OWNER, 'top-up-1', { reason: 'помилка суми' });

    expect(res.counts_toward_balance).toBe(false);
    expect(res.void_reason).toBe('помилка суми');
    expect(res.voided_by_user_id).toBe('owner-1');
    expect(res.voided_at).not.toBeNull();
  });

  it('reads the row under a write lock, inside the transaction', async () => {
    await command.void(OWNER, 'top-up-1', { reason: 'x' });

    expect(manager.findOne).toHaveBeenCalledWith(IntakeTopUp, {
      where: { id: 'top-up-1' },
      lock: { mode: 'pessimistic_write' },
    });
  });

  it('refuses an operator — even one at the right point', async () => {
    await expect(command.void(OPERATOR, 'top-up-1', { reason: 'x' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('locks the supplier before the row, releases the top-up, allocates once', async () => {
    await command.void(OWNER, 'top-up-1', { reason: 'x' });

    const locked = manager.findOne.mock.calls.findIndex(([, opts]) => opts?.lock);
    expect(allocations.lockSupplier).toHaveBeenCalledWith(manager, 'supplier-1');
    expect(allocations.lockSupplier.mock.invocationCallOrder[0]).toBeLessThan(
      manager.findOne.mock.invocationCallOrder[locked],
    );
    expect(allocations.release).toHaveBeenCalledWith(manager, { topUpId: 'top-up-1' });
    expect(allocations.allocate).toHaveBeenCalledTimes(1);
    expect(allocations.allocate).toHaveBeenCalledWith(manager, 'supplier-1');
  });

  it('404s a missing top-up before any lock', async () => {
    manager.findOne.mockResolvedValue(null);
    await expect(command.void(OWNER, 'nope', { reason: 'x' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(allocations.lockSupplier).not.toHaveBeenCalled();
  });

  it('409s an already-voided row', async () => {
    manager.findOne.mockImplementation((entity: unknown) =>
      entity === IntakeTopUp
        ? { ...live(), voided_at: new Date(), voided_by_user_id: 'owner-1', void_reason: 'вже' }
        : INTAKE,
    );

    await expect(command.void(OWNER, 'top-up-1', { reason: 'x' })).rejects.toMatchObject({
      response: { code: 'ALREADY_VOIDED' },
    });
  });

  it('404s an unknown id', async () => {
    manager.findOne.mockResolvedValue(null);
    await expect(command.void(OWNER, 'nope', { reason: 'x' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('audits inside the transaction', async () => {
    await command.void(OWNER, 'top-up-1', { reason: 'помилка суми' });

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'intake-top-up.voided',
        actor_id: 'owner-1',
        target_type: 'intake-top-up',
        target_id: 'top-up-1',
        before: { voided_at: null },
        note: 'помилка суми',
      }),
      manager,
    );
  });
});

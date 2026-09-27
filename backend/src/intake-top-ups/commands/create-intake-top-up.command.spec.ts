import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CreateIntakeTopUpCommand } from './create-intake-top-up.command';
import { Intake } from '../../intakes/intake.entity';
import { Supplier } from '../../suppliers/supplier.entity';
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

const SUPPLIER = { id: 'supplier-1', is_active: true } as Supplier;

describe('CreateIntakeTopUpCommand', () => {
  let command: CreateIntakeTopUpCommand;
  let manager: { findOne: jest.Mock; save: jest.Mock };
  let dataSource: { transaction: jest.Mock; manager: unknown };
  let audit: { record: jest.Mock };
  let allocations: {
    lockSupplier: jest.Mock;
    release: jest.Mock;
    allocate: jest.Mock;
    withinSupplierLedger: jest.Mock;
  };

  beforeEach(() => {
    manager = {
      findOne: jest
        .fn()
        .mockImplementation((entity: unknown) => (entity === Supplier ? SUPPLIER : INTAKE)),
      save: jest.fn().mockImplementation((_entity, row: IntakeTopUp) => ({
        ...row,
        id: 'top-up-1',
        created_at: new Date('2026-09-11T08:00:00.000Z'),
        updated_at: new Date('2026-09-11T08:00:00.000Z'),
      })),
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
    allocations.withinSupplierLedger.mockImplementation(
      async (m: unknown, id: string, work: () => Promise<unknown>) => {
        await allocations.lockSupplier(m, id);
        const result = await work();
        await allocations.allocate(m, id);
        return result;
      },
    );
    command = new CreateIntakeTopUpCommand(
      dataSource as never,
      audit as never,
      allocations as never,
    );
  });

  it('writes the row and returns it counting toward the balance', async () => {
    const res = await command.create(OWNER, {
      intake_id: 'intake-1',
      amount: '2000.00',
      reason: 'перерахували ціну після здачі',
    });

    expect(res.amount).toBe('2000.00');
    expect(res.counts_toward_balance).toBe(true);
    expect(res.intake.code).toBe('KPG-IN-20260908-04412');
    expect(res.created_by_user_id).toBe('owner-1');
  });

  it('refuses an operator — #61 is «Як керівник»', async () => {
    await expect(
      command.create(OPERATOR, { intake_id: 'intake-1', amount: '10.00', reason: 'x' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('404s an unknown intake', async () => {
    manager.findOne.mockImplementation((entity: unknown) =>
      entity === Supplier ? SUPPLIER : null,
    );
    await expect(
      command.create(OWNER, { intake_id: 'nope', amount: '10.00', reason: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses a DEACTIVATED supplier — the debt would be unpayable', async () => {
    // `PayoutsService.create` refuses `SUPPLIER_INACTIVE`, so a top-up written
    // here against a retired card raises a debt the counter cannot settle
    // until someone reactivates the supplier. Refused at the source, with the
    // same code the payout route uses, rather than discovered at the counter.
    manager.findOne.mockImplementation((entity: unknown) =>
      entity === Supplier ? { ...SUPPLIER, is_active: false } : INTAKE,
    );

    await expect(
      command.create(OWNER, { intake_id: 'intake-1', amount: '2000.00', reason: 'доплата' }),
    ).rejects.toMatchObject({ response: { code: 'SUPPLIER_INACTIVE' } });
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('refuses zero with a sentence, not a constraint violation', async () => {
    await expect(
      command.create(OWNER, { intake_id: 'intake-1', amount: '0.00', reason: 'x' }),
    ).rejects.toMatchObject({
      response: { code: 'TOP_UP_AMOUNT_NOT_POSITIVE' },
    });
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('trims the reason', async () => {
    await command.create(OWNER, {
      intake_id: 'intake-1',
      amount: '10.00',
      reason: '  доплата  ',
    });

    expect(manager.save).toHaveBeenCalledWith(
      IntakeTopUp,
      expect.objectContaining({ reason: 'доплата' }),
    );
  });

  it('SUCCEEDS against an intake in a CLOSED shift — the primary scenario of #61', async () => {
    // The service must not look at the shift at all: a top-up has no shift_id
    // and the owner is typically not at the point when they decide to top up.
    // This test is the regression guard for anyone who later "adds the missing
    // open-shift check".
    await expect(
      command.create(OWNER, { intake_id: 'intake-1', amount: '2000.00', reason: 'доплата' }),
    ).resolves.toBeDefined();
    expect(manager.findOne).toHaveBeenCalledWith(Intake, { where: { id: 'intake-1' } });
    // The intake stub, the re-read intake and its supplier — nothing else, and
    // in particular no shift. Asserting the SEQUENCE of entities rather than a
    // count keeps this test about the shift instead of about how many rows
    // create happens to read.
    expect(manager.findOne.mock.calls.map((call) => call[0])).toEqual([Intake, Intake, Supplier]);
  });

  it('audits inside the same transaction', async () => {
    await command.create(OWNER, {
      intake_id: 'intake-1',
      amount: '2000.00',
      reason: 'доплата',
    });

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'intake-top-up.created',
        actor_id: 'owner-1',
        target_type: 'intake-top-up',
        target_id: 'top-up-1',
        note: 'доплата',
      }),
      manager,
    );
  });

  it('locks the supplier before the is_active read and the insert, and allocates once, after it', async () => {
    await command.create(OWNER, { intake_id: 'intake-1', amount: '10.00', reason: 'x' });

    // The supplier findOne IS the is_active read — it now happens after the lock.
    const supplierRead = manager.findOne.mock.calls.findIndex(([entity]) => entity === Supplier);
    expect(allocations.lockSupplier).toHaveBeenCalledWith(manager, 'supplier-1');
    expect(allocations.lockSupplier.mock.invocationCallOrder[0]).toBeLessThan(
      manager.findOne.mock.invocationCallOrder[supplierRead],
    );
    expect(allocations.lockSupplier.mock.invocationCallOrder[0]).toBeLessThan(
      manager.save.mock.invocationCallOrder[0],
    );
    expect(allocations.allocate).toHaveBeenCalledTimes(1);
    expect(allocations.allocate).toHaveBeenCalledWith(manager, 'supplier-1');
    expect(allocations.allocate.mock.invocationCallOrder[0]).toBeGreaterThan(
      manager.save.mock.invocationCallOrder[0],
    );
  });

  it('may be written against an ALREADY VOIDED intake', async () => {
    // Legal but pointless — the row will not count. Refusing it would be a
    // rule the balance formula does not have, and the mapper already tells
    // the caller it counts for nothing.
    manager.findOne.mockImplementation((entity: unknown) =>
      entity === Supplier ? SUPPLIER : ({ ...INTAKE, voided_at: new Date() } as Intake),
    );

    const res = await command.create(OWNER, {
      intake_id: 'intake-1',
      amount: '10.00',
      reason: 'x',
    });
    expect(res.counts_toward_balance).toBe(false);
  });
});

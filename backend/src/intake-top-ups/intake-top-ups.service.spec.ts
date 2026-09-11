import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { IntakeTopUpsService } from './intake-top-ups.service';
import { Intake } from '../intakes/intake.entity';
import { IntakeTopUp } from './intake-top-up.entity';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

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
  voided_at: null,
} as Intake;

describe('IntakeTopUpsService.create', () => {
  let service: IntakeTopUpsService;
  let manager: { findOne: jest.Mock; save: jest.Mock };
  let dataSource: { transaction: jest.Mock; manager: unknown };
  let audit: { record: jest.Mock };

  beforeEach(() => {
    manager = {
      findOne: jest.fn().mockResolvedValue(INTAKE),
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
    service = new IntakeTopUpsService({} as never, dataSource as never, audit as never);
  });

  it('writes the row and returns it counting toward the balance', async () => {
    const res = await service.create(OWNER, {
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
      service.create(OPERATOR, { intake_id: 'intake-1', amount: '10.00', reason: 'x' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('404s an unknown intake', async () => {
    manager.findOne.mockResolvedValue(null);
    await expect(
      service.create(OWNER, { intake_id: 'nope', amount: '10.00', reason: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses zero with a sentence, not a constraint violation', async () => {
    await expect(
      service.create(OWNER, { intake_id: 'intake-1', amount: '0.00', reason: 'x' }),
    ).rejects.toMatchObject({
      response: { code: 'TOP_UP_AMOUNT_NOT_POSITIVE' },
    });
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('trims the reason', async () => {
    await service.create(OWNER, {
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
      service.create(OWNER, { intake_id: 'intake-1', amount: '2000.00', reason: 'доплата' }),
    ).resolves.toBeDefined();
    expect(manager.findOne).toHaveBeenCalledTimes(1);
    expect(manager.findOne).toHaveBeenCalledWith(Intake, { where: { id: 'intake-1' } });
  });

  it('audits inside the same transaction', async () => {
    await service.create(OWNER, {
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

  it('may be written against an ALREADY VOIDED intake', async () => {
    // Legal but pointless — the row will not count. Refusing it would be a
    // rule the balance formula does not have, and the mapper already tells
    // the caller it counts for nothing.
    manager.findOne.mockResolvedValue({ ...INTAKE, voided_at: new Date() } as Intake);

    const res = await service.create(OWNER, {
      intake_id: 'intake-1',
      amount: '10.00',
      reason: 'x',
    });
    expect(res.counts_toward_balance).toBe(false);
  });
});

describe('IntakeTopUpsService.void', () => {
  let service: IntakeTopUpsService;
  let manager: { findOne: jest.Mock; save: jest.Mock };
  let dataSource: { transaction: jest.Mock; manager: unknown };
  let audit: { record: jest.Mock };

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
      findOne: jest.fn().mockImplementation((entity: unknown) =>
        entity === IntakeTopUp ? live() : INTAKE,
      ),
      save: jest.fn().mockImplementation((_e, row: IntakeTopUp) => row),
    };
    dataSource = {
      transaction: jest.fn().mockImplementation((cb: (m: unknown) => unknown) => cb(manager)),
      manager,
    };
    audit = { record: jest.fn() };
    service = new IntakeTopUpsService({} as never, dataSource as never, audit as never);
  });

  it('writes the whole trio and stops counting', async () => {
    const res = await service.void(OWNER, 'top-up-1', { reason: 'помилка суми' });

    expect(res.counts_toward_balance).toBe(false);
    expect(res.void_reason).toBe('помилка суми');
    expect(res.voided_by_user_id).toBe('owner-1');
    expect(res.voided_at).not.toBeNull();
  });

  it('reads the row under a write lock, inside the transaction', async () => {
    await service.void(OWNER, 'top-up-1', { reason: 'x' });

    expect(manager.findOne).toHaveBeenCalledWith(IntakeTopUp, {
      where: { id: 'top-up-1' },
      lock: { mode: 'pessimistic_write' },
    });
  });

  it('refuses an operator — even one at the right point', async () => {
    await expect(
      service.void(OPERATOR, 'top-up-1', { reason: 'x' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('409s an already-voided row', async () => {
    manager.findOne.mockImplementation((entity: unknown) =>
      entity === IntakeTopUp
        ? { ...live(), voided_at: new Date(), voided_by_user_id: 'owner-1', void_reason: 'вже' }
        : INTAKE,
    );

    await expect(service.void(OWNER, 'top-up-1', { reason: 'x' })).rejects.toMatchObject({
      response: { code: 'ALREADY_VOIDED' },
    });
  });

  it('404s an unknown id', async () => {
    manager.findOne.mockResolvedValue(null);
    await expect(service.void(OWNER, 'nope', { reason: 'x' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('audits inside the transaction', async () => {
    await service.void(OWNER, 'top-up-1', { reason: 'помилка суми' });

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

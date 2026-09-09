import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TransfersService } from './transfers.service';
import { TransferStatus } from './transfer-status.enum';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

const owner: AuthenticatedUser = {
  sub: 'u-owner',
  username: 'owner',
  role: UserRole.NetworkOwner,
  collection_point_id: null,
};

const operatorA: AuthenticatedUser = {
  sub: 'u-op-a',
  username: 'opa',
  role: UserRole.PointOperator,
  collection_point_id: 'point-a',
};

describe('TransfersService.create', () => {
  const build = (over: Record<string, unknown> = {}) => {
    const repo = {
      create: jest.fn((x: unknown) => x),
      save: jest.fn((x: Record<string, unknown>) => ({ id: 't-1', created_at: new Date(), ...x })),
      findOne: jest.fn().mockResolvedValue(null),
      ...(over.repo as object),
    };
    const points = {
      findOneRaw: jest.fn().mockResolvedValue({ id: 'point-a', is_active: true }),
      ...(over.points as object),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const time = { now: () => ({ toISODate: () => '2026-09-09', toJSDate: () => new Date() }) };
    const service = new TransfersService(
      repo as never,
      points as never,
      audit as never,
      time as never,
      { transaction: jest.fn() } as never,
    );
    return { service, repo, points, audit };
  };

  const dto = { collection_point_id: 'point-a', cash: '150000.00', crates: 200, carrier: 'Іван' };

  it('creates a transfer in the sent state', async () => {
    const { service, repo } = build();
    const result = await service.create(owner, dto as never);

    expect(result.status).toBe(TransferStatus.Sent);
    expect(result.accepted_date).toBeNull();
    expect(repo.save).toHaveBeenCalled();
  });

  it('refuses an operator — §7.9 step 1 puts creation with the owner', async () => {
    const { service } = build();
    await expect(service.create(operatorA, dto as never)).rejects.toThrow(ForbiddenException);
  });

  it('refuses an unknown point', async () => {
    const { service } = build({ points: { findOneRaw: jest.fn().mockResolvedValue(null) } });
    await expect(service.create(owner, dto as never)).rejects.toThrow(NotFoundException);
  });

  it('refuses a deactivated point', async () => {
    const { service } = build({
      points: { findOneRaw: jest.fn().mockResolvedValue({ id: 'point-a', is_active: false }) },
    });
    await expect(service.create(owner, dto as never)).rejects.toThrow(BadRequestException);
  });

  it('refuses a correction naming a transfer at another point', async () => {
    const { service } = build({
      repo: {
        findOne: jest.fn().mockResolvedValue({ id: 't-old', collection_point_id: 'point-b' }),
      },
    });
    await expect(
      service.create(owner, { ...dto, correction_of_transfer_id: 't-old' } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('writes a transfer.created audit entry', async () => {
    const { service, audit } = build();
    await service.create(owner, dto as never);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'transfer.created', actor_id: 'u-owner' }),
    );
  });
});

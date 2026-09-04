import { ConflictException, NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { UserRole } from '../users/user-role.enum';
import { PointKind } from './point-kind.enum';
import { CollectionPointsService } from './collection-points.service';
import { UpdateCollectionPointDto } from './dto/update-collection-point.dto';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

const owner: AuthenticatedUser = {
  sub: 'u-owner',
  username: 'owner',
  role: UserRole.NetworkOwner,
  collection_point_id: null,
};

describe('CollectionPointsService', () => {
  let repo: {
    find: jest.Mock;
    findAndCount: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
  };
  let users: { findActiveAtPoint: jest.Mock };
  let audit: { record: jest.Mock };
  let service: CollectionPointsService;

  const point = (over: Record<string, unknown> = {}) => ({
    id: 'p-1',
    name: 'Копайгород',
    kind: PointKind.Reception,
    target_cash: null,
    target_crates: null,
    is_active: true,
    created_at: new Date('2026-07-15T06:00:00.000Z'),
    updated_at: new Date('2026-07-15T06:00:00.000Z'),
    ...over,
  });

  beforeEach(() => {
    repo = {
      find: jest.fn(),
      findAndCount: jest.fn().mockResolvedValue([[point()], 1]),
      findOne: jest.fn().mockResolvedValue(point()),
      save: jest.fn().mockImplementation((p) => Promise.resolve(p)),
      // `point(p)` rather than the bare `p`: a real repo.create() merges its
      // partial onto a fresh entity, so the result still has id/created_at/
      // updated_at/is_active defaults — exactly what toCollectionPointResponse
      // needs. Returning the partial as-is would leave created_at undefined
      // and crash the mapper in the "creates a point" test below.
      create: jest.fn().mockImplementation((p) => point(p)),
    };
    users = { findActiveAtPoint: jest.fn().mockResolvedValue([]) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new CollectionPointsService(repo as never, users as never, audit as never);
  });

  it('creates a point with both targets unset — NOT zero', async () => {
    await service.create(owner, { name: 'Нова точка' });

    const saved = repo.save.mock.calls[0][0];
    expect(saved.target_cash).toBeNull();
    expect(saved.target_crates).toBeNull();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'point.created', actor_id: 'u-owner' }),
    );
  });

  it('records who changed a target, from what, to what, and why', async () => {
    repo.findOne.mockResolvedValue(point({ target_crates: 600 }));

    await service.update(owner, 'p-1', { target_crates: 800, reason: 'розширили точку' });

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'point.target-changed',
        actor_id: 'u-owner',
        target_type: 'collection_point',
        target_id: 'p-1',
        before: { target_crates: 600 },
        after: { target_crates: 800 },
        note: 'розширили точку',
      }),
    );
  });

  // §6.9: clearing a target means "not known", and must not collapse to 0.
  it('clears a target when given an explicit null', async () => {
    repo.findOne.mockResolvedValue(point({ target_crates: 800 }));

    await service.update(owner, 'p-1', { target_crates: null });

    expect(repo.save.mock.calls[0][0].target_crates).toBeNull();
  });

  it('leaves a target alone when the field is simply absent', async () => {
    repo.findOne.mockResolvedValue(point({ target_crates: 800 }));

    await service.update(owner, 'p-1', { name: 'Копайгород-2' });

    expect(repo.save.mock.calls[0][0].target_crates).toBe(800);
    expect(audit.record).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'point.target-changed' }),
    );
  });

  it('refuses to deactivate a point that still has active users, naming them', async () => {
    repo.findOne.mockResolvedValue(point());
    users.findActiveAtPoint.mockResolvedValue([
      { first_name: 'Оксана', last_name: 'П' },
      { first_name: 'Марія', last_name: 'К' },
    ]);

    await expect(service.update(owner, 'p-1', { is_active: false })).rejects.toThrow(
      ConflictException,
    );
    await expect(service.update(owner, 'p-1', { is_active: false })).rejects.toThrow(/Оксана П/);
  });

  it('allows deactivating a point with no active users', async () => {
    repo.findOne.mockResolvedValue(point());
    await expect(service.update(owner, 'p-1', { is_active: false })).resolves.toBeDefined();
  });

  it('throws NotFound for an unknown point', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(service.findOne(owner, 'nope')).rejects.toThrow(NotFoundException);
  });

  it('returns only their own point to an operator', async () => {
    const operator: AuthenticatedUser = {
      sub: 'u-op',
      username: 'oksana',
      role: UserRole.PointOperator,
      collection_point_id: 'p-1',
    };

    await service.list(operator, { page: 1, limit: 20 });

    expect(repo.findAndCount).toHaveBeenCalledWith(
      // objectContaining on `where` too: it also carries is_active, and a
      // strict literal here would assert the filter is the ONLY one applied.
      expect.objectContaining({ where: expect.objectContaining({ id: 'p-1' }) }),
    );
  });

  // Exercises class-validator's own validate() directly against the DTO — the
  // rest of this file mocks the repo and calls the service with plain object
  // literals, which never runs through class-validator at all. `name`, `kind`
  // and `is_active` are NOT NULL columns: an explicit null must be REJECTED
  // here (400 once the global ValidationPipe is in front of it), not silently
  // assigned and left to crash the database constraint at `repo.save()`.
  describe('UpdateCollectionPointDto nullability', () => {
    it('rejects an explicit null for name', async () => {
      const dto = Object.assign(new UpdateCollectionPointDto(), { name: null });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'name')).toBe(true);
    });

    it('rejects an explicit null for kind', async () => {
      const dto = Object.assign(new UpdateCollectionPointDto(), { kind: null });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'kind')).toBe(true);
    });

    it('rejects an explicit null for is_active', async () => {
      const dto = Object.assign(new UpdateCollectionPointDto(), { is_active: null });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'is_active')).toBe(true);
    });

    it('accepts a real name and leaves an absent name untouched', async () => {
      const withName = Object.assign(new UpdateCollectionPointDto(), { name: 'Копайгород' });
      expect(await validate(withName)).toHaveLength(0);

      const absent = Object.assign(new UpdateCollectionPointDto(), { reason: 'бо треба' });
      expect(await validate(absent)).toHaveLength(0);
    });
  });
});

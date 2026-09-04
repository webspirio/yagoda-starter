import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UserRole } from '../users/user-role.enum';
import { UserAdminService } from './user-admin.service';
import { UpdateUserDto } from './dto/update-user.dto';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

const owner: AuthenticatedUser = {
  sub: 'u-owner',
  username: 'owner',
  role: UserRole.NetworkOwner,
  collection_point_id: null,
};

describe('UserAdminService', () => {
  let users: Record<string, jest.Mock>;
  let credentials: Record<string, jest.Mock>;
  let points: Record<string, jest.Mock>;
  let audit: Record<string, jest.Mock>;
  let service: UserAdminService;

  const target = (over: Record<string, unknown> = {}) => ({
    id: 'u-target',
    first_name: 'Оксана',
    last_name: 'Приймальник',
    role: UserRole.PointOperator,
    collection_point_id: 'p-1',
    is_active: true,
    avatar_url: null,
    created_at: new Date('2026-07-15T06:00:00.000Z'),
    ...over,
  });

  beforeEach(() => {
    users = {
      findById: jest.fn().mockResolvedValue(target()),
      findByIdentity: jest.fn().mockResolvedValue(null),
      findLogin: jest.fn().mockResolvedValue('oksana'),
      countActiveOwners: jest.fn().mockResolvedValue(2),
      createWithIdentity: jest.fn(),
      update: jest.fn().mockImplementation((_id, dto) => Promise.resolve(target(dto))),
      setLogin: jest.fn(),
      list: jest.fn().mockResolvedValue([[target()], 1]),
    };
    credentials = { set: jest.fn() };
    points = { findOneRaw: jest.fn().mockResolvedValue({ id: 'p-1', is_active: true }) };
    audit = { record: jest.fn() };
    service = new UserAdminService(
      users as never,
      credentials as never,
      points as never,
      audit as never,
    );
  });

  describe('role ↔ point coherence', () => {
    it('refuses to create an operator with no collection point', async () => {
      await expect(
        service.create(owner, {
          first_name: 'A',
          last_name: 'B',
          login: 'ab',
          password: 'hunter2!!',
          role: UserRole.PointOperator,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses to create an owner pinned to a collection point', async () => {
      await expect(
        service.create(owner, {
          first_name: 'A',
          last_name: 'B',
          login: 'ab',
          password: 'hunter2!!',
          role: UserRole.NetworkOwner,
          collection_point_id: 'p-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('clears the point when promoting an operator to owner', async () => {
      await service.update(owner, 'u-target', { role: UserRole.NetworkOwner });
      expect(users.update).toHaveBeenCalledWith(
        'u-target',
        expect.objectContaining({ role: UserRole.NetworkOwner, collection_point_id: null }),
      );
    });

    it('refuses to demote an owner to operator without giving them a point', async () => {
      users.findById.mockResolvedValue(target({ role: UserRole.NetworkOwner, collection_point_id: null }));
      await expect(
        service.update(owner, 'u-target', { role: UserRole.PointOperator }),
      ).rejects.toThrow(BadRequestException);
    });

    // The owner branch of the `nextPoint` computation hands an owner `null`
    // unconditionally, so a point named in the body used to be silently
    // DROPPED — 200, nothing changed, and `create()` returning 400 for the
    // same combination. Refusing it keeps the two endpoints agreeing.
    it('refuses to pin an existing owner to a point rather than dropping it', async () => {
      users.findById.mockResolvedValue(target({ role: UserRole.NetworkOwner, collection_point_id: null }));
      await expect(
        service.update(owner, 'u-target', { collection_point_id: 'p-2' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses a promotion that also names a point', async () => {
      await expect(
        service.update(owner, 'u-target', {
          role: UserRole.NetworkOwner,
          collection_point_id: 'p-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    // The other side of that guard: `!= null`, so an EXPLICIT null is still a
    // legal way to spell "promote and clear", exactly as an absent field is
    // (proved by the promotion test above).
    it('still promotes when the point is explicitly null', async () => {
      await service.update(owner, 'u-target', {
        role: UserRole.NetworkOwner,
        collection_point_id: null,
      });
      expect(users.update).toHaveBeenCalledWith(
        'u-target',
        expect.objectContaining({ role: UserRole.NetworkOwner, collection_point_id: null }),
      );
    });

    // A DIFFERENT point than the one the user already has: `update` only
    // validates a point it is actually moving them to, so reassigning someone
    // to the point they are already at must not re-run the check.
    it('refuses a move to a point that is deactivated', async () => {
      points.findOneRaw.mockResolvedValue({ id: 'p-2', is_active: false });
      await expect(
        service.update(owner, 'u-target', { collection_point_id: 'p-2' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('lockout guards', () => {
    it('refuses to demote the last active owner', async () => {
      users.findById.mockResolvedValue(target({ id: 'u-last', role: UserRole.NetworkOwner, collection_point_id: null }));
      users.countActiveOwners.mockResolvedValue(0); // none left once u-last is excluded

      await expect(
        service.update(owner, 'u-last', { role: UserRole.PointOperator, collection_point_id: 'p-1' }),
      ).rejects.toThrow(ConflictException);
    });

    it('refuses to deactivate the last active owner', async () => {
      users.findById.mockResolvedValue(target({ id: 'u-last', role: UserRole.NetworkOwner, collection_point_id: null }));
      users.countActiveOwners.mockResolvedValue(0);

      await expect(service.update(owner, 'u-last', { is_active: false })).rejects.toThrow(
        ConflictException,
      );
    });

    // The "exclude this user" argument is the whole correctness of the count:
    // counting WITH them would see 1 and cheerfully demote the last owner.
    it('excludes the user being changed from the owner count', async () => {
      users.findById.mockResolvedValue(target({ id: 'u-last', role: UserRole.NetworkOwner, collection_point_id: null }));
      users.countActiveOwners.mockResolvedValue(1);

      await service.update(owner, 'u-last', { is_active: false });
      expect(users.countActiveOwners).toHaveBeenCalledWith('u-last');
    });

    // Even with another owner standing by: the recovery cost is total, and
    // nobody demotes themselves on purpose.
    it('refuses self-demotion outright', async () => {
      users.findById.mockResolvedValue(target({ id: owner.sub, role: UserRole.NetworkOwner, collection_point_id: null }));
      users.countActiveOwners.mockResolvedValue(5);

      await expect(
        service.update(owner, owner.sub, { role: UserRole.PointOperator, collection_point_id: 'p-1' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses self-deactivation outright', async () => {
      users.findById.mockResolvedValue(target({ id: owner.sub, role: UserRole.NetworkOwner, collection_point_id: null }));
      users.countActiveOwners.mockResolvedValue(5);

      await expect(service.update(owner, owner.sub, { is_active: false })).rejects.toThrow(
        ForbiddenException,
      );
    });

    /**
     * `uuid` is compared case-INSENSITIVELY by Postgres and ParseUUIDPipe
     * accepts an uppercased one, so `findById` returns the actor's OWN row
     * while a raw `userId === actor.sub` string compare — the single
     * case-sensitive step in the chain — reads false. Comparing the loaded
     * row's id instead closes it. `countActiveOwners` returns 5 here on
     * purpose: with another owner standing by, SELF_LOCKOUT is the only guard
     * that can fire, so this test fails if the comparison regresses.
     */
    it('refuses self-deactivation even when the path id is uppercased', async () => {
      const id = '9b1f6c4e-3a2d-4f71-8c05-1e7a2d6b4f88';
      const self: AuthenticatedUser = { ...owner, sub: id };
      users.findById.mockResolvedValue(target({ id, role: UserRole.NetworkOwner, collection_point_id: null }));
      users.countActiveOwners.mockResolvedValue(5);

      await expect(service.update(self, id.toUpperCase(), { is_active: false })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('allows an owner to edit their own name', async () => {
      users.findById.mockResolvedValue(target({ id: owner.sub, role: UserRole.NetworkOwner, collection_point_id: null }));
      await expect(service.update(owner, owner.sub, { first_name: 'Новий' })).resolves.toBeDefined();
    });
  });

  describe('login', () => {
    // '  OKSANA2 ' normalises to 'oksana2', which DIFFERS from the current
    // 'oksana' — a value normalising back to the user's own login is a no-op
    // and is deliberately not checked, so it would prove nothing here.
    it('normalises and rejects a taken login', async () => {
      users.findByIdentity.mockResolvedValue({ user: { id: 'someone-else' } });
      await expect(service.update(owner, 'u-target', { login: '  OKSANA2 ' })).rejects.toThrow(
        ConflictException,
      );
      expect(users.findByIdentity).toHaveBeenCalledWith('local', 'oksana2');
    });

    it('does not touch the identity row when the login normalises to the current one', async () => {
      await service.update(owner, 'u-target', { login: '  OKSANA ' });
      expect(users.setLogin).not.toHaveBeenCalled();
    });

    it('allows a login change to a free value, and audits it', async () => {
      await service.update(owner, 'u-target', { login: 'Oksana2' });
      expect(users.setLogin).toHaveBeenCalledWith('u-target', 'oksana2');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'user.updated',
          before: expect.objectContaining({ login: 'oksana' }),
          after: expect.objectContaining({ login: 'oksana2' }),
        }),
      );
    });
  });

  describe('setPassword', () => {
    it('stores the new password and audits the fact without the value', async () => {
      await service.setPassword(owner, 'u-target', { password: 'nova-parolya' });

      expect(credentials.set).toHaveBeenCalledWith('u-target', 'nova-parolya');
      const entry = audit.record.mock.calls[0][0];
      expect(entry.action).toBe('user.password-changed');
      expect(entry.before).toBeUndefined();
      expect(entry.after).toBeUndefined();
      expect(JSON.stringify(entry)).not.toContain('nova-parolya');
    });
  });

  /**
   * The null-versus-undefined asymmetry, from both directions. `first_name`,
   * `last_name`, `login`, `role` and `is_active` are NOT NULL columns, so an
   * explicit `null` must be a 400 — `@IsOptional()` would skip every
   * subsequent validator and let it through to a 500 at the database.
   * `collection_point_id` IS nullable, and `null` is precisely what a
   * network_owner must have, so there the explicit `null` must be ACCEPTED
   * and APPLIED.
   */
  describe('UpdateUserDto nullability', () => {
    const dtoWith = (over: Record<string, unknown>) => Object.assign(new UpdateUserDto(), over);

    it.each(['first_name', 'last_name', 'login', 'role', 'is_active'])(
      'rejects an explicit null on the NOT NULL column %s',
      async (field) => {
        const errors = await validate(dtoWith({ [field]: null }));
        expect(errors).toHaveLength(1);
        expect(errors[0].property).toBe(field);
      },
    );

    it('accepts an explicit null on collection_point_id — an owner has none', async () => {
      expect(await validate(dtoWith({ collection_point_id: null }))).toHaveLength(0);
    });

    it('accepts an entirely absent body and a well-formed one', async () => {
      expect(await validate(dtoWith({}))).toHaveLength(0);
      expect(await validate(dtoWith({ first_name: 'Оксана', is_active: false }))).toHaveLength(0);
    });
  });

  describe('null versus absent in update()', () => {
    it('APPLIES an explicit null collection_point_id, which an operator may not have', async () => {
      await expect(
        service.update(owner, 'u-target', { collection_point_id: null }),
      ).rejects.toThrow(BadRequestException);
    });

    /**
     * The regression this repo would otherwise ship: `tsconfig.json` targets
     * ES2023, so `useDefineForClassFields` defaults to TRUE and every declared
     * DTO field EXISTS on a transformed instance as `undefined`. `'x' in dto`
     * is therefore ALWAYS true after the global ValidationPipe's
     * `transform: true`, and a `PATCH {first_name}` would read as "clear this
     * operator's point" — a 400 on a request that touched only a name. Object
     * literals in the tests above cannot see it; a real `plainToInstance` can.
     */
    it('leaves the point alone when the field is absent from a TRANSFORMED dto', async () => {
      const dto = plainToInstance(UpdateUserDto, { first_name: 'Нове' });
      expect('collection_point_id' in dto).toBe(true); // the trap itself

      await service.update(owner, 'u-target', dto);
      expect(users.update).toHaveBeenCalledWith(
        'u-target',
        expect.objectContaining({ collection_point_id: 'p-1' }),
      );
    });

    it('ignores an explicit null on a NOT NULL field rather than assigning it', async () => {
      const dto = plainToInstance(UpdateUserDto, { first_name: null, last_name: 'Нове' });
      await service.update(owner, 'u-target', dto);

      const [, patch] = users.update.mock.calls[0];
      expect(patch).not.toHaveProperty('first_name');
      expect(patch).toMatchObject({ last_name: 'Нове' });
    });
  });
});

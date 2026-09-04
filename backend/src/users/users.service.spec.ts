import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { UsersService } from './users.service';
import { User } from './user.entity';
import { UserIdentity, LOCAL_PROVIDER } from './user-identity.entity';

/**
 * A stand-in EntityManager for createWithIdentity's transaction closure.
 * `create` mimics TypeORM's shallow-merge behaviour; `save` resolves with
 * whatever it was given. Distinct identity from userRepo.manager, so any
 * assertion that onCreated received *this* object fails if the real code
 * passed the outer repository manager instead of the transaction's manager.
 */
function fakeEntityManager() {
  return {
    create: jest.fn((_entity: unknown, data: object) => ({ ...data })),
    save: jest.fn((entity: unknown) => Promise.resolve(entity)),
  } as unknown as EntityManager;
}

describe('UsersService', () => {
  let service: UsersService;
  const userRepo = { findOne: jest.fn(), update: jest.fn(), manager: { transaction: jest.fn() } };
  const identityRepo = { findOne: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(UserIdentity), useValue: identityRepo },
      ],
    }).compile();
    service = moduleRef.get(UsersService);
  });

  it('looks an identity up by provider and lowercased id, loading its user', async () => {
    const identity = { id: 'i1', user: { id: 'u1' } };
    identityRepo.findOne.mockResolvedValue(identity);

    await expect(service.findByIdentity(LOCAL_PROVIDER, 'alice')).resolves.toBe(identity);
    expect(identityRepo.findOne).toHaveBeenCalledWith({
      where: { provider: LOCAL_PROVIDER, provider_user_id: 'alice' },
      relations: { user: true },
    });
  });

  it('returns null when no identity matches', async () => {
    identityRepo.findOne.mockResolvedValue(null);
    await expect(service.findByIdentity(LOCAL_PROVIDER, 'nobody')).resolves.toBeNull();
  });

  it('throws NotFound for an unknown user id', async () => {
    userRepo.findOne.mockResolvedValue(null);
    await expect(service.findById('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns the user unchanged when update is given no fields', async () => {
    const user = { id: 'u1' } as User;
    userRepo.findOne.mockResolvedValue(user);
    await expect(service.update('u1', {})).resolves.toBe(user);
    expect(userRepo.update).not.toHaveBeenCalled();
  });

  describe('createWithIdentity', () => {
    it('returns the created user and identity carrying the given provider fields', async () => {
      const manager = fakeEntityManager();
      userRepo.manager.transaction.mockImplementation((cb: (em: EntityManager) => unknown) =>
        cb(manager),
      );

      const result = await service.createWithIdentity({
        provider: LOCAL_PROVIDER,
        providerUserId: 'carol',
        display_name: 'Carol',
      });

      expect(result.identity.provider).toBe(LOCAL_PROVIDER);
      expect(result.identity.provider_user_id).toBe('carol');
      expect(result.user.display_name).toBe('Carol');
    });

    it('runs onCreated inside the transaction, passing it the same manager, before the transaction settles', async () => {
      const manager = fakeEntityManager();
      let cbSettled = false;
      userRepo.manager.transaction.mockImplementation(
        async (cb: (em: EntityManager) => Promise<unknown>) => {
          const result = await cb(manager);
          cbSettled = true;
          return result;
        },
      );

      // A manually-released gate, not a bare microtask hop: this makes the
      // assertion below deterministic instead of racing the event loop. If
      // onCreated is ever awaited, cbSettled cannot flip true until we
      // release the gate ourselves.
      let releaseOnCreated!: () => void;
      const gate = new Promise<void>((resolve) => {
        releaseOnCreated = resolve;
      });
      const onCreated = jest.fn(async (_user: User, em: EntityManager) => {
        expect(em).toBe(manager);
        await gate;
      });

      const createPromise = service.createWithIdentity(
        { provider: LOCAL_PROVIDER, providerUserId: 'dave' },
        onCreated,
      );

      // Flush any pending microtasks/timers. If onCreated were fired without
      // being awaited (or run after the transaction closure), cbSettled would
      // already be true here even though the gate is still held closed.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(onCreated).toHaveBeenCalledTimes(1);
      expect(cbSettled).toBe(false);

      releaseOnCreated();
      await createPromise;

      expect(cbSettled).toBe(true);
    });

    it('propagates a throw from onCreated and never lets the transaction settle', async () => {
      const manager = fakeEntityManager();
      let settled = false;
      userRepo.manager.transaction.mockImplementation(
        async (cb: (em: EntityManager) => Promise<unknown>) => {
          const result = await cb(manager);
          settled = true;
          return result;
        },
      );
      const error = new Error('credential write failed');
      const onCreated = jest.fn().mockRejectedValue(error);

      await expect(
        service.createWithIdentity({ provider: LOCAL_PROVIDER, providerUserId: 'erin' }, onCreated),
      ).rejects.toThrow('credential write failed');
      expect(settled).toBe(false);
    });
  });
});

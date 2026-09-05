import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { EntityManager } from 'typeorm';
import { CredentialsService } from './credentials.service';
import { UserCredentials } from './user-credentials.entity';

// scrypt is deliberately expensive, and these cases derive several keys each.
// Raising the budget is the right lever here — lowering the cost parameters to
// fit a 5s default would weaken the thing under test.
jest.setTimeout(20_000);

describe('CredentialsService', () => {
  const rows = new Map<string, UserCredentials>();
  const repo = {
    findOne: jest.fn(({ where }: { where: { user_id: string } }) =>
      Promise.resolve(rows.get(where.user_id) ?? null),
    ),
    upsert: jest.fn((row: UserCredentials) => {
      rows.set(row.user_id, row);
      return Promise.resolve({ identifiers: [] });
    }),
  };

  let service: CredentialsService;

  beforeEach(async () => {
    rows.clear();
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        CredentialsService,
        { provide: getRepositoryToken(UserCredentials), useValue: repo },
      ],
    }).compile();
    service = moduleRef.get(CredentialsService);
  });

  it('stores a credential and verifies the matching password', async () => {
    await service.set('user-1', 'correct horse');
    await expect(service.verify('user-1', 'correct horse')).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    await service.set('user-1', 'correct horse');
    await expect(service.verify('user-1', 'battery staple')).resolves.toBe(false);
  });

  it('rejects a user with no stored credential', async () => {
    await expect(service.verify('nobody', 'anything')).resolves.toBe(false);
  });

  it('overwrites an existing credential on set', async () => {
    await service.set('user-1', 'first');
    await service.set('user-1', 'second');
    await expect(service.verify('user-1', 'first')).resolves.toBe(false);
    await expect(service.verify('user-1', 'second')).resolves.toBe(true);
  });

  it('writes through a given manager instead of the default repo', async () => {
    const managerRows = new Map<string, UserCredentials>();
    const managerRepo = {
      upsert: jest.fn((row: UserCredentials) => {
        managerRows.set(row.user_id, row);
        return Promise.resolve({ identifiers: [] });
      }),
    };
    const manager = {
      getRepository: jest.fn().mockReturnValue(managerRepo),
    } as unknown as EntityManager;

    await service.set('user-2', 'via-manager', manager);

    // The write must land on the manager's repo, not the constructor-injected one.
    expect(manager.getRepository).toHaveBeenCalledWith(UserCredentials);
    expect(managerRepo.upsert).toHaveBeenCalledTimes(1);
    expect(repo.upsert).not.toHaveBeenCalled();
    // The stored value is a verifier, not the password: assert the shape, and
    // that the plaintext is nowhere in it.
    const stored = managerRows.get('user-2')?.password_hash;
    expect(stored).not.toContain('via-manager');
    expect(stored?.startsWith('scrypt$')).toBe(true);
  });

  // The whole point of the change: `set` must never persist what it was given.
  it('never stores the password itself', async () => {
    await service.set('user-1', 'hunter2!!');
    const stored = repo.upsert.mock.calls[0][0].password_hash;

    expect(stored).not.toContain('hunter2!!');
    expect(stored.startsWith('scrypt$')).toBe(true);
  });
});

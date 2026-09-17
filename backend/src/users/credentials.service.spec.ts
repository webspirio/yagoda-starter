import { randomBytes } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { EntityManager } from 'typeorm';
import { CredentialsService } from './credentials.service';
import { UserCredentials } from './user-credentials.entity';
import { authConfig } from '../config/auth.config';
import { VAULT_KEY_BYTES } from './secret-box';

// scrypt is deliberately expensive, and these cases derive several keys each.
// Raising the budget is the right lever here — lowering the cost parameters to
// fit a 5s default would weaken the thing under test.
jest.setTimeout(20_000);

const VAULT_KEY = randomBytes(VAULT_KEY_BYTES).toString('base64');

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

  // `passwordVaultKey` is what turns the readable copy on, so every case says
  // which world it is in rather than inheriting one.
  async function makeService(passwordVaultKey = ''): Promise<CredentialsService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        CredentialsService,
        { provide: getRepositoryToken(UserCredentials), useValue: repo },
        { provide: authConfig.KEY, useValue: { passwordVaultKey } },
      ],
    }).compile();
    return moduleRef.get(CredentialsService);
  }

  let service: CredentialsService;

  beforeEach(async () => {
    rows.clear();
    jest.clearAllMocks();
    service = await makeService();
  });

  it('stores a credential and verifies the matching password', async () => {
    await service.set('user-1', 'correct horse');
    await expect(service.verify('user-1', 'correct horse')).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    await service.set('user-1', 'battery staple');
    await expect(service.verify('user-1', 'correct horse')).resolves.toBe(false);
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

  // The whole point of the hash: `set` must never persist what it was given.
  it('never stores the password itself in the verifier', async () => {
    await service.set('user-1', 'hunter2!!');
    const stored = repo.upsert.mock.calls[0][0].password_hash;

    expect(stored).not.toContain('hunter2!!');
    expect(stored.startsWith('scrypt$')).toBe(true);
  });

  describe('with no vault key — the default', () => {
    it('writes no readable copy at all', async () => {
      await service.set('user-1', 'hunter2!!');
      expect(repo.upsert.mock.calls[0][0].password_enc).toBeNull();
    });

    it('reveals nothing, even for a user who has a credential', async () => {
      await service.set('user-1', 'hunter2!!');
      await expect(service.reveal('user-1')).resolves.toBeNull();
    });

    // Turning the vault OFF must not leave yesterday's readable passwords
    // lying in the table: the next reissue clears the column.
    it('clears a copy left by a previous run that had a key', async () => {
      const withVault = await makeService(VAULT_KEY);
      await withVault.set('user-1', 'old');
      expect(rows.get('user-1')?.password_enc).not.toBeNull();

      await service.set('user-1', 'new');
      expect(rows.get('user-1')?.password_enc).toBeNull();
    });
  });

  describe('with a vault key', () => {
    beforeEach(async () => {
      service = await makeService(VAULT_KEY);
    });

    it('reveals the password it was given', async () => {
      await service.set('user-1', 'correct horse');
      await expect(service.reveal('user-1')).resolves.toBe('correct horse');
    });

    it('still verifies against the hash, not the readable copy', async () => {
      await service.set('user-1', 'correct horse');
      // Corrupt ONLY the vault copy: login must be entirely unaffected by it.
      rows.get('user-1')!.password_enc = 'a256gcm$aaaa$bbbb$cccc';
      await expect(service.verify('user-1', 'correct horse')).resolves.toBe(true);
      await expect(service.reveal('user-1')).resolves.toBeNull();
    });

    it('keeps the plaintext out of the stored value', async () => {
      await service.set('user-1', 'hunter2!!');
      const stored = repo.upsert.mock.calls[0][0].password_enc as string;
      expect(stored).not.toContain('hunter2!!');
      expect(stored.startsWith('a256gcm$')).toBe(true);
    });

    it('reveals the newest password after a reissue', async () => {
      await service.set('user-1', 'first');
      await service.set('user-1', 'second');
      await expect(service.reveal('user-1')).resolves.toBe('second');
    });

    it('reveals nothing for a user with no credential row', async () => {
      await expect(service.reveal('nobody')).resolves.toBeNull();
    });

    // A password issued before the vault existed has a hash and nothing else.
    // The owner is told to reissue; the account keeps working meanwhile.
    it('reveals nothing for a credential stored before the vault', async () => {
      const beforeVault = await makeService();
      await beforeVault.set('user-1', 'issued earlier');
      await expect(service.reveal('user-1')).resolves.toBeNull();
    });

    it('reveals nothing when the key no longer opens the copy', async () => {
      await service.set('user-1', 'correct horse');
      const rotated = await makeService(randomBytes(VAULT_KEY_BYTES).toString('base64'));
      await expect(rotated.reveal('user-1')).resolves.toBeNull();
      // …and the account still logs in: the hash never depended on the key.
      await expect(rotated.verify('user-1', 'correct horse')).resolves.toBe(true);
    });
  });
});

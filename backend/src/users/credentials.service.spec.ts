import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CredentialsService } from './credentials.service';
import { UserCredentials } from './user-credentials.entity';

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
});

import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from './user.entity';
import { UserIdentity, LOCAL_PROVIDER } from './user-identity.entity';

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
});

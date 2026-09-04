import { Test } from '@nestjs/testing';
import { CurrentUserService } from './current-user.service';
import { UsersService } from '../users/users.service';
import { AuditService } from '../audit/audit.service';

describe('CurrentUserService', () => {
  let service: CurrentUserService;
  const users = { findById: jest.fn(), update: jest.fn() };
  const audit = { record: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        CurrentUserService,
        { provide: UsersService, useValue: users },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();
    service = moduleRef.get(CurrentUserService);
  });

  it('reads the profile, taking the username from the token', async () => {
    users.findById.mockResolvedValue({
      id: 'u1',
      display_name: 'Alice',
      avatar_url: null,
      language_code: 'en',
    });

    await expect(service.getMe({ sub: 'u1', username: 'alice', display_name: null, avatar_url: null }))
      .resolves.toEqual({
        id: 'u1',
        username: 'alice',
        display_name: 'Alice',
        avatar_url: null,
        language_code: 'en',
      });
  });

  it('records what changed when the profile is updated', async () => {
    users.findById.mockResolvedValue({ id: 'u1', display_name: 'Old', avatar_url: null, language_code: 'en' });
    users.update.mockResolvedValue({ id: 'u1', display_name: 'New', avatar_url: null, language_code: 'en' });

    await service.updateMe(
      { sub: 'u1', username: 'alice', display_name: null, avatar_url: null },
      { display_name: 'New' },
    );

    expect(audit.record).toHaveBeenCalledWith({
      action: 'user.updated',
      actor_id: 'u1',
      target_type: 'user',
      target_id: 'u1',
      before: { display_name: 'Old' },
      after: { display_name: 'New' },
    });
  });

  it('does not record an audit entry when nothing actually changed', async () => {
    users.findById.mockResolvedValue({ id: 'u1', display_name: 'Same', avatar_url: null, language_code: 'en' });
    users.update.mockResolvedValue({ id: 'u1', display_name: 'Same', avatar_url: null, language_code: 'en' });

    await service.updateMe(
      { sub: 'u1', username: 'alice', display_name: null, avatar_url: null },
      { display_name: 'Same' },
    );

    expect(audit.record).not.toHaveBeenCalled();
  });
});

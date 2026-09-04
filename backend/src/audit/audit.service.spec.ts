import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditService } from './audit.service';
import { AuditLog } from './audit-log.entity';

describe('AuditService', () => {
  let service: AuditService;
  const repo = {
    insert: jest.fn().mockResolvedValue({ identifiers: [] }),
    findAndCount: jest.fn().mockResolvedValue([[], 0]),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [AuditService, { provide: getRepositoryToken(AuditLog), useValue: repo }],
    }).compile();
    service = moduleRef.get(AuditService);
  });

  it('records an entry with its polymorphic target', async () => {
    await service.record({
      action: 'user.updated',
      actor_id: 'actor-1',
      target_type: 'user',
      target_id: 'user-2',
      before: { display_name: 'old' },
      after: { display_name: 'new' },
    });

    expect(repo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'user.updated',
        actor_id: 'actor-1',
        target_type: 'user',
        target_id: 'user-2',
        before: { display_name: 'old' },
        after: { display_name: 'new' },
      }),
    );
  });

  it('defaults every optional field to null so the row shape is stable', async () => {
    await service.record({ action: 'user.logged-in', actor_id: 'actor-1' });

    expect(repo.insert).toHaveBeenCalledWith({
      action: 'user.logged-in',
      actor_id: 'actor-1',
      target_type: null,
      target_id: null,
      before: null,
      after: null,
      note: null,
    });
  });

  it('lists newest first and paginates', async () => {
    repo.findAndCount.mockResolvedValue([[{ id: 'a' }], 1]);

    await expect(service.list({ page: 2, limit: 10 })).resolves.toEqual({
      data: [{ id: 'a' }],
      total: 1,
      page: 2,
      limit: 10,
    });
    expect(repo.findAndCount).toHaveBeenCalledWith({
      order: { at: 'DESC' },
      skip: 10,
      take: 10,
    });
  });
});

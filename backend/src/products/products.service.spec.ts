import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { UserRole } from '../users/user-role.enum';
import { ProductsService } from './products.service';

const owner = {
  sub: 'u-owner',
  username: 'owner',
  role: UserRole.NetworkOwner,
  collection_point_id: null,
};

describe('ProductsService', () => {
  let repo: {
    findAndCount: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let audit: { record: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let service: ProductsService;
  let nameLookup: jest.Mock;

  const product = (over: Record<string, unknown> = {}) => ({
    id: 'prod-1',
    name: 'Малина',
    created_at: new Date('2026-07-15T06:00:00.000Z'),
    updated_at: new Date('2026-07-15T06:00:00.000Z'),
    ...over,
  });

  beforeEach(() => {
    // `getOne` backs assertNameFree's case-insensitive lookup. Default "no such
    // row" so a create() never sees its own name as taken.
    nameLookup = jest.fn().mockResolvedValue(null);
    repo = {
      findAndCount: jest.fn().mockResolvedValue([[product()], 1]),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockImplementation((p) => Promise.resolve(p)),
      create: jest.fn().mockImplementation((p) => product(p)),
      createQueryBuilder: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        getOne: nameLookup,
      }),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    // Run the callback against the same mock repo, so a transactional write is
    // exercised exactly like a plain one.
    dataSource = {
      transaction: jest.fn().mockImplementation((cb) => cb({ getRepository: () => repo })),
    };
    service = new ProductsService(repo as never, dataSource as never, audit as never);
  });

  describe('list', () => {
    it('orders by name and returns the paginated envelope', async () => {
      const result = await service.list({ page: 1, limit: 100 });
      expect(repo.findAndCount).toHaveBeenCalledWith({
        order: { name: 'ASC' },
        skip: 0,
        take: 100,
      });
      expect(result).toEqual({
        data: [{ id: 'prod-1', name: 'Малина', created_at: '2026-07-15T06:00:00.000Z' }],
        total: 1,
        page: 1,
        limit: 100,
      });
    });
  });

  describe('create', () => {
    it('trims the name and records an audit entry inside the transaction', async () => {
      const result = await service.create(owner, { name: '  Малина  ' });
      expect(repo.create).toHaveBeenCalledWith({ name: 'Малина' });
      expect(result.name).toBe('Малина');
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'product.created',
          actor_id: 'u-owner',
          target_type: 'product',
          after: { name: 'Малина' },
        }),
        expect.anything(),
      );
    });

    it('rejects an all-whitespace name with a 400', async () => {
      await expect(service.create(owner, { name: '   ' })).rejects.toThrow(BadRequestException);
    });

    it('rejects a name that already exists, ignoring case', async () => {
      nameLookup.mockResolvedValue(product({ name: 'малина' }));
      await expect(service.create(owner, { name: 'Малина' })).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('404s on an unknown id', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.update(owner, 'nope', { name: 'X' })).rejects.toThrow(NotFoundException);
    });

    it('renames and audits only the field that moved', async () => {
      repo.findOne.mockResolvedValue(product());
      await service.update(owner, 'prod-1', { name: 'Полуниця' });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'product.updated',
          before: { name: 'Малина' },
          after: { name: 'Полуниця' },
        }),
        expect.anything(),
      );
    });

    it('writes no audit entry for a no-op PATCH', async () => {
      repo.findOne.mockResolvedValue(product());
      await service.update(owner, 'prod-1', {});
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('allows a pure case correction without a uniqueness conflict', async () => {
      repo.findOne.mockResolvedValue(product({ name: 'малина' }));
      await service.update(owner, 'prod-1', { name: 'Малина' });
      // The row is itself — no lookup, no 409.
      expect(nameLookup).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalled();
    });
  });
});

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { UserRole } from '../users/user-role.enum';
import { ProductGradesService } from './product-grades.service';

const owner = {
  sub: 'u-owner',
  username: 'owner',
  role: UserRole.NetworkOwner,
  collection_point_id: null,
};

describe('ProductGradesService', () => {
  let repo: {
    findAndCount: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  // A DISTINCT repo object standing in for `manager.getRepository(ProductGrade)`
  // inside the transaction. If this were the same object as `repo`, a
  // regression that swapped `manager.getRepository(ProductGrade).save(...)` for
  // `this.repo.save(...)` — escaping the transaction, so the audit entry could
  // survive a rolled-back write — would be invisible: both mocks would look
  // identical and the suite would pass regardless. Keeping them apart is what
  // lets the assertions below actually prove which repo a save went through.
  let txRepo: { create: jest.Mock; save: jest.Mock };
  let manager: { getRepository: () => typeof txRepo };
  let products: { findOneRaw: jest.Mock };
  let audit: { record: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let service: ProductGradesService;
  let nameLookup: jest.Mock;

  const grade = (over: Record<string, unknown> = {}) => ({
    id: 'grade-1',
    product_id: 'prod-1',
    name: '1 сорт',
    is_active: true,
    created_at: new Date('2026-07-15T06:00:00.000Z'),
    updated_at: new Date('2026-07-15T06:00:00.000Z'),
    ...over,
  });

  beforeEach(() => {
    nameLookup = jest.fn().mockResolvedValue(null);
    repo = {
      findAndCount: jest.fn().mockResolvedValue([[grade()], 1]),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockImplementation((g) => Promise.resolve(g)),
      create: jest.fn().mockImplementation((g) => grade(g)),
      createQueryBuilder: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: nameLookup,
      }),
    };
    // Same merge behaviour as `repo.create` above, but on a repo the
    // non-transactional paths (`findOne`, `createQueryBuilder`) never see.
    txRepo = {
      create: jest.fn().mockImplementation((g) => grade(g)),
      save: jest.fn().mockImplementation((g) => Promise.resolve(g)),
    };
    manager = { getRepository: () => txRepo };
    products = { findOneRaw: jest.fn().mockResolvedValue({ id: 'prod-1', name: 'Малина' }) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    // Resolve the callback against `manager`, which hands back `txRepo` — NOT
    // `repo`. A transactional write and a plain read must go through
    // observably different repos, or the transaction boundary is unproven.
    dataSource = {
      transaction: jest.fn().mockImplementation((cb) => cb(manager)),
    };
    service = new ProductGradesService(
      repo as never,
      products as never,
      dataSource as never,
      audit as never,
    );
  });

  describe('list', () => {
    it('hides inactive grades by default', async () => {
      await service.list({ page: 1, limit: 100 });
      expect(repo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { is_active: true }, order: { name: 'ASC' } }),
      );
    });

    it('includes inactive grades when asked', async () => {
      await service.list({ page: 1, limit: 100, include_inactive: true });
      expect(repo.findAndCount).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
    });

    it('filters by product_id', async () => {
      await service.list({ page: 1, limit: 100, product_id: 'prod-1' });
      expect(repo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { product_id: 'prod-1', is_active: true } }),
      );
    });
  });

  describe('create', () => {
    it('404s when the parent product does not exist', async () => {
      products.findOneRaw.mockResolvedValue(null);
      await expect(
        service.create(owner, { product_id: 'nope', name: '1 сорт' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates and audits inside the transaction', async () => {
      const result = await service.create(owner, { product_id: 'prod-1', name: ' 1 сорт ' });
      // The write goes through the transactional repo, never the plain one.
      expect(txRepo.create).toHaveBeenCalledWith({ product_id: 'prod-1', name: '1 сорт' });
      expect(txRepo.save).toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
      expect(result.product_id).toBe('prod-1');
      // The audit entry must commit atomically with the write, so it has to
      // carry the SAME manager the transaction callback received — not just
      // some object shaped like one.
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'product-grade.created',
          target_type: 'product_grade',
          after: { product_id: 'prod-1', name: '1 сорт' },
        }),
        manager,
      );
    });

    it('rejects an all-whitespace name with a 400', async () => {
      await expect(
        service.create(owner, { product_id: 'prod-1', name: '   ' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('409s on a name already used under the SAME product, ignoring case', async () => {
      nameLookup.mockResolvedValue(grade({ name: '1 СОРТ' }));
      await expect(
        service.create(owner, { product_id: 'prod-1', name: '1 сорт' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('deactivates the last active grade without complaint — that is the retirement mechanism', async () => {
      repo.findOne.mockResolvedValue(grade());
      const result = await service.update(owner, 'grade-1', { is_active: false });
      expect(result.is_active).toBe(false);
      // The update is saved through the transactional repo, never the plain
      // one — the entity found via `repo.findOne` must be persisted via
      // `manager.getRepository(ProductGrade)`, not `this.repo`.
      expect(txRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'grade-1', is_active: false }),
      );
      expect(repo.save).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'product-grade.updated',
          before: { is_active: true },
          after: { is_active: false },
        }),
        manager,
      );
    });

    it('never moves a grade to another product', async () => {
      repo.findOne.mockResolvedValue(grade());
      // `product_id` is not part of UpdateProductGradeDto; passing it must not
      // reach the row. The global ValidationPipe's forbidNonWhitelisted would
      // already 400 it over HTTP — this proves the service does not read it.
      await service.update(owner, 'grade-1', { product_id: 'prod-2' } as never);
      expect(txRepo.save).toHaveBeenCalledWith(expect.objectContaining({ product_id: 'prod-1' }));
    });

    it('writes no audit entry for a no-op PATCH', async () => {
      repo.findOne.mockResolvedValue(grade());
      await service.update(owner, 'grade-1', {});
      expect(audit.record).not.toHaveBeenCalled();
    });
  });
});

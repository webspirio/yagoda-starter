import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { UserRole } from '../users/user-role.enum';
import { TareTypesService } from './tare-types.service';

const owner = {
  sub: 'u-owner',
  username: 'owner',
  role: UserRole.NetworkOwner,
  collection_point_id: null,
};

describe('TareTypesService', () => {
  let repo: {
    findAndCount: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  // A DISTINCT repo object standing in for `manager.getRepository(TareType)`
  // inside the transaction. If this were the same object as `repo`, a
  // regression that swapped `manager.getRepository(TareType).save(...)` for
  // `this.repo.save(...)` — escaping the transaction, so the audit entry could
  // survive a rolled-back write — would be invisible: both mocks would look
  // identical and the suite would pass regardless. Keeping them apart is what
  // lets the assertions below actually prove which repo a save went through.
  let txRepo: { create: jest.Mock; save: jest.Mock };
  let manager: { getRepository: () => typeof txRepo };
  let audit: { record: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let service: TareTypesService;
  let nameLookup: jest.Mock;

  const tare = (over: Record<string, unknown> = {}) => ({
    id: 'tare-1',
    name: 'Ящик',
    weight_kg: '1.20',
    deposit_price: '120.00',
    is_crate: true,
    is_active: true,
    created_at: new Date('2026-07-15T06:00:00.000Z'),
    updated_at: new Date('2026-07-15T06:00:00.000Z'),
    ...over,
  });

  beforeEach(() => {
    nameLookup = jest.fn().mockResolvedValue(null);
    repo = {
      findAndCount: jest.fn().mockResolvedValue([[tare()], 1]),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockImplementation((t) => Promise.resolve(t)),
      create: jest.fn().mockImplementation((t) => tare(t)),
      createQueryBuilder: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        getOne: nameLookup,
      }),
    };
    // Same merge behaviour as `repo.create` above, but on a repo the
    // non-transactional paths (`findOne`, `createQueryBuilder`) never see.
    txRepo = {
      create: jest.fn().mockImplementation((t) => tare(t)),
      save: jest.fn().mockImplementation((t) => Promise.resolve(t)),
    };
    manager = { getRepository: () => txRepo };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    // Resolve the callback against `manager`, which hands back `txRepo` — NOT
    // `repo`. A transactional write and a plain read must go through
    // observably different repos, or the transaction boundary is unproven.
    dataSource = {
      transaction: jest.fn().mockImplementation((cb) => cb(manager)),
    };
    service = new TareTypesService(repo as never, dataSource as never, audit as never);
  });

  it('returns both numbers as strings, never numbers', async () => {
    const result = await service.list({ page: 1, limit: 100 });
    expect(result.data[0].weight_kg).toBe('1.20');
    expect(typeof result.data[0].weight_kg).toBe('string');
    expect(typeof result.data[0].deposit_price).toBe('string');
  });

  it('hides inactive tare types by default', async () => {
    await service.list({ page: 1, limit: 100 });
    expect(repo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: { is_active: true }, order: { name: 'ASC' } }),
    );
  });

  describe('create', () => {
    it('stores both numbers verbatim and audits inside the transaction', async () => {
      const result = await service.create(owner, {
        name: ' Ящик ',
        weight_kg: '1.20',
        deposit_price: '120.00',
        is_crate: true,
      });
      // The write goes through the transactional repo, never the plain one.
      expect(txRepo.create).toHaveBeenCalledWith({
        name: 'Ящик',
        weight_kg: '1.20',
        deposit_price: '120.00',
        is_crate: true,
      });
      expect(txRepo.save).toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
      expect(result.deposit_price).toBe('120.00');
      // The audit entry must commit atomically with the write, so it has to
      // carry the SAME manager the transaction callback received — not just
      // some object shaped like one.
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'tare-type.created', target_type: 'tare_type' }),
        manager,
      );
    });

    it('defaults is_crate to false when not given', async () => {
      await service.create(owner, { name: 'Відро', weight_kg: '0.30', deposit_price: '0.00' });
      expect(txRepo.create).toHaveBeenCalledWith(expect.objectContaining({ is_crate: false }));
    });

    it('rejects an all-whitespace name with a 400', async () => {
      await expect(
        service.create(owner, { name: '  ', weight_kg: '1.00', deposit_price: '0.00' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('409s on a name that exists in another case', async () => {
      nameLookup.mockResolvedValue(tare({ name: 'ящик' }));
      await expect(
        service.create(owner, { name: 'Ящик', weight_kg: '1.20', deposit_price: '120.00' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('404s on an unknown id', async () => {
      await expect(service.update(owner, 'nope', { weight_kg: '1.00' })).rejects.toThrow(
        NotFoundException,
      );
    });

    // tare_types keeps no history of its own, and §2.7 snapshots these values
    // downstream — so the audit log is the ONLY record that a deposit moved.
    it('audits a deposit change, which nothing else in the database records', async () => {
      repo.findOne.mockResolvedValue(tare());
      await service.update(owner, 'tare-1', { deposit_price: '130.00' });
      // The update is saved through the transactional repo, never the plain
      // one — the entity found via `repo.findOne` must be persisted via
      // `manager.getRepository(TareType)`, not `this.repo`.
      expect(txRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'tare-1', deposit_price: '130.00' }),
      );
      expect(repo.save).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'tare-type.updated',
          before: { deposit_price: '120.00' },
          after: { deposit_price: '130.00' },
        }),
        manager,
      );
    });

    it('allows a non-crate to carry a deposit price — there is no cross-rule', async () => {
      repo.findOne.mockResolvedValue(tare({ is_crate: false }));
      await expect(
        service.update(owner, 'tare-1', { deposit_price: '50.00' }),
      ).resolves.toBeDefined();
    });

    it('writes no audit entry for a no-op PATCH', async () => {
      repo.findOne.mockResolvedValue(tare());
      await service.update(owner, 'tare-1', {});
      expect(audit.record).not.toHaveBeenCalled();
    });
  });
});

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '../../users/user-role.enum';
import { UpdateSupplierCommand } from './update-supplier.command';
import { SupplierKind } from '../supplier-kind.enum';

const POINT_A = '11111111-1111-1111-1111-111111111111';
const POINT_B = '22222222-2222-2222-2222-222222222222';

const operator = { sub: 'u-op', username: 'op', role: UserRole.PointOperator, collection_point_id: POINT_A };

describe('UpdateSupplierCommand', () => {
  let repo: {
    findAndCount: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let txRepo: { create: jest.Mock; save: jest.Mock };
  let manager: { getRepository: () => typeof txRepo };
  let audit: { record: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let qb: {
    where: jest.Mock; andWhere: jest.Mock; orderBy: jest.Mock; addOrderBy: jest.Mock;
    skip: jest.Mock; take: jest.Mock; getManyAndCount: jest.Mock; getOne: jest.Mock;
  };
  let command: UpdateSupplierCommand;

  const supplier = (over: Record<string, unknown> = {}) => ({
    id: 's-1',
    collection_point_id: POINT_A,
    first_name: 'Іван',
    last_name: 'Коваль',
    phone: '+380671234567',
    note: null,
    kind: SupplierKind.None,
    is_active: true,
    created_at: new Date('2026-07-15T06:00:00.000Z'),
    updated_at: new Date('2026-07-15T06:00:00.000Z'),
    ...over,
  });

  beforeEach(() => {
    qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[supplier()], 1]),
      getOne: jest.fn().mockResolvedValue(null),
    };
    repo = {
      findAndCount: jest.fn().mockResolvedValue([[supplier()], 1]),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockImplementation((s) => Promise.resolve(s)),
      create: jest.fn().mockImplementation((s) => supplier(s)),
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    };
    // A DISTINCT repo standing in for `manager.getRepository(Supplier)`. If it
    // were the same object as `repo`, a regression that escaped the
    // transaction — leaving an audit entry that could survive a rolled-back
    // write — would be invisible.
    txRepo = {
      create: jest.fn().mockImplementation((s) => supplier(s)),
      save: jest.fn().mockImplementation((s) => Promise.resolve(s)),
    };
    manager = { getRepository: () => txRepo };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    dataSource = { transaction: jest.fn().mockImplementation((cb) => cb(manager)) };
    command = new UpdateSupplierCommand(repo as never, dataSource as never, audit as never);
  });

  describe('update', () => {
    beforeEach(() => repo.findOne.mockResolvedValue(supplier()));

    it('404s on an unknown id', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(command.update(operator, 's-x', {} as never)).rejects.toThrow(NotFoundException);
    });

    it('refuses an operator touching another point’s supplier', async () => {
      repo.findOne.mockResolvedValue(supplier({ collection_point_id: POINT_B }));
      await expect(command.update(operator, 's-1', { note: 'hi' } as never)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('writes NO audit entry for a no-op PATCH', async () => {
      await command.update(operator, 's-1', {} as never);
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('audits only the fields that moved', async () => {
      await command.update(operator, 's-1', { kind: SupplierKind.Wholesale } as never);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'supplier.updated',
          before: { kind: SupplierKind.None },
          after: { kind: SupplierKind.Wholesale },
        }),
        manager,
      );
    });

    it('canonicalizes a changed phone', async () => {
      await command.update(operator, 's-1', { phone: '(050) 987-65-43' } as never);
      expect(txRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ phone: '+380509876543' }),
      );
    });

    it('accepts an explicit null phone — clearing it is legal', async () => {
      await command.update(operator, 's-1', { phone: null } as never);
      expect(txRepo.save).toHaveBeenCalledWith(expect.objectContaining({ phone: null }));
    });

    it('skips the pre-check when the canonical phone is unchanged', async () => {
      // '067 123 45 67' canonicalizes to the value already stored, so this is
      // not a change and must not 409 against the row itself.
      await command.update(operator, 's-1', { phone: '067 123 45 67' } as never);
      expect(qb.getOne).not.toHaveBeenCalled();
    });

    it('deactivation is never blocked', async () => {
      await expect(
        command.update(operator, 's-1', { is_active: false } as never),
      ).resolves.toBeDefined();
    });
  });
});

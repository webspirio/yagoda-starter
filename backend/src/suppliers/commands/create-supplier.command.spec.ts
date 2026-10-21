import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '../../users/user-role.enum';
import { CreateSupplierCommand } from './create-supplier.command';
import { SupplierKind } from '../supplier-kind.enum';

const POINT_A = '11111111-1111-1111-1111-111111111111';
const POINT_B = '22222222-2222-2222-2222-222222222222';

const owner = { sub: 'u-owner', username: 'owner', role: UserRole.NetworkOwner, collection_point_id: null };
const operator = { sub: 'u-op', username: 'op', role: UserRole.PointOperator, collection_point_id: POINT_A };

describe('CreateSupplierCommand', () => {
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
  let points: { findOneRaw: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let qb: {
    where: jest.Mock; andWhere: jest.Mock; orderBy: jest.Mock; addOrderBy: jest.Mock;
    skip: jest.Mock; take: jest.Mock; getManyAndCount: jest.Mock; getOne: jest.Mock;
  };
  let command: CreateSupplierCommand;

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
    points = { findOneRaw: jest.fn().mockResolvedValue({ id: POINT_B, is_active: true }) };
    dataSource = { transaction: jest.fn().mockImplementation((cb) => cb(manager)) };
    command = new CreateSupplierCommand(repo as never, dataSource as never, audit as never, points as never);
  });

  describe('create', () => {
    const dto = { first_name: ' Іван ', last_name: ' Коваль ', phone: '067 123 45 67' };

    it('derives the point from an OPERATOR and never from the body', async () => {
      await command.create(operator, { ...dto } as never);
      expect(txRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ collection_point_id: POINT_A }),
      );
    });

    it('requires an OWNER to name the point, since an owner has none', async () => {
      await expect(command.create(owner, { ...dto } as never)).rejects.toThrow(BadRequestException);
    });

    it('lets an owner create at any point', async () => {
      await command.create(owner, { ...dto, collection_point_id: POINT_B } as never);
      expect(txRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ collection_point_id: POINT_B }),
      );
    });

    it('404s on a body point that does not exist, rather than 500ing on the FK', async () => {
      // `assertOwnsPoint` is a pure id comparison and no-ops for an owner, so
      // nothing else validates a body-supplied uuid. Without the existence
      // check this reaches `FK_suppliers_point` and the filter — which has no
      // `QueryFailedError` mapping — turns it into a bare 500.
      points.findOneRaw.mockResolvedValue(null);
      await expect(
        command.create(owner, { ...dto, collection_point_id: POINT_B } as never),
      ).rejects.toThrow(NotFoundException);
      expect(txRepo.save).not.toHaveBeenCalled();
    });

    it('does NOT re-read the point for an operator, whose point comes from the token', async () => {
      await command.create(operator, { ...dto } as never);
      expect(points.findOneRaw).not.toHaveBeenCalled();
    });

    it('refuses an operator naming someone else’s point', async () => {
      await expect(
        command.create(operator, { ...dto, collection_point_id: POINT_B } as never),
      ).rejects.toThrow(ForbiddenException);
    });

    it('canonicalizes the phone before saving', async () => {
      await command.create(operator, { ...dto } as never);
      expect(txRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ phone: '+380671234567' }),
      );
    });

    it('stores a null phone as null — правка 8’s escape hatch', async () => {
      await command.create(operator, { first_name: 'Іван', last_name: 'Коваль' } as never);
      expect(txRepo.create).toHaveBeenCalledWith(expect.objectContaining({ phone: null }));
    });

    it('trims both names', async () => {
      await command.create(operator, { ...dto } as never);
      expect(txRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ first_name: 'Іван', last_name: 'Коваль' }),
      );
    });

    it('rejects an all-whitespace last name with a 400', async () => {
      await expect(
        command.create(operator, { first_name: 'Іван', last_name: '   ' } as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('409s when the phone is already used AT THIS POINT', async () => {
      qb.getOne.mockResolvedValue(supplier({ id: 'other' }));
      await expect(command.create(operator, { ...dto } as never)).rejects.toThrow(
        ConflictException,
      );
    });

    it('does NOT run the phone pre-check when there is no phone', async () => {
      await command.create(operator, { first_name: 'Іван', last_name: 'Коваль' } as never);
      expect(qb.getOne).not.toHaveBeenCalled();
    });

    it('writes the audit entry inside the transaction', async () => {
      await command.create(operator, { ...dto } as never);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'supplier.created',
          actor_id: 'u-op',
          target_type: 'supplier',
        }),
        manager,
      );
    });
  });
});

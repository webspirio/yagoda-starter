import { UserRole } from '../../users/user-role.enum';
import { ListSuppliersQuery } from './list-suppliers.query';
import { SupplierKind } from '../supplier-kind.enum';

const POINT_A = '11111111-1111-1111-1111-111111111111';
const POINT_B = '22222222-2222-2222-2222-222222222222';

const owner = { sub: 'u-owner', username: 'owner', role: UserRole.NetworkOwner, collection_point_id: null };
const operator = { sub: 'u-op', username: 'op', role: UserRole.PointOperator, collection_point_id: POINT_A };

describe('ListSuppliersQuery', () => {
  let repo: {
    findAndCount: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let qb: {
    where: jest.Mock; andWhere: jest.Mock; orderBy: jest.Mock; addOrderBy: jest.Mock;
    skip: jest.Mock; take: jest.Mock; getManyAndCount: jest.Mock; getOne: jest.Mock;
  };
  let query: ListSuppliersQuery;

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
    query = new ListSuppliersQuery(repo as never);
  });

  describe('list', () => {
    it('pins an operator to their own point, ignoring the requested one', async () => {
      await query.list(operator, { page: 1, limit: 20, collection_point_id: POINT_B } as never);
      expect(qb.andWhere).toHaveBeenCalledWith('s.collection_point_id = :pointId', {
        pointId: POINT_A,
      });
    });

    it('lets an owner span every point when none is requested', async () => {
      await query.list(owner, { page: 1, limit: 20 } as never);
      expect(qb.andWhere).not.toHaveBeenCalledWith(
        's.collection_point_id = :pointId',
        expect.anything(),
      );
    });

    it('honours a point an OWNER requests — the reason resolvePointFilter takes two args', async () => {
      // The operator-ignores-it and owner-spans-everything branches are both
      // covered above; this is the branch the second argument exists for, and
      // it had no assertion anywhere.
      await query.list(owner, { page: 1, limit: 20, collection_point_id: POINT_B } as never);
      expect(qb.andWhere).toHaveBeenCalledWith('s.collection_point_id = :pointId', {
        pointId: POINT_B,
      });
    });

    it('breaks name ties on id so a page boundary cannot drop or repeat a row', async () => {
      await query.list(operator, { page: 1, limit: 20 } as never);
      expect(qb.addOrderBy).toHaveBeenCalledWith('s.id', 'ASC');
    });

    it('hides inactive suppliers by default', async () => {
      await query.list(operator, { page: 1, limit: 20 } as never);
      expect(qb.andWhere).toHaveBeenCalledWith('s.is_active = true');
    });


    it('applies the shared search to its builder', async () => {
      await query.list(operator, { page: 1, limit: 20, q: 'Ковал' } as never);
      expect(qb.andWhere).toHaveBeenCalledWith(
        "(s.first_name ILIKE :q ESCAPE '\\' OR s.last_name ILIKE :q ESCAPE '\\')",
        { q: '%Ковал%' },
      );
    });
  });
});

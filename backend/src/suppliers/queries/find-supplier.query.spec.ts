import { NotFoundException } from '@nestjs/common';
import { UserRole } from '../../users/user-role.enum';
import { FindSupplierQuery } from './find-supplier.query';
import { SupplierKind } from '../supplier-kind.enum';

const POINT_A = '11111111-1111-1111-1111-111111111111';
const POINT_B = '22222222-2222-2222-2222-222222222222';

const operator = { sub: 'u-op', username: 'op', role: UserRole.PointOperator, collection_point_id: POINT_A };

describe('FindSupplierQuery', () => {
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
  let query: FindSupplierQuery;

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
    query = new FindSupplierQuery(repo as never);
  });

  describe('findOne', () => {
    it('404s — not 403 — for another point’s supplier', async () => {
      // Deliberate divergence from GET /collection-points/:id, which the
      // foundation follow-ups flag as a weak existence oracle. Suppliers are
      // real people's names and phone numbers.
      repo.findOne.mockResolvedValue(supplier({ collection_point_id: POINT_B }));
      await expect(query.findOne(operator, 's-1')).rejects.toThrow(NotFoundException);
    });

    it('returns the supplier at the caller’s own point', async () => {
      repo.findOne.mockResolvedValue(supplier());
      await expect(query.findOne(operator, 's-1')).resolves.toMatchObject({ id: 's-1' });
    });
  });
});

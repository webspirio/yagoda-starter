import { ListSupplierTotalsQuery } from './list-supplier-totals.query';
import { UserRole } from '../../users/user-role.enum';
import { SupplierKind } from '../../suppliers/supplier-kind.enum';

const POINT_A = '11111111-1111-1111-1111-111111111111';
const POINT_B = '22222222-2222-2222-2222-222222222222';
const owner = { sub: 'u-owner', username: 'owner', role: UserRole.NetworkOwner, collection_point_id: null };
const operator = { sub: 'u-op', username: 'op', role: UserRole.PointOperator, collection_point_id: POINT_A };

describe('ListSupplierTotalsQuery', () => {
  const supplier = {
    id: 's-1',
    collection_point_id: POINT_A,
    first_name: 'Іван',
    last_name: 'Коваль',
    phone: null,
    note: null,
    kind: SupplierKind.Wholesale,
    is_active: true,
    created_at: new Date('2026-07-15T06:00:00.000Z'),
    updated_at: new Date('2026-07-15T06:00:00.000Z'),
  };
  let qb: Record<string, jest.Mock>;
  let query: ListSupplierTotalsQuery;

  beforeEach(() => {
    qb = {};
    for (const m of ['where', 'andWhere', 'addSelect', 'orderBy', 'addOrderBy', 'offset', 'limit']) {
      qb[m] = jest.fn().mockReturnValue(qb);
    }
    qb.getCount = jest.fn().mockResolvedValue(1);
    qb.getRawAndEntities = jest.fn().mockResolvedValue({
      entities: [supplier],
      raw: [{ kg_total: '950.00', accrued: '9650.00', main_product_name: 'Малина' }],
    });
    query = new ListSupplierTotalsQuery({ createQueryBuilder: () => qb } as never);
  });

  const list = (actor: typeof owner | typeof operator, over: Record<string, unknown> = {}) =>
    query.list(actor, { page: 1, limit: 100, sort: 'weight', ...over } as never);

  it('lists active suppliers only', async () => {
    await list(owner);
    expect(qb.where).toHaveBeenCalledWith('s.is_active = true');
  });

  it('pins an operator to their own point, ignoring the requested one', async () => {
    await list(operator, { collection_point_id: POINT_B });
    expect(qb.andWhere).toHaveBeenCalledWith('s.collection_point_id = :pointId', { pointId: POINT_A });
  });

  it('applies the shared search, and counts AFTER it so total matches the filtered list', async () => {
    await list(operator, { q: 'Ковал' });
    expect(qb.andWhere).toHaveBeenCalledWith(
      "(s.first_name ILIKE :q ESCAPE '\\' OR s.last_name ILIKE :q ESCAPE '\\')",
      { q: '%Ковал%' },
    );
    const searched = Math.max(...qb.andWhere.mock.invocationCallOrder);
    expect(qb.getCount.mock.invocationCallOrder[0]).toBeGreaterThan(searched);
    expect(qb.getCount.mock.invocationCallOrder[0]).toBeLessThan(qb.addSelect.mock.invocationCallOrder[0]);
  });

  it('defaults to heaviest first, with the name-then-id tail', async () => {
    await list(owner);
    expect(qb.orderBy).toHaveBeenCalledWith('kg_total', 'DESC');
    expect(qb.addOrderBy.mock.calls).toEqual([
      ['s.last_name', 'ASC'],
      ['s.first_name', 'ASC'],
      ['s.id', 'ASC'],
    ]);
  });

  it('sorts by accrued in the requested direction', async () => {
    await list(owner, { sort: 'amount', order: 'asc' });
    expect(qb.orderBy).toHaveBeenCalledWith('accrued', 'ASC');
  });

  it('sorts by name A→Z by default and Z→A on request, id last either way', async () => {
    await list(owner, { sort: 'name' });
    expect(qb.orderBy).toHaveBeenCalledWith('s.last_name', 'ASC');
    expect(qb.addOrderBy.mock.calls).toEqual([['s.first_name', 'ASC'], ['s.id', 'ASC']]);

    qb.orderBy.mockClear();
    qb.addOrderBy.mockClear();
    await list(owner, { sort: 'name', order: 'desc' });
    expect(qb.orderBy).toHaveBeenCalledWith('s.last_name', 'DESC');
    expect(qb.addOrderBy.mock.calls).toEqual([['s.first_name', 'DESC'], ['s.id', 'ASC']]);
  });

  it('pages with offset/limit and returns the supplier plus its three totals', async () => {
    const page = await list(owner, { page: 3, limit: 100 });
    expect(qb.offset).toHaveBeenCalledWith(200);
    expect(qb.limit).toHaveBeenCalledWith(100);
    expect(page).toEqual({
      data: [
        expect.objectContaining({
          id: 's-1',
          kind: SupplierKind.Wholesale,
          created_at: '2026-07-15T06:00:00.000Z',
          kg_total: '950.00',
          accrued: '9650.00',
          main_product_name: 'Малина',
        }),
      ],
      total: 1,
      page: 3,
      limit: 100,
    });
  });
});

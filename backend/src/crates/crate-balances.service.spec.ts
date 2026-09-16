import { ForbiddenException } from '@nestjs/common';
import { CrateBalancesService } from './crate-balances.service';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

const POINT_A = '11111111-1111-1111-1111-111111111111';
const POINT_B = '22222222-2222-2222-2222-222222222222';

const owner = {
  sub: 'u-owner',
  role: UserRole.NetworkOwner,
  collection_point_id: null,
} as unknown as AuthenticatedUser;
const operatorAtA = {
  sub: 'u-op',
  role: UserRole.PointOperator,
  collection_point_id: POINT_A,
} as unknown as AuthenticatedUser;
const scopelessOperator = {
  sub: 'u-bad',
  role: UserRole.PointOperator,
  collection_point_id: null,
} as unknown as AuthenticatedUser;

const query = (over: Record<string, unknown> = {}) =>
  ({ page: 1, limit: 20, include_zero: false, ...over }) as never;

describe('CrateBalancesService', () => {
  let ds: { query: jest.Mock };
  let service: CrateBalancesService;

  beforeEach(() => {
    ds = {
      query: jest.fn().mockResolvedValueOnce([{ count: 0 }]).mockResolvedValueOnce([]),
    };
    service = new CrateBalancesService(ds as never);
  });

  /** The whole access story: no rule of its own, just the shared filter. */
  it('pins an operator to their own point and IGNORES a requested one', async () => {
    await service.list(operatorAtA, query({ collection_point_id: POINT_B }));

    const [, params] = ds.query.mock.calls[0];
    expect(params).toContain(POINT_A);
    expect(params).not.toContain(POINT_B);
  });

  it('lets an owner ask for one point', async () => {
    await service.list(owner, query({ collection_point_id: POINT_B }));
    expect(ds.query.mock.calls[0][1]).toContain(POINT_B);
  });

  it('gives an owner every point when they ask for none', async () => {
    await service.list(owner, query());
    const [sql, params] = ds.query.mock.calls[0];
    expect(params).toHaveLength(1); // the mode literal only
    expect(sql).not.toContain('s.collection_point_id =');
  });

  /**
   * `resolvePointFilter` FAILS CLOSED for an operator with no point, because
   * `undefined` is its encoding for «every point» — falling back to it would
   * hand a scope-less operator the whole network.
   */
  it('refuses a non-owner with no point rather than widening to the network', async () => {
    await expect(service.list(scopelessOperator, query())).rejects.toThrow(ForbiddenException);
    expect(ds.query).not.toHaveBeenCalled();
  });

  it('drops suppliers holding nothing unless include_zero is asked for', async () => {
    await service.list(owner, query());
    expect(ds.query.mock.calls[0][0]).toContain('JOIN rolled');
    expect(ds.query.mock.calls[0][0]).not.toContain('LEFT JOIN rolled');

    ds.query.mockClear().mockResolvedValueOnce([{ count: 0 }]).mockResolvedValueOnce([]);
    await service.list(owner, query({ include_zero: true }));
    expect(ds.query.mock.calls[0][0]).toContain('LEFT JOIN rolled');
  });

  /**
   * Foundation §5.1 — money arithmetic belongs to Postgres here. If this sum
   * ever moves into TypeScript it becomes a second implementation of what
   * `CrateBalanceService.balanceFor` already does through `money.ts`.
   */
  it('sums the deposit in SQL, never in JavaScript', async () => {
    await service.list(owner, query());
    expect(ds.query.mock.calls[0][0]).toContain('SUM(o.deposit_per_unit * o.remaining_units)');
  });

  it('counts only OPEN tranches, releasing those a voided return consumed', async () => {
    await service.list(owner, query());
    const sql = ds.query.mock.calls[0][0];
    expect(sql).toContain('cr.voided_at IS NULL');
    expect(sql).toContain('ci.voided_at IS NULL');
    expect(sql).toContain('remaining_units > 0');
  });

  it('orders totally, so a page cannot serve one row twice', async () => {
    await service.list(owner, query());
    expect(ds.query.mock.calls[1][0]).toContain(
      'ORDER BY t.outstanding_units DESC, t.last_name, t.first_name, t.supplier_id',
    );
  });

  it('pages with the limit and offset it was given', async () => {
    await service.list(owner, query({ page: 3, limit: 25 }));
    const params = ds.query.mock.calls[1][1];
    expect(params.slice(-2)).toEqual([25, 50]);
  });
});

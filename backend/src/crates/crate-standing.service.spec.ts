import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CrateStandingService } from './crate-standing.service';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

const POINT_A = '11111111-1111-1111-1111-111111111111';
const POINT_B = '22222222-2222-2222-2222-222222222222';

const owner = { sub: 'o', role: UserRole.NetworkOwner, collection_point_id: null } as unknown as AuthenticatedUser;
const operatorAtA = { sub: 'p', role: UserRole.PointOperator, collection_point_id: POINT_A } as unknown as AuthenticatedUser;
const scopeless = { sub: 'x', role: UserRole.PointOperator, collection_point_id: null } as unknown as AuthenticatedUser;

const ROW = {
  collection_point_id: POINT_A,
  allotment: 500,
  received: 500,
  on_hand: 350,
  in_field: 50,
  deposit_units: 30,
  deposit_held: '3600.00',
  with_berry: 0,
  total: 400,
  shortfall: 100,
};

describe('CrateStandingService', () => {
  let ds: { query: jest.Mock };
  let service: CrateStandingService;

  beforeEach(() => {
    ds = { query: jest.fn().mockResolvedValue([ROW]) };
    service = new CrateStandingService(ds as never);
  });

  it('pins an operator to their own point and IGNORES a requested one', async () => {
    await service.forPoint(operatorAtA, { collection_point_id: POINT_B });
    expect(ds.query.mock.calls[0][1]).toEqual([POINT_A]);
  });

  it('serves an owner the point they ask for', async () => {
    await expect(service.forPoint(owner, { collection_point_id: POINT_A })).resolves.toEqual(ROW);
    expect(ds.query.mock.calls[0][1]).toEqual([POINT_A]);
  });

  /** A standing is ONE point's — there is no network-wide allotment. */
  it('refuses an owner who names no point', async () => {
    await expect(service.forPoint(owner, {})).rejects.toBeInstanceOf(BadRequestException);
    expect(ds.query).not.toHaveBeenCalled();
  });

  it('refuses an operator with no point assigned', async () => {
    await expect(service.forPoint(scopeless, {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(ds.query).not.toHaveBeenCalled();
  });

  it('404s an unknown point', async () => {
    ds.query.mockResolvedValue([]);
    await expect(service.forPoint(owner, { collection_point_id: POINT_B })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

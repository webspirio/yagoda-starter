import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '../../users/user-role.enum';
import { assertOwnsPoint, resolvePointFilter } from './point-scope';
import type { AuthenticatedUser } from '../jwt.strategy';

const owner: AuthenticatedUser = {
  sub: 'u-owner',
  username: 'owner',
  role: UserRole.NetworkOwner,
  collection_point_id: null,
};
const operator: AuthenticatedUser = {
  sub: 'u-op',
  username: 'oksana',
  role: UserRole.PointOperator,
  collection_point_id: 'point-a',
};

describe('assertOwnsPoint', () => {
  it('lets an operator through for their own point', () => {
    expect(() => assertOwnsPoint(operator, 'point-a')).not.toThrow();
  });

  it('refuses an operator another point', () => {
    expect(() => assertOwnsPoint(operator, 'point-b')).toThrow(ForbiddenException);
  });

  it('lets the owner through for any point', () => {
    expect(() => assertOwnsPoint(owner, 'point-a')).not.toThrow();
    expect(() => assertOwnsPoint(owner, 'point-b')).not.toThrow();
  });
});

describe('resolvePointFilter', () => {
  // The whole point of the "derive, never accept" rule: an operator's request
  // cannot widen or redirect its own scope, so a forged query parameter is not
  // an error to report — it is simply not read.
  it('pins an operator to their own point, ignoring what they asked for', () => {
    expect(resolvePointFilter(operator, 'point-b')).toBe('point-a');
    expect(resolvePointFilter(operator, undefined)).toBe('point-a');
  });

  it('honours the owner’s filter, and returns undefined when they give none', () => {
    expect(resolvePointFilter(owner, 'point-b')).toBe('point-b');
    expect(resolvePointFilter(owner, undefined)).toBeUndefined();
  });
});

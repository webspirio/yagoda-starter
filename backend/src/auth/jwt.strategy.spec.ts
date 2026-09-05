import { UnauthorizedException } from '@nestjs/common';
import { UserRole } from '../users/user-role.enum';
import { JwtStrategy } from './jwt.strategy';
import type { UsersService } from '../users/users.service';
import type { User } from '../users/user.entity';

describe('JwtStrategy.validate', () => {
  const auth = { jwtSecret: 'x'.repeat(32), jwtExpiresIn: '7d' };

  const strategyFor = (context: { user: Partial<User>; login: string } | null) => {
    const users = {
      findAuthContext: jest.fn().mockResolvedValue(context),
    } as unknown as UsersService;
    return { strategy: new JwtStrategy(auth as never, users), users };
  };

  it('returns role and point read from the database, not from the token', async () => {
    const { strategy } = strategyFor({
      user: {
        id: 'u-1',
        role: UserRole.PointOperator,
        collection_point_id: 'point-a',
        is_active: true,
      },
      login: 'oksana',
    });

    await expect(strategy.validate({ sub: 'u-1' })).resolves.toEqual({
      sub: 'u-1',
      username: 'oksana',
      role: UserRole.PointOperator,
      collection_point_id: 'point-a',
    });
  });

  // THE revocation test. Without this, deactivating someone does nothing until
  // their token expires, and no other spec would notice.
  it('rejects a token whose user has since been deactivated', async () => {
    const { strategy } = strategyFor({
      user: { id: 'u-1', role: UserRole.PointOperator, collection_point_id: 'p', is_active: false },
      login: 'oksana',
    });
    await expect(strategy.validate({ sub: 'u-1' })).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a token whose user no longer exists', async () => {
    const { strategy } = strategyFor(null);
    await expect(strategy.validate({ sub: 'gone' })).rejects.toThrow(UnauthorizedException);
  });
});

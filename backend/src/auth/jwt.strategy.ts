import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { authConfig } from '../config/auth.config';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user-role.enum';

/** Everything the token carries. Deliberately just the subject: anything else
 *  in here would be a copy of a database row that can go stale for as long as
 *  JWT_EXPIRES_IN. */
export interface JwtPayload {
  sub: string;
}

/** What every guard, controller and service sees as the caller. Assembled from
 *  the database on each request — see validate(). */
export interface AuthenticatedUser {
  sub: string;
  username: string;
  role: UserRole;
  collection_point_id: string | null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @Inject(authConfig.KEY)
    auth: ConfigType<typeof authConfig>,
    private readonly users: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: auth.jwtSecret,
      algorithms: ['HS256'],
    });
  }

  /**
   * ONE INDEXED LOOKUP PER AUTHENTICATED REQUEST, ON PURPOSE.
   *
   * The starter's version re-emitted the payload and never queried anything,
   * which is fine for a display name and unacceptable for `role`,
   * `collection_point_id` and `is_active`: a demoted operator would keep owner
   * powers for a week, a reassigned one would keep writing to their old point,
   * and a dismissed one — someone who handles cash — would keep a working
   * token until it expired. There is no revocation list in this schema, so
   * this lookup is the revocation mechanism.
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const context = await this.users.findAuthContext(payload.sub);
    if (!context || !context.user.is_active) throw new UnauthorizedException();

    return {
      sub: context.user.id,
      username: context.login,
      role: context.user.role,
      collection_point_id: context.user.collection_point_id,
    };
  }
}

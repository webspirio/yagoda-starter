import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { CredentialsService } from '../users/credentials.service';
import { AuditService } from '../audit/audit.service';
import { LOCAL_PROVIDER } from '../users/user-identity.entity';
import { User } from '../users/user.entity';
import { normalizeLogin } from '../users/normalize-login';
import { LoginDto } from './dto/login.dto';
import type { AuthenticatedUser, JwtPayload } from './jwt.strategy';

/**
 * There is no `register` here on purpose. Accounts are created by a
 * network_owner through `POST /users` (see `user-admin/`), because a
 * self-registered account would need a `role` and a `collection_point_id`
 * and there is no safe default for either: `point_operator` with no point
 * violates the users role↔point CHECK constraint, and any point assignment
 * hands a stranger that point's data.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly credentials: CredentialsService,
    private readonly audit: AuditService,
    private readonly jwt: JwtService,
  ) {}

  async login(dto: LoginDto): Promise<{ access_token: string }> {
    const username = normalizeLogin(dto.username);
    const identity = await this.users.findByIdentity(LOCAL_PROVIDER, username);

    // One failure mode, one message. Distinguishing "no such user" from "wrong
    // password" turns the login endpoint into a username oracle.
    if (!identity) throw this.deny();
    if (!(await this.credentials.verify(identity.user.id, dto.password))) throw this.deny();
    if (!identity.user.is_active) throw this.deny();

    await this.audit.record({
      action: 'user.logged-in',
      actor_id: identity.user.id,
      target_type: 'user',
      target_id: identity.user.id,
    });

    return { access_token: this.signToken(identity.user) };
  }

  /**
   * The token is stateless, so there is nothing server-side to revoke — this
   * exists for symmetry with login and so the sign-out moment shows up in the
   * audit log.
   */
  async logout(actor: AuthenticatedUser): Promise<void> {
    await this.audit.record({
      action: 'user.logged-out',
      actor_id: actor.sub,
      target_type: 'user',
      target_id: actor.sub,
    });
  }

  private deny(): UnauthorizedException {
    return new UnauthorizedException({
      message: 'Invalid username or password',
      code: 'INVALID_CREDENTIALS',
    });
  }

  /** The token carries the subject and nothing else: every other fact about
   *  the caller is read from the database on each request (JwtStrategy). */
  private signToken(user: User): string {
    const payload: JwtPayload = { sub: user.id };
    return this.jwt.sign(payload);
  }
}

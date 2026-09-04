import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { CredentialsService } from '../users/credentials.service';
import { AuditService } from '../audit/audit.service';
import { LOCAL_PROVIDER } from '../users/user-identity.entity';
import { User } from '../users/user.entity';
import { LoginDto } from './dto/login.dto';
import type { AuthenticatedUser } from './jwt.strategy';

/**
 * Usernames are compared case-insensitively and stored lowercased, so
 * `Alice` and `alice` can never be two accounts. Doing it here rather than in
 * the database keeps the existing UNIQUE (provider, provider_user_id) index
 * working for every provider without a functional index.
 */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

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
    const username = normalizeUsername(dto.username);
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

    return { access_token: this.signToken(identity.user, identity.provider_user_id) };
  }

  /**
   * The token is stateless, so there is nothing server-side to revoke — this
   * exists for symmetry with register/login and so the sign-out moment shows
   * up in the audit log.
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

  private signToken(user: User, username: string): string {
    const payload: AuthenticatedUser = {
      sub: user.id,
      username,
      display_name: user.display_name ?? null,
      avatar_url: user.avatar_url ?? null,
    };
    return this.jwt.sign(payload);
  }
}

import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { CredentialsService } from '../users/credentials.service';
import { AuditService } from '../audit/audit.service';
import { LOCAL_PROVIDER } from '../users/user-identity.entity';
import { User } from '../users/user.entity';
import { CredentialsDto } from './dto/credentials.dto';
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

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly credentials: CredentialsService,
    private readonly audit: AuditService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: CredentialsDto): Promise<{ access_token: string }> {
    const username = normalizeUsername(dto.username);

    // A pre-check for a friendly 409. The UNIQUE index is still the real
    // guarantee — two simultaneous registrations both pass this check, and the
    // loser gets a 500 rather than a silent duplicate. Acceptable for a
    // starter; a consuming project can catch 23505 here.
    if (await this.users.findByIdentity(LOCAL_PROVIDER, username)) {
      throw new ConflictException('That username is taken');
    }

    const { user } = await this.users.createWithIdentity(
      {
        provider: LOCAL_PROVIDER,
        providerUserId: username,
        display_name: dto.username.trim(),
      },
      // Credentials are written inside the user-creation transaction: a user
      // row without a credential row could never log in and could never be
      // registered again, because the username would already be taken.
      async (created, manager) => {
        await this.credentials.set(created.id, dto.password, manager);
      },
    );

    await this.audit.record({
      action: 'user.registered',
      actor_id: user.id,
      target_type: 'user',
      target_id: user.id,
    });

    return { access_token: this.signToken(user, username) };
  }

  async login(dto: CredentialsDto): Promise<{ access_token: string }> {
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

  private deny(): UnauthorizedException {
    return new UnauthorizedException('Invalid username or password');
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

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { CredentialsService } from '../users/credentials.service';
import { CollectionPointsService } from '../collection-points/collection-points.service';
import { AuditService } from '../audit/audit.service';
import { UserRole } from '../users/user-role.enum';
import { LOCAL_PROVIDER } from '../users/user-identity.entity';
import { normalizeLogin } from '../users/normalize-login';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { SetPasswordDto } from './dto/set-password.dto';
import { ListUsersQueryDto } from './dto/list-users.query';
import { UserResponse, toUserResponse } from './user.mapper';
import { Paginated } from '../common/dto/paginated';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

@Injectable()
export class UserAdminService {
  constructor(
    private readonly users: UsersService,
    private readonly credentials: CredentialsService,
    private readonly points: CollectionPointsService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthenticatedUser, query: ListUsersQueryDto): Promise<Paginated<UserResponse>> {
    const [rows, total] = await this.users.list({
      page: query.page,
      limit: query.limit,
      collection_point_id: query.collection_point_id,
      include_inactive: query.include_inactive === 'true',
    });

    // No point scoping here: every route on this controller is owner-only, and
    // the owner sees the whole network. `collection_point_id` is a plain
    // filter, not an access decision — which is why `resolvePointFilter` is
    // absent, unlike in CollectionPointsService.list.
    //
    // One extra query per row for the login, which lives on the identity
    // table. Fine at `limit ≤ 100` staff rows; if this list ever grows a
    // hotter path, the fix is a single joined query in UsersService.list, not
    // a cache here.
    const data = await Promise.all(
      rows.map(async (u) => toUserResponse(u, (await this.users.findLogin(u.id)) ?? '')),
    );
    return { data, total, page: query.page, limit: query.limit };
  }

  async create(actor: AuthenticatedUser, dto: CreateUserDto): Promise<UserResponse> {
    const login = normalizeLogin(dto.login);
    const pointId = dto.collection_point_id ?? null;

    this.assertRolePointCoherent(dto.role, pointId);
    if (pointId) await this.assertPointUsable(pointId);
    await this.assertLoginFree(login);

    const { user } = await this.users.createWithIdentity(
      {
        provider: LOCAL_PROVIDER,
        providerUserId: login,
        first_name: dto.first_name,
        last_name: dto.last_name,
        role: dto.role,
        collection_point_id: pointId,
      },
      // Credentials are written inside the creation transaction: a user row
      // with no credential row could never log in and could never be created
      // again, because the login would already be taken.
      async (created, manager) => this.credentials.set(created.id, dto.password, manager),
    );

    // The FACT of the account, never the password it was issued with.
    await this.audit.record({
      action: 'user.created',
      actor_id: actor.sub,
      target_type: 'user',
      target_id: user.id,
      after: { login, role: dto.role, collection_point_id: pointId },
    });

    return toUserResponse(user, login);
  }

  async update(
    actor: AuthenticatedUser,
    userId: string,
    dto: UpdateUserDto,
  ): Promise<UserResponse> {
    const user = await this.users.findById(userId);
    const currentLogin = (await this.users.findLogin(userId)) ?? '';

    // `??`, not `!== undefined`: an explicit null on either of these NOT NULL
    // columns is already a 400 from the DTO, and if one ever reaches here it
    // must read as "leave it alone" rather than be written.
    const nextRole = dto.role ?? user.role;
    const nextActive = dto.is_active ?? user.is_active;

    // Promotion clears the home point, demotion demands one — computed here so
    // role and point always move in a single UPDATE and CHK_users_role_point
    // is never transiently violated.
    //
    // `!== undefined` rather than `'collection_point_id' in dto`: this repo
    // targets ES2023, so `useDefineForClassFields` is on and EVERY declared
    // field exists on the instance the ValidationPipe hands us — `in` would be
    // permanently true, and a PATCH of nothing but a first name would read as
    // "clear this operator's point" and 400. `undefined` means absent, `null`
    // means clear it, and only this form tells them apart.
    const nextPoint =
      nextRole === UserRole.NetworkOwner
        ? null
        : dto.collection_point_id !== undefined
          ? (dto.collection_point_id ?? null)
          : user.collection_point_id;

    this.assertRolePointCoherent(nextRole, nextPoint);
    if (nextPoint && nextPoint !== user.collection_point_id) await this.assertPointUsable(nextPoint);

    const demoting = user.role === UserRole.NetworkOwner && nextRole !== UserRole.NetworkOwner;
    const deactivating = user.is_active && !nextActive;

    if (userId === actor.sub && (demoting || deactivating)) {
      // Refused even when another owner exists: nobody does this on purpose,
      // and the recovery cost is total.
      throw new ForbiddenException({
        message: 'You cannot demote or deactivate your own account',
        code: 'SELF_LOCKOUT',
      });
    }

    if (user.role === UserRole.NetworkOwner && (demoting || deactivating)) {
      // Registration is gone and the bootstrap migration only fires on an empty
      // users table, so zero active owners means no way back in short of
      // direct database access — and no other owner to call, since passwords
      // are owner-issued.
      //
      // The exclusion argument is what makes this correct: this user is still
      // an active owner in the database at this moment, so counting them would
      // see 1 and let the last one go.
      const remaining = await this.users.countActiveOwners(userId);
      if (remaining === 0) {
        throw new ConflictException({
          message: 'This is the last active network owner; promote someone else first',
          code: 'LAST_OWNER',
        });
      }
    }

    let nextLogin = currentLogin;
    if (dto.login != null) {
      nextLogin = normalizeLogin(dto.login);
      if (nextLogin !== currentLogin) {
        await this.assertLoginFree(nextLogin);
        await this.users.setLogin(userId, nextLogin);
      }
    }

    const updated = await this.users.update(userId, {
      // `!= null` on the two NOT NULL text columns, matching the DTO's own
      // reasoning: absent leaves them alone, and an explicit null — already a
      // 400 upstream — must never be assigned if it somehow arrives.
      ...(dto.first_name != null ? { first_name: dto.first_name } : {}),
      ...(dto.last_name != null ? { last_name: dto.last_name } : {}),
      // Role and point in ONE call, always. Splitting them into two updates
      // would leave the row violating CHK_users_role_point in between.
      role: nextRole,
      collection_point_id: nextPoint,
      is_active: nextActive,
    });

    const before = {
      login: currentLogin,
      first_name: user.first_name,
      last_name: user.last_name,
      role: user.role,
      collection_point_id: user.collection_point_id,
      is_active: user.is_active,
    };
    const after = {
      login: nextLogin,
      first_name: updated.first_name,
      last_name: updated.last_name,
      role: updated.role,
      collection_point_id: updated.collection_point_id,
      is_active: updated.is_active,
    };
    const moved = (Object.keys(before) as (keyof typeof before)[]).filter(
      (k) => before[k] !== after[k],
    );

    // A no-op PATCH must not write an entry: an audit log full of noise is one
    // nobody reads.
    if (moved.length > 0) {
      await this.audit.record({
        action: 'user.updated',
        actor_id: actor.sub,
        target_type: 'user',
        target_id: userId,
        before: Object.fromEntries(moved.map((k) => [k, before[k]])),
        after: Object.fromEntries(moved.map((k) => [k, after[k]])),
      });
    }

    return toUserResponse(updated, nextLogin);
  }

  /** Issues a password. No old password is required — the owner is not
   *  changing theirs, they are setting someone else's. */
  async setPassword(
    actor: AuthenticatedUser,
    userId: string,
    dto: SetPasswordDto,
  ): Promise<void> {
    await this.users.findById(userId);
    await this.credentials.set(userId, dto.password);

    // THE FACT, NEVER THE VALUE. No before/after: there is nothing about a
    // password that belongs in a queryable log.
    await this.audit.record({
      action: 'user.password-changed',
      actor_id: actor.sub,
      target_type: 'user',
      target_id: userId,
    });
  }

  private assertRolePointCoherent(role: UserRole, pointId: string | null): void {
    if (role === UserRole.PointOperator && !pointId) {
      throw new BadRequestException({
        message: 'A point operator must have a collection point',
        code: 'OPERATOR_NEEDS_POINT',
      });
    }
    if (role === UserRole.NetworkOwner && pointId) {
      throw new BadRequestException({
        message: 'A network owner belongs to the network, not to a collection point',
        code: 'OWNER_HAS_NO_POINT',
      });
    }
  }

  private async assertPointUsable(pointId: string): Promise<void> {
    // Read through the owning module rather than querying its table directly:
    // reads across domains are open, but they still go through the owner.
    const point = await this.points.findOneRaw(pointId);
    if (!point || !point.is_active) {
      throw new BadRequestException({
        message: 'That collection point does not exist or is deactivated',
        code: 'POINT_UNUSABLE',
      });
    }
  }

  /** A pre-check for a friendly 409. The UNIQUE index is still the real
   *  guarantee — two simultaneous writes both pass this, and the loser gets a
   *  500 rather than a silent duplicate. */
  private async assertLoginFree(login: string): Promise<void> {
    if (await this.users.findByIdentity(LOCAL_PROVIDER, login)) {
      throw new ConflictException({ message: 'That login is taken', code: 'LOGIN_TAKEN' });
    }
  }
}

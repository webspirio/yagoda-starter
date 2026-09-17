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
import { diffFields } from '../common/diff-fields';
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
      include_inactive: query.include_inactive ?? false,
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
    const firstName = this.assertNameValid(dto.first_name, 'first_name');
    const lastName = this.assertNameValid(dto.last_name, 'last_name');
    const pointId = dto.collection_point_id ?? null;

    this.assertRolePointCoherent(dto.role, pointId);
    if (pointId) await this.assertPointUsable(pointId);
    await this.assertLoginFree(login);

    const { user } = await this.users.createWithIdentity(
      {
        provider: LOCAL_PROVIDER,
        providerUserId: login,
        first_name: firstName,
        last_name: lastName,
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

    // A point on someone who is (or is becoming) an owner is REFUSED, not
    // quietly dropped. The `nextPoint` computation below hands an owner `null`
    // unconditionally, so without this line a
    // `PATCH {"collection_point_id": "<uuid>"}` on an existing owner would
    // return 200 having done nothing — and `create()` returns 400 for exactly
    // that combination, so the two endpoints would disagree about the same
    // rule. `!= null`, so an explicit `null` (clear it — already true for an
    // owner) and an absent field (promotion) both stay legal.
    if (nextRole === UserRole.NetworkOwner && dto.collection_point_id != null) {
      throw new BadRequestException({
        message: 'A network owner belongs to the network, not to a collection point',
        code: 'OWNER_HAS_NO_POINT',
      });
    }

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

    // `user.id`, NOT the `userId` route param. Both sides are then values
    // Postgres canonicalised: `uuid` comparison is case-INSENSITIVE and
    // ParseUUIDPipe accepts an uppercased uuid, so `findById(userId)` returns
    // the actor's own row while a raw `userId === actor.sub` string compare —
    // the one case-sensitive step in the whole chain — reads false. That is a
    // `PATCH /users/<OWN-UUID-UPPERCASED> {"is_active": false}` walking
    // straight past this guard.
    if (user.id === actor.sub && (demoting || deactivating)) {
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
      // WHAT THIS COVERS: one owner-removing request at a time. The exclusion
      // argument is load-bearing — this user is still an active owner in the
      // database right now, so counting them would see 1 and let the last one
      // go — and it is done in SQL (`u.id != :excludeUserId`), so an
      // uppercased uuid cannot slip past it the way it could past a string
      // compare.
      //
      // WHAT IT DOES NOT COVER: concurrency. This is a check-then-act across
      // two statements with no transaction and no row lock, so two PATCHes
      // demoting the last two owners in parallel can both read `remaining === 1`
      // and both proceed, leaving zero. Known and deferred: closing it means
      // one transaction holding `SELECT … FOR UPDATE` over the owner rows (or
      // a partial unique index asserting at least one active owner), and this
      // guard is a usability rail against the single-request mistake, not a
      // serialisability guarantee.
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
      // 400 upstream — must never be assigned if it somehow arrives. Trimmed
      // and rejected-if-empty through assertNameValid, same as create().
      ...(dto.first_name != null
        ? { first_name: this.assertNameValid(dto.first_name, 'first_name') }
        : {}),
      ...(dto.last_name != null
        ? { last_name: this.assertNameValid(dto.last_name, 'last_name') }
        : {}),
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
    const diff = diffFields(before, after, [
      'login',
      'first_name',
      'last_name',
      'role',
      'collection_point_id',
      'is_active',
    ]);

    // A no-op PATCH must not write an entry: an audit log full of noise is one
    // nobody reads.
    if (diff) {
      await this.audit.record({
        action: 'user.updated',
        actor_id: actor.sub,
        target_type: 'user',
        target_id: userId,
        before: diff.before,
        after: diff.after,
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

  /**
   * The password itself, back to the owner who administers the account — issue
   * #11: «Я також хочу бачити логін та пароль кожного користувача». This is
   * the ONLY reader of the vault, and the reason it can exist at all is that
   * this route is owner-only and audited.
   *
   * `password: null` is an ordinary answer, not an error, and the two reasons
   * for it are told apart by `vault_enabled` so the registry can say what to
   * do: no key configured (the deployment has the feature off) versus a
   * credential issued before the vault, which the owner fixes by reissuing
   * that one password.
   */
  async revealPassword(
    actor: AuthenticatedUser,
    userId: string,
  ): Promise<{ password: string | null; vault_enabled: boolean }> {
    // Before the reveal: an unknown id must 404 rather than quietly audit a
    // reading of nothing.
    await this.users.findById(userId);
    const password = await this.credentials.reveal(userId);

    // THE FACT, NEVER THE VALUE — same rule as `user.password-changed` above.
    // `revealed` distinguishes an owner who now knows the password from one
    // who was told there was nothing stored; both are worth keeping.
    await this.audit.record({
      action: 'user.password-viewed',
      actor_id: actor.sub,
      target_type: 'user',
      target_id: userId,
      after: { revealed: password !== null },
    });

    return { password, vault_enabled: this.credentials.vaultEnabled };
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

  /**
   * Trims a name and rejects an all-whitespace one with a 400 — mirroring
   * `CollectionPointsService.assertNameValid`. Without this, "   " passes
   * `@Length(1, 64)` (whitespace counts toward length), and saving it
   * untrimmed would leave `displayNameOf` rendering blanks around real
   * content; saving it trimmed WITHOUT this check would instead write an
   * empty string to a NOT NULL column that has no length floor of its own.
   * See `normalize-login.ts` for why this trims but does NOT lowercase — a
   * person's name is a display value, not an identifier.
   */
  private assertNameValid(raw: string, field: 'first_name' | 'last_name'): string {
    const name = raw.trim();
    if (!name) {
      throw new BadRequestException({
        message: `${field} cannot be empty or all whitespace`,
        code: 'USER_NAME_EMPTY',
      });
    }
    return name;
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

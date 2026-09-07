import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { User } from './user.entity';
import { UserIdentity, LOCAL_PROVIDER } from './user-identity.entity';
import { UserRole } from './user-role.enum';

export interface CreateUserInput {
  provider: string;
  /** Already normalised by the caller (lowercased for local logins). */
  providerUserId: string;
  first_name: string;
  last_name: string;
  role: UserRole;
  /** NULL for a network_owner, required for a point_operator — see
   *  CHK_users_role_point. Passing the wrong combination is a 500 from the
   *  database, so callers validate first. */
  collection_point_id?: string | null;
  language_code?: string | null;
  providerData?: Record<string, unknown> | null;
}

/**
 * `role` and `collection_point_id` are admitted TOGETHER on purpose, and must
 * MOVE together: CHK_users_role_point demands a point for a point_operator and
 * no point for a network_owner, so setting one without the other — promoting
 * someone to owner while their old point stays on the row, demoting them
 * before a point is chosen — is a CHECK violation, i.e. a 500 from the
 * database rather than a validation error. Compute both, then pass both in a
 * single call (see `UserAdminService.update`). Same warning as
 * `CreateUserInput.collection_point_id` above; this is the update half of it.
 */
export type UpdatableUserFields = Partial<
  Pick<
    User,
    | 'first_name'
    | 'last_name'
    | 'avatar_url'
    | 'language_code'
    | 'role'
    | 'collection_point_id'
    | 'is_active'
  >
>;

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserIdentity)
    private readonly identityRepo: Repository<UserIdentity>,
  ) {}

  /**
   * The single login lookup path, whatever the provider. Returns the identity
   * row with its user loaded, so the caller needs no second query.
   */
  async findByIdentity(provider: string, providerUserId: string): Promise<UserIdentity | null> {
    return this.identityRepo.findOne({
      where: { provider, provider_user_id: providerUserId },
      relations: { user: true },
    });
  }

  /**
   * Create a user and its identity in one transaction. The caller writes
   * credentials inside the same transaction by passing the manager on to
   * CredentialsService.set() — see the account-creation path in `user-admin/`.
   */
  async createWithIdentity(
    input: CreateUserInput,
    onCreated?: (user: User, manager: EntityManager) => Promise<void>,
  ): Promise<{ user: User; identity: UserIdentity }> {
    return this.userRepo.manager.transaction(async (em) => {
      const user = em.create(User, {
        first_name: input.first_name,
        last_name: input.last_name,
        role: input.role,
        collection_point_id: input.collection_point_id ?? null,
        language_code: input.language_code ?? null,
        avatar_url: null,
        is_active: true,
      });
      await em.save(user);

      const identity = em.create(UserIdentity, {
        user,
        provider: input.provider,
        provider_user_id: input.providerUserId,
        provider_data: input.providerData ?? null,
      });
      await em.save(identity);

      if (onCreated) await onCreated(user, em);

      return { user, identity };
    });
  }

  async findById(id: string): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /**
   * The ONE write seam for a user row. There is deliberately no `setActive`
   * sibling any more: it had no caller, and a public method that writes
   * `is_active` on its own is a second deactivation path with none of the
   * guards `UserAdminService.update` puts in front of this one — no
   * owner-count check, no self-lockout check. Deactivating a user goes through
   * that service.
   *
   * `is_active` is a real-time lockout wherever it is written:
   * JwtStrategy.validate() reloads this row on every authenticated request, so
   * a deactivated user is refused on their very next request with the token
   * they already hold — not when it finally expires. Login is blocked too (see
   * AuthService.login), but that is the lesser half of the effect.
   */
  async update(
    id: string,
    dto: UpdatableUserFields,
    manager?: EntityManager,
  ): Promise<User> {
    if (Object.keys(dto).length === 0) return this.findById(id);
    const repo = manager ? manager.getRepository(User) : this.userRepo;
    const result = await repo.update(id, dto);
    if (result.affected === 0) throw new NotFoundException('User not found');
    return this.findById(id);
  }

  /**
   * Everything an authenticated request needs about its caller, in one query.
   * Called on EVERY authenticated request by JwtStrategy.validate(), which is
   * what makes deactivation, demotion and point reassignment take effect
   * immediately instead of when the token expires.
   *
   * Returns null for a user with no local identity — a future OAuth-only
   * account would land here, and rejecting it is the safe default until that
   * case actually exists.
   */
  async findAuthContext(userId: string): Promise<{ user: User; login: string } | null> {
    const identity = await this.identityRepo.findOne({
      where: { provider: LOCAL_PROVIDER, user: { id: userId } },
      relations: { user: true },
    });
    if (!identity?.user) return null;
    return { user: identity.user, login: identity.provider_user_id };
  }

  /**
   * How many ACTIVE owners exist, optionally ignoring one user — the shape the
   * lockout guard needs: "if I change this person, is anyone left?". The
   * exclusion is the whole point: counting the user about to be demoted would
   * see one owner and cheerfully leave zero.
   */
  async countActiveOwners(excludeUserId?: string): Promise<number> {
    const qb = this.userRepo
      .createQueryBuilder('u')
      .where('u.role = :role', { role: UserRole.NetworkOwner })
      .andWhere('u.is_active = true');
    if (excludeUserId) qb.andWhere('u.id != :excludeUserId', { excludeUserId });
    return qb.getCount();
  }

  async list(opts: {
    page: number;
    limit: number;
    collection_point_id?: string;
    include_inactive?: boolean;
  }): Promise<[User[], number]> {
    const where: Record<string, unknown> = {};
    if (opts.collection_point_id) where.collection_point_id = opts.collection_point_id;
    if (!opts.include_inactive) where.is_active = true;

    return this.userRepo.findAndCount({
      where,
      // `id: 'ASC'` is a tiebreaker, not a third sort key anyone reads: there
      // is no uniqueness on user names either, so a paginated list of two
      // people who share one can repeat or drop a row across pages. Same
      // reasoning as `ProductGradesService.list` and `SuppliersService.list`.
      order: { last_name: 'ASC', first_name: 'ASC', id: 'ASC' },
      skip: (opts.page - 1) * opts.limit,
      take: opts.limit,
    });
  }

  /**
   * The write seam for the login itself, which lives on the identity row.
   * Callers normalise and check availability first — the UNIQUE index is the
   * real guarantee, and a race loses with a 500 rather than a duplicate.
   *
   * A query builder rather than `repo.update({ user: { id } }, …)`: TypeORM's
   * `update()` does NOT resolve a nested relation in its criteria, and would
   * silently match no rows. `findOne` does support that form — which is why
   * `findAuthContext` above can use it and this cannot.
   */
  async setLogin(userId: string, login: string, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(UserIdentity) : this.identityRepo;
    const result = await repo
      .createQueryBuilder()
      .update(UserIdentity)
      .set({ provider_user_id: login })
      .where('provider = :provider AND user_id = :userId', {
        provider: LOCAL_PROVIDER,
        userId,
      })
      .execute();
    if (result.affected === 0) throw new NotFoundException('User has no local login');
  }

  async findLogin(userId: string): Promise<string | null> {
    const context = await this.findAuthContext(userId);
    return context?.login ?? null;
  }

  /** Active users whose home point is `pointId`. Used to refuse deactivating a
   *  point out from under someone: an orphaned operator would keep a valid
   *  token whose every scoping assertion silently matches nothing. */
  async findActiveAtPoint(pointId: string): Promise<User[]> {
    return this.userRepo.find({ where: { collection_point_id: pointId, is_active: true } });
  }
}

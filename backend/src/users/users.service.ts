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
   * Idempotent, and a real-time lockout: JwtStrategy.validate() reloads this
   * row on every authenticated request, so a deactivated user is refused on
   * their very next request with the token they already hold — not when it
   * finally expires. Login is blocked too (see AuthService.login), but that
   * is now the lesser half of the effect.
   */
  async setActive(id: string, isActive: boolean): Promise<void> {
    const result = await this.userRepo.update(id, { is_active: isActive });
    if (result.affected === 0) throw new NotFoundException('User not found');
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { User } from './user.entity';
import { UserIdentity } from './user-identity.entity';

export interface CreateUserInput {
  provider: string;
  /** Already normalised by the caller (lowercased for local usernames). */
  providerUserId: string;
  display_name?: string | null;
  language_code?: string | null;
  providerData?: Record<string, unknown> | null;
}

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
   * CredentialsService.set() — see AuthService.register().
   */
  async createWithIdentity(
    input: CreateUserInput,
    onCreated?: (user: User, manager: EntityManager) => Promise<void>,
  ): Promise<{ user: User; identity: UserIdentity }> {
    return this.userRepo.manager.transaction(async (em) => {
      const user = em.create(User, {
        display_name: input.display_name ?? null,
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
    dto: Partial<Pick<User, 'display_name' | 'avatar_url' | 'language_code'>>,
    manager?: EntityManager,
  ): Promise<User> {
    if (Object.keys(dto).length === 0) return this.findById(id);
    const repo = manager ? manager.getRepository(User) : this.userRepo;
    const result = await repo.update(id, dto);
    if (result.affected === 0) throw new NotFoundException('User not found');
    return this.findById(id);
  }

  /**
   * Idempotent. Blocks new logins only (see AuthService.login) — a token
   * issued before this call remains valid until it expires, since
   * JwtStrategy never re-checks the database. Not a real-time lockout.
   */
  async setActive(id: string, isActive: boolean): Promise<void> {
    const result = await this.userRepo.update(id, { is_active: isActive });
    if (result.affected === 0) throw new NotFoundException('User not found');
  }
}

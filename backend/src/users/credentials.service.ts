import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { UserCredentials } from './user-credentials.entity';
import { hashPassword, verifyPassword } from './password-hashing';

/**
 * THE ONLY PLACE PASSWORDS ARE READ OR WRITTEN. The hashing itself lives in
 * `password-hashing.ts`; this class is the persistence seam around it.
 *
 * The owner issues and reissues every password — there is no self-service
 * change (see `user-admin/`). §17.2's reading is that a password checked at
 * the point, where the owner is not standing, is an access control rather
 * than a signature.
 */
@Injectable()
export class CredentialsService {
  constructor(
    @InjectRepository(UserCredentials)
    private readonly repo: Repository<UserCredentials>,
  ) {}

  /** Create or replace the credential for a user. Accepts a manager so account
   *  creation can enlist it in the user-creation transaction. */
  async set(userId: string, password: string, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(UserCredentials) : this.repo;
    const password_hash = await hashPassword(password);
    await repo.upsert({ user_id: userId, password_hash }, { conflictPaths: ['user_id'] });
  }

  /**
   * False for a wrong password AND for a user with no credential — callers
   * must not distinguish the two, or the endpoint leaks which usernames exist.
   *
   * No timing equalisation for the missing-credential case: `AuthService.login`
   * already returns early for an unknown username, and a user with an identity
   * but no credential cannot be created (both are written in one transaction).
   */
  async verify(userId: string, password: string): Promise<boolean> {
    const row = await this.repo.findOne({ where: { user_id: userId } });
    if (!row) return false;
    return verifyPassword(password, row.password_hash);
  }
}

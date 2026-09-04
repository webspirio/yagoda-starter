import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { UserCredentials } from './user-credentials.entity';

/**
 * ⚠️ THE ONLY PLACE PASSWORDS ARE READ OR WRITTEN.
 *
 * Passwords are stored in PLAIN TEXT — a deliberate placeholder for this
 * starter (see UserCredentials for the full rationale). Swapping in a real KDF
 * means changing `set` and `verify` below and nothing else in the codebase:
 *
 *   import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
 *   import { promisify } from 'node:util';
 *   const scrypt = promisify(scryptCb);
 *   // set:    const salt = randomBytes(16).toString('hex');
 *   //         const key = (await scrypt(password, salt, 64)) as Buffer;
 *   //         store `${salt}:${key.toString('hex')}`
 *   // verify: split on ':', re-derive, compare with timingSafeEqual
 *
 * No new dependency is required — `scrypt` ships with Node.
 */
@Injectable()
export class CredentialsService {
  constructor(
    @InjectRepository(UserCredentials)
    private readonly repo: Repository<UserCredentials>,
  ) {}

  /** Create or replace the credential for a user. Accepts a manager so
   *  registration can enlist it in the user-creation transaction. */
  async set(userId: string, password: string, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(UserCredentials) : this.repo;
    await repo.upsert({ user_id: userId, password }, { conflictPaths: ['user_id'] });
  }

  /** False for both a wrong password and a user with no credential — callers
   *  must not distinguish the two, or the endpoint leaks which usernames exist. */
  async verify(userId: string, password: string): Promise<boolean> {
    const row = await this.repo.findOne({ where: { user_id: userId } });
    if (!row) return false;
    return row.password === password;
  }
}

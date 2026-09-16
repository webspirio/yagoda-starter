import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { UserCredentials } from './user-credentials.entity';
import { hashPassword, verifyPassword } from './password-hashing';
import { decryptSecret, encryptSecret, readVaultKey } from './secret-box';
import { authConfig } from '../config/auth.config';

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
  /**
   * Read once at construction, not per call: the key never changes within a
   * process, and `readVaultKey` returning null here is the single switch that
   * turns the readable copy off everywhere below.
   */
  private readonly vaultKey: Buffer | null;

  constructor(
    @InjectRepository(UserCredentials)
    private readonly repo: Repository<UserCredentials>,
    @Inject(authConfig.KEY)
    auth: ConfigType<typeof authConfig>,
  ) {
    this.vaultKey = readVaultKey(auth.passwordVaultKey);
  }

  /** Create or replace the credential for a user. Accepts a manager so account
   *  creation can enlist it in the user-creation transaction. */
  async set(userId: string, password: string, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(UserCredentials) : this.repo;
    const password_hash = await hashPassword(password);
    // WRITTEN ON EVERY SET, INCLUDING AS NULL. Leaving the column out of the
    // upsert when the vault is off would keep whatever a previous run wrote
    // with a key that may since have been rotated or removed — a reissued
    // password with yesterday's readable copy still beside it. Null here is an
    // erasure, and it is the reason this is one statement rather than two.
    const password_enc = this.vaultKey ? encryptSecret(password, this.vaultKey) : null;
    await repo.upsert(
      { user_id: userId, password_hash, password_enc },
      { conflictPaths: ['user_id'] },
    );
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

  /**
   * The password itself, for the one caller allowed to ask: the network owner
   * reading an operator's credentials back (issue #11, `GET
   * /users/:id/password`). NOT part of the login path — `verify()` above never
   * touches this, and everything here can fail without locking anyone out.
   *
   * Null covers four different situations ON PURPOSE, because the owner's
   * answer is the same in all of them — reissue the password: no vault key
   * configured, no credential row, a credential issued before the vault
   * existed, or a copy this key can no longer open.
   */
  async reveal(userId: string): Promise<string | null> {
    if (!this.vaultKey) return null;
    const row = await this.repo.findOne({ where: { user_id: userId } });
    if (!row?.password_enc) return null;
    return decryptSecret(row.password_enc, this.vaultKey);
  }

  /** Whether a readable copy can exist at all — i.e. whether a key is set. */
  get vaultEnabled(): boolean {
    return this.vaultKey !== null;
  }
}

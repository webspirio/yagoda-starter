import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { Exclude } from 'class-transformer';
import { User } from './user.entity';

/**
 * The stored password verifier. `password_hash`, not `password`: the name is
 * the one place the schema states that a hash — never a password — is what
 * lives here.
 *
 * The value is produced and checked ONLY by `password-hashing.ts`, through
 * `CredentialsService.set()` / `.verify()`. Its format is self-describing
 * (`scrypt$N$r$p$salt$hash`), so raising the cost parameters later needs no
 * migration and locks nobody out.
 *
 * The column lives in its own table rather than on `users` so that no query
 * which reads a user can accidentally serialize the secret.
 */
@Entity('user_credentials')
export class UserCredentials {
  @PrimaryColumn({ type: 'uuid' })
  user_id: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Exclude()
  @Column({ type: 'varchar' })
  password_hash: string;

  /**
   * The SAME password, encrypted rather than hashed, so the network owner can
   * read it back (issue #11). Null whenever `PASSWORD_VAULT_KEY` is unset, and
   * for every credential issued before the vault existed — null means "nothing
   * to show, reissue the password", never "no password".
   *
   * Nothing on the login path reads this column: `verify()` checks
   * `password_hash` and would keep working if every value here were deleted.
   * `secret-box.ts` holds the format and the reasoning.
   */
  @Exclude()
  @Column({ type: 'varchar', nullable: true })
  password_enc: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}

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

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}

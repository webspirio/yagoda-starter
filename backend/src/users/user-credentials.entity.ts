import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { Exclude } from 'class-transformer';
import { User } from './user.entity';

/**
 * ⚠️ PLACEHOLDER — PASSWORDS ARE STORED IN PLAIN TEXT.
 *
 * This is a deliberate, recorded decision for this starter's first consumer
 * project, not an oversight (see the design spec, §"Authentication"). It MUST
 * be replaced with a real key-derivation function before any deployment that
 * holds a password a human might reuse elsewhere.
 *
 * Replacing it touches exactly two functions — CredentialsService.set() and
 * .verify() — plus one migration renaming the column. Node ships `scrypt` in
 * `node:crypto`, so the replacement needs no new dependency.
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

  /** ⚠️ Plain text. See the class comment above. */
  @Exclude()
  @Column({ type: 'varchar' })
  password: string;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}

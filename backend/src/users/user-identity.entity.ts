import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
  Index,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { User } from './user.entity';

/**
 * The provider this starter ships. Adding OAuth means writing a different
 * value here — no schema change, because (provider, provider_user_id) is
 * already the unique login key.
 */
export const LOCAL_PROVIDER = 'local';

@Entity('user_identities')
@Unique(['provider', 'provider_user_id'])
// UsersService.findAuthContext filters on (provider, user_id) on EVERY
// authenticated request (JwtStrategy.validate()) — declared here so a future
// `migration:generate` sees the index the hand-written migration
// (IndexUserIdentityUser) already created and never proposes dropping it.
@Index('IDX_user_identities_user', ['user'])
export class UserIdentity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Explicit @JoinColumn: without it TypeORM's naming strategy derives
  // `"userId"`, a quoted camelCase column in an otherwise snake_case schema —
  // a trap for anyone later writing raw SQL or a migration by hand.
  @ManyToOne(() => User, (user) => user.identities, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** e.g. 'local'. A future OAuth provider writes 'google', 'github', … */
  @Column()
  provider: string;

  /** For 'local', the lowercased username. For OAuth, the provider's user id. */
  @Column()
  provider_user_id: string;

  // Provider profile JSON — internal only. @Exclude() strips it at the
  // response-serialization boundary (global ClassSerializerInterceptor in
  // main.ts); mark any sensitive entity field the same way instead of
  // hand-filtering in controllers.
  @Exclude()
  @Column({ type: 'jsonb', nullable: true })
  provider_data: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}

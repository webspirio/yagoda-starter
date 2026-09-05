import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserIdentity } from './user-identity.entity';
import { UserRole } from './user-role.enum';
import { CollectionPoint } from '../collection-points/collection-point.entity';

/**
 * There is no `display_name` column, on purpose: keeping one alongside
 * `first_name`/`last_name` would be two copies of one fact. It is DERIVED in
 * the response mappers, so `GET /me` and the frontend's `Me` type keep working.
 *
 * `login` and `password_hash` are not here either — they live on
 * `user_identities.provider_user_id` (the single login lookup path) and
 * `user_credentials.password_hash` (isolated so no query that reads a user can
 * serialize the secret). `28-db-schema.dbml` draws all three on one table; that
 * is a layout convention, and the decomposition is unchanged in meaning.
 *
 * `is_active` is NOT in the DBML's `users`, and is kept deliberately: every
 * other people-shaped table there has one, the `suppliers` Note says
 * "видалення немає, тільки is_active", and JwtStrategy.validate() now depends
 * on it for real token revocation.
 *
 * `avatar_url` and `language_code` are likewise not in the DBML. They duplicate
 * nothing and the media/i18n plumbing already uses them.
 */
@Entity('users')
@Check(
  'CHK_users_role_point',
  `("role" = 'point_operator' AND "collection_point_id" IS NOT NULL)
    OR ("role" = 'network_owner' AND "collection_point_id" IS NULL)`,
)
@Index('IDX_users_collection_point', ['collection_point_id'])
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  first_name: string;

  @Column({ type: 'varchar' })
  last_name: string;

  @Column({ type: 'varchar', nullable: true })
  avatar_url: string | null;

  @Column({ type: 'varchar', nullable: true })
  language_code: string | null;

  @Column({ type: 'enum', enum: UserRole, enumName: 'user_role' })
  role: UserRole;

  /**
   * NULL for a network_owner, NOT NULL for a point_operator — enforced by
   * CHK_users_role_point above, not by convention. An operator without a point
   * would make every scoping assertion downstream scope to nothing, silently.
   */
  @Column({ type: 'uuid', nullable: true })
  collection_point_id: string | null;

  // The relation exists so TypeORM knows about the foreign key. Without it a
  // future `migration:generate` would propose DROPping a constraint the
  // hand-written migration created.
  //
  // `foreignKeyConstraintName` is what actually makes that true, and is not
  // decoration: RdbmsSchemaBuilder matches foreign keys by NAME, so without it
  // TypeORM compares the database's `FK_users_collection_point` against a
  // naming-strategy-computed `FK_<sha1>`, never matches, and proposes a
  // drop-and-recreate — the same failure the four CHK/UQ names above prevent.
  @ManyToOne(() => CollectionPoint, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({
    name: 'collection_point_id',
    foreignKeyConstraintName: 'FK_users_collection_point',
  })
  collection_point: CollectionPoint | null;

  /**
   * Checked on the login path AND on every authenticated request:
   * JwtStrategy.validate() reloads this row, so deactivating a user takes
   * effect immediately rather than when their token expires.
   */
  @Column({ type: 'bool', nullable: false, default: true })
  is_active: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @OneToMany(() => UserIdentity, (identity) => identity.user)
  identities: UserIdentity[];
}

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { UserIdentity } from './user-identity.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', nullable: true })
  display_name: string | null;

  @Column({ type: 'varchar', nullable: true })
  avatar_url: string | null;

  @Column({ type: 'varchar', nullable: true })
  language_code: string | null;

  /**
   * Checked only on the login path (AuthService.login). Register sets this
   * true; flipping it false blocks NEW logins only — it does nothing to a
   * token already issued. JwtStrategy.validate() never queries the database,
   * so an existing token keeps authenticating until it expires (up to
   * JWT_EXPIRES_IN). There is no token revocation in this starter; adding
   * one means checking the user in JwtStrategy.validate() at the cost of a
   * database query on every authenticated request.
   */
  @Column({ type: 'bool', nullable: false, default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @OneToMany(() => UserIdentity, (identity) => identity.user)
  identities: UserIdentity[];
}

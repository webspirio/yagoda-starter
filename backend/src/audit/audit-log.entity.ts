import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../users/user.entity';

/**
 * Audited actions. A TS string union stored as varchar — adding an action must
 * never require a DB migration. These five are the starter's own; a consuming
 * project extends the union with its domain actions.
 */
export const AUDIT_ACTIONS = [
  // Historical: no writer since public registration was removed. Kept in the
  // union so rows written before that still type-check when read back.
  'user.registered',
  'user.logged-in',
  'user.logged-out',
  'user.updated',
  'user.avatar-changed',
  'user.created',
  'user.password-changed',
  'point.created',
  'point.updated',
  'point.target-changed',
  'product.created',
  'product.updated',
  'product-grade.created',
  'product-grade.updated',
  'tare-type.created',
  'tare-type.updated',
  'supplier.created',
  'supplier.updated',
  'shift.opened',
  'shift.closed',
  'shift.reopened',
  'intake.created',
  'intake.voided',
  'payout.created',
  'payout.voided',
  'payout.return-settled',
  'transfer.created',
  'transfer.accepted',
  'transfer.disputed',
  'transfer.resolved',
  'transfer.voided',
  'cash-count.recorded',
  'shift.explained',
  'crate-issuance.created',
  'crate-issuance.voided',
  'crate-return.created',
  'crate-return.voided',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * One immutable entry in the audit timeline. APPEND-ONLY BY CONVENTION — there
 * is no update or delete API for this table, ever.
 *
 * `actor_id` → users RESTRICT: an audited actor can never be hard-deleted.
 *
 * `target_type` + `target_id` are polymorphic and carry NO foreign key, which
 * is exactly what lets one log serve every table in a consuming project:
 * `('user', <uuid>)`, `('invoice', <uuid>)`, and so on. The price is that a
 * `target_id` can outlive the row it names, so `before`/`after` must carry
 * enough context to stay readable after the target is gone.
 */
@Entity('audit_log')
@Index('IDX_audit_log_target_at', ['target_type', 'target_id', 'at'])
@Index('IDX_audit_log_actor_at', ['actor_id', 'at'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  action: AuditAction;

  @Column({ type: 'uuid' })
  actor_id: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'actor_id' })
  actor: User;

  /** What kind of row `target_id` names, e.g. 'user'. Null for entries with no target. */
  @Column({ type: 'varchar', nullable: true })
  target_type: string | null;

  @Column({ type: 'uuid', nullable: true })
  target_id: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  at: Date;

  // Before/after snapshots of the changed fields; null for actions with
  // nothing to diff.
  @Column({ type: 'jsonb', nullable: true })
  before: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  after: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;
}

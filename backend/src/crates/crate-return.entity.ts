import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Shift } from '../shifts/shift.entity';
import { Supplier } from '../suppliers/supplier.entity';
import { User } from '../users/user.entity';

/**
 * Crates coming back. `deposit_refund` is the SUM OF ITS ALLOCATION ROWS and is
 * stored because it is the document's frozen total (§2.7) — the rows are the
 * derivation, this is the figure the operator handed over.
 *
 * NO `code`. A return has no paper twin: the log of §6.4 is a log of розписки,
 * and nothing in the rules or tickets numbers a return.
 *
 * VOIDING A RETURN RESTORES TRANCHE CAPACITY, because `remaining` is derived
 * through `voided_at IS NULL` on this row. No allocation is deleted — the
 * evidence survives (§9.3).
 */
@Entity('crate_returns')
@Check('CHK_crate_returns_units', `"units" > 0`)
@Check('CHK_crate_returns_deposit_refund', `"deposit_refund" >= 0`)
@Check(
  'CHK_crate_returns_void_trio',
  `num_nulls("voided_at", "voided_by_user_id", "void_reason") IN (0, 3)`,
)
@Index('IDX_crate_returns_supplier_created', ['supplier_id', 'created_at'])
export class CrateReturn {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  shift_id: string;

  @ManyToOne(() => Shift, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'shift_id' })
  shift?: Shift;

  @Column({ type: 'uuid' })
  supplier_id: string;

  @ManyToOne(() => Supplier, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'supplier_id' })
  supplier?: Supplier;

  /** A return written BY the receipt in the same «Прийняти» (spec §8.3).
   *  NULL for a standalone «Прийняти ящики». Partial UNIQUE at the DB —
   *  one receipt writes at most one return. */
  @Column({ type: 'uuid', nullable: true })
  intake_id: string | null;

  @Column({ type: 'int' })
  units: number;

  /** `numeric` — a STRING. Zero when every consumed tranche was receipt-mode. */
  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  deposit_refund: string;

  @Column({ type: 'uuid' })
  accepted_by_user_id: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'accepted_by_user_id' })
  accepted_by?: User;

  @Column({ type: 'timestamptz', nullable: true })
  voided_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  voided_by_user_id: string | null;

  @Column({ type: 'text', nullable: true })
  void_reason: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}

import { Check, Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Payout } from '../payouts/payout.entity';
import { Intake } from '../intakes/intake.entity';
import { IntakeTopUp } from '../intake-top-ups/intake-top-up.entity';

/**
 * «Payout P paid `amount` of this receipt or top-up» — a frozen fact (spec 2026-09-26).
 * Written only by `AllocationsService`; only `voided_at` ever changes.
 */
@Entity('payout_allocations')
@Check('CHK_payout_allocations_one_target', `num_nonnulls("intake_id", "intake_top_up_id") = 1`)
@Check('CHK_payout_allocations_amount', `"amount" > 0`)
export class PayoutAllocation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  payout_id: string;

  @ManyToOne(() => Payout, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'payout_id' })
  payout?: Payout;

  @Column({ type: 'uuid', nullable: true })
  intake_id: string | null;

  @ManyToOne(() => Intake, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'intake_id' })
  intake?: Intake;

  @Column({ type: 'uuid', nullable: true })
  intake_top_up_id: string | null;

  @ManyToOne(() => IntakeTopUp, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'intake_top_up_id' })
  intake_top_up?: IntakeTopUp;

  /** `numeric` — a STRING, never a number (foundation §5.1). */
  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  voided_at: Date | null;
}

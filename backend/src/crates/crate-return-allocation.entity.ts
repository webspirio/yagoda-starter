import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { CrateIssuance } from './crate-issuance.entity';
import { CrateReturn } from './crate-return.entity';

/**
 * One line of a return: «these N crates came off THAT issuance».
 *
 * §6.5 — the oldest issuance is consumed first and `per_unit` is copied FROM
 * THAT ISSUANCE, not from the catalogue. The operator «нічого не питає і не
 * обирає».
 *
 * §6.6 AS AMENDED (spec §4.1): the queue is single and spans both modes, but
 * money still cannot mix — a receipt tranche has `deposit_per_unit = 0` by
 * CHECK, so a row consuming one carries `per_unit = 0` and `amount = 0`
 * without a single branch on mode.
 *
 * A COMPOSITION CHILD of its return: `ON DELETE CASCADE`, no routes of its own.
 * The issuance side is `RESTRICT` — an issuance must never vanish from under
 * rows that point at it.
 */
@Entity('crate_return_allocations')
@Check('CHK_crate_return_allocations_units', `"units" > 0`)
@Check('CHK_crate_return_allocations_per_unit', `"per_unit" >= 0`)
@Check('CHK_crate_return_allocations_amount', `"amount" >= 0`)
@Index('IDX_crate_return_allocations_issuance', ['issuance_id'])
export class CrateReturnAllocation {
  @PrimaryColumn({ type: 'uuid' })
  return_id: string;

  @ManyToOne(() => CrateReturn, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'return_id' })
  return?: CrateReturn;

  @PrimaryColumn({ type: 'uuid' })
  issuance_id: string;

  @ManyToOne(() => CrateIssuance, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'issuance_id' })
  issuance?: CrateIssuance;

  @Column({ type: 'int' })
  units: number;

  /** Copied from the issuance — see this class's header. */
  @Column({ type: 'numeric', precision: 12, scale: 2 })
  per_unit: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount: string;
}

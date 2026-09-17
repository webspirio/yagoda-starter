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
import { User } from '../users/user.entity';

/**
 * §8.3 «Витрати дня» — a free-text line the owner records against a point's
 * working day: «касир 1 000,00 / вантажник 1 300,00 / водій 500,00 / пальне
 * 1 000,00».
 *
 * THE ONE MUTABLE DOCUMENT IN THIS SCHEMA (see the migration's doc comment for
 * why). `DayExpensesService` therefore has `update`/`remove`, not `void` — the
 * only module in this codebase where that is correct rather than a mistake.
 *
 * `shift_id`, NOT `collection_point_id` + `business_date` — same reason
 * `intakes`/`payouts`/`reweighs` have neither: the shift is how every document
 * in this schema learns its point and its date.
 *
 * `label` is FREE TEXT, on purpose (§8.3 — «закритого списку статей немає»).
 */
@Entity('day_expenses')
@Check('CHK_day_expenses_amount', `"amount" > 0`)
@Check('CHK_day_expenses_label', `btrim("label") <> ''`)
@Index('IDX_day_expenses_shift', ['shift_id'])
export class DayExpense {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  shift_id: string;

  @ManyToOne(() => Shift, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'shift_id' })
  shift?: Shift;

  @Column({ type: 'varchar' })
  label: string;

  /** `numeric` — a STRING, never a number. */
  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount: string;

  @Column({ type: 'uuid' })
  created_by_user_id: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by_user_id' })
  created_by?: User;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}

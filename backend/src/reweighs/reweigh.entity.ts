import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Shift } from '../shifts/shift.entity';
import { ReweighItem } from './reweigh-item.entity';

/**
 * The day at the base. ONE ROW PER SHIFT, and no columns of its own.
 *
 * It is not an omission — see the migration's header. The header exists so that
 * lines accumulate under one parent across however many trips the berries came
 * on («не має значення, скільки разів ягоду привозили; важливо лише, яку зміну
 * ми зважуємо»), and so that §8.5's strategy ③ has somewhere to put
 * `expense_allocation` and `allocation_product_id` when it lands.
 *
 * THERE IS NO `collection_point_id` AND NO `business_date`, for the same reason
 * `intakes` has neither: both come from `shift_id`. §8.1 — «документ належить
 * ДНЮ ЯГОДИ, а не дню заїзду машини»: a batch from 4 August weighed on the
 * morning of the 5th is still the 4th's, and the FK is what says so.
 *
 * NOT VOIDABLE. Voiding is per line (§8.7). A header whose every line is voided
 * is a day with no net weight, which §8.6 already names: the cell is empty,
 * «Це не нуль».
 */
@Entity('reweighs')
@Unique('UQ_reweighs_shift', ['shift_id'])
export class Reweigh {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  shift_id: string;

  @ManyToOne(() => Shift, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'shift_id' })
  shift?: Shift;

  @OneToMany(() => ReweighItem, (item) => item.reweigh, { eager: false })
  items?: ReweighItem[];

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}

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
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { ProductGrade } from '../products/product-grade.entity';
import { User } from '../users/user.entity';
import { Reweigh } from './reweigh.entity';
import { ReweighItemTareType } from './reweigh-item-tare-type.entity';

/**
 * ONE WEIGHING ON THE SCALE — §8.1's `701,50 − 18,00 − 138,00 = 545,50`.
 *
 * THE DOCUMENT IS THIS ROW, not its header. It carries the author, the void
 * trio and its own timestamps, because §8.7 voids a «партія» and because a line
 * is written days after the header it hangs from.
 *
 * IMMUTABLE. There is no `PATCH` and no update path in the service. With no
 * posting moment (spec §3.3) this row's `created_at` is the only freeze point
 * §8 has; if it were editable, yesterday's собівартість could be rewritten with
 * no journal trace, which is precisely what the `void_*` convention exists to
 * prevent. A correction is a void plus a new line (§9.3).
 *
 * NO `price` AND NO `amount`, deliberately (spec §3.6). Недостача is valued from
 * the INTAKE side at the weighted average actually accrued, because it is not
 * new money — it is the slice of already-accrued money with no berries behind
 * it. A price column here would be a second, different answer to a question
 * that already has one.
 *
 * `tare_weight_kg` IS A SNAPSHOT (§2.5, §2.7). `tare_types.weight_kg` is
 * editable by the owner; without the snapshot, changing «Чешка» from 1,20 to
 * 1,25 would silently rewrite last week's net weight and the недостача with it.
 *
 * SEVERAL LINES MAY NAME THE SAME GRADE — there is no unique index on
 * `(reweigh_id, product_grade_id)`, because several pallets of one berry across
 * several deliveries is the normal case. `item_order` is APPEND-ONLY: a voided
 * line keeps its number and the next line takes the next.
 */
@Entity('reweigh_items')
@Unique('UQ_reweigh_items_order', ['reweigh_id', 'item_order'])
@Check('CHK_reweigh_items_gross_kg', `"gross_kg" > 0`)
@Check('CHK_reweigh_items_pallet_kg', `"pallet_kg" >= 0`)
@Check('CHK_reweigh_items_tare_weight_kg', `"tare_weight_kg" >= 0`)
@Check('CHK_reweigh_items_net_kg', `"net_kg" > 0`)
@Check('CHK_reweigh_items_order', `"item_order" > 0`)
@Check(
  'CHK_reweigh_items_void_trio',
  `num_nulls("voided_at", "voided_by_user_id", "void_reason") IN (0, 3)`,
)
@Index('IDX_reweigh_items_reweigh', ['reweigh_id'])
@Index('IDX_reweigh_items_grade', ['product_grade_id'])
export class ReweighItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  reweigh_id: string;

  @ManyToOne(() => Reweigh, (r) => r.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reweigh_id' })
  reweigh?: Reweigh;

  /** Append-only within the header. Voided lines keep their number. */
  @Column({ type: 'int' })
  item_order: number;

  @Column({ type: 'uuid' })
  product_grade_id: string;

  @ManyToOne(() => ProductGrade, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_grade_id' })
  product_grade?: ProductGrade;

  /** Every weight below is `numeric` — a STRING, never a number. */
  @Column({ type: 'numeric', precision: 10, scale: 2 })
  gross_kg: string;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 0 })
  pallet_kg: string;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  tare_weight_kg: string;

  /** §8.1 — `(gross − pallet) − tare`, PALLET FIRST, same order as §2.4. Never
   *  entered by a human. */
  @Column({ type: 'numeric', precision: 10, scale: 2 })
  net_kg: string;

  @Column({ type: 'uuid' })
  weighed_by_user_id: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'weighed_by_user_id' })
  weighed_by?: User;

  @Column({ type: 'timestamptz', nullable: true })
  voided_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  voided_by_user_id: string | null;

  /** MANDATORY when voided — §8.7's button is inactive until it is typed. */
  @Column({ type: 'text', nullable: true })
  void_reason: string | null;

  @OneToMany(() => ReweighItemTareType, (t) => t.item, { cascade: ['insert'], eager: false })
  tare?: ReweighItemTareType[];

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}

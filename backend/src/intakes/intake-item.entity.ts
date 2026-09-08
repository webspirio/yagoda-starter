import {
  Check,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { ProductGrade } from '../products/product-grade.entity';
import { Intake } from './intake.entity';
import { IntakeItemTareType } from './intake-item-tare-type.entity';

/**
 * One line of a receipt. A COMPOSITION CHILD — `ON DELETE CASCADE`, no routes of
 * its own, frozen with its parent.
 *
 * NO `created_at` AND NO `updated_at`, matching the DBML. These rows have no
 * independent lifecycle: they are written once with the document and never
 * touched again (§2.7).
 *
 * NO EQUALITY CHECK ON `amount`. Foundation §5.4 refuses it outright: stored
 * money is rounded to two decimals, so `amount = net × (price + bonus)` as a
 * constraint rejects legitimate rows, and loosening it to a tolerance would be
 * the «допустима розбіжність» the schema will not have.
 *
 * `bonus` HAS NO NON-NEGATIVE CHECK, deliberately. §2.8 — «від'ємний bonus це
 * м'ята чи цвіла ягода». Adding one makes docking for spoiled fruit impossible,
 * and `intakes-payouts-schema.db-spec.ts` asserts the absence.
 *
 * `price` is a SNAPSHOT of the grade price current at the moment of intake
 * (§2.8), and `tare_weight_kg` a snapshot of the tare catalogue (§2.5, §2.7):
 * the owner may edit `tare_types.weight_kg` tomorrow and this document must not
 * move — «квитанція від 04.08 лишається такою назавжди».
 */
@Entity('intake_items')
@Unique('UQ_intake_items_order', ['intake_id', 'item_order'])
@Check('CHK_intake_items_gross_kg', `"gross_kg" > 0`)
@Check('CHK_intake_items_pallet_kg', `"pallet_kg" >= 0`)
@Check('CHK_intake_items_tare_weight_kg', `"tare_weight_kg" >= 0`)
@Check('CHK_intake_items_net_kg', `"net_kg" > 0`)
@Check('CHK_intake_items_price', `"price" >= 0`)
@Check('CHK_intake_items_amount', `"amount" >= 0`)
@Check('CHK_intake_items_order', `"item_order" > 0`)
export class IntakeItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  intake_id: string;

  @ManyToOne(() => Intake, (intake) => intake.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'intake_id' })
  intake?: Intake;

  /** 1-based position on the paper. Unique within the document. */
  @Column({ type: 'int' })
  item_order: number;

  @Column({ type: 'uuid' })
  product_grade_id: string;

  @ManyToOne(() => ProductGrade, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_grade_id' })
  product_grade?: ProductGrade;

  /** Every weight and price below is `numeric` — a STRING, never a number. */
  @Column({ type: 'numeric', precision: 10, scale: 2 })
  gross_kg: string;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 0 })
  pallet_kg: string;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  tare_weight_kg: string;

  /** §2.4 — `(gross − pallet) − tare`, PALLET FIRST. Never entered by a human:
   *  «людина це поле не вводить і не редагує ніколи». */
  @Column({ type: 'numeric', precision: 10, scale: 2 })
  net_kg: string;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  price: string;

  /** MAY BE NEGATIVE — see this class's header. */
  @Column({ type: 'numeric', precision: 10, scale: 2, default: 0 })
  bonus: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount: string;

  @OneToMany(() => IntakeItemTareType, (tare) => tare.item, { cascade: ['insert'], eager: false })
  tare?: IntakeItemTareType[];
}

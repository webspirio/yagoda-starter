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
import { Shift } from '../shifts/shift.entity';
import { Supplier } from '../suppliers/supplier.entity';
import { User } from '../users/user.entity';
import { IntakeItem } from './intake-item.entity';

/**
 * One visit, one document. §2.3 — «один візит із кількома сортами це ОДИН
 * документ із кількома рядками», and `amount` is «те саме число, що надруковане
 * на папері».
 *
 * THERE IS NO `collection_point_id` AND NO `business_date` HERE, and their
 * absence is the design rather than an omission: both come from `shift_id`
 * (§2.3 — «точка й бізнес-дата беруться зі зміни»), and duplicating them would
 * be «два примірники одного факту», which the schema's header forbids. THE
 * PRACTICAL CONSEQUENCE, and the thing that will trip up every later query over
 * this table: SCOPING AN OPERATOR TO THEIR POINT IS A JOIN, not a WHERE on a
 * column that exists here.
 *
 * `amount` NEVER CHANGES AFTER INSERT. §2.7 — «після проведення не міняється
 * НІКОЛИ». There is no `PATCH` route and no update path in the service; a
 * correction is a void plus a new document (§9.3, «Часткового сторно немає»).
 *
 * `received_by_user_id` is WHO PUNCHED IT, not who opened the shift. §10.6:
 * Оксана leaves her account at 14:00 and Марія enters hers at 14:01, and «підпис
 * під документом належить тому, хто натиснув». It is also what §9.4's void rule
 * keys on — «чужа квитанція → приймальник НІКОЛИ, навіть на своїй точці і в ту
 * саму зміну».
 *
 * VOIDING AN INTAKE IS THE ONLY WAY A SUPPLIER'S DEBT GOES NEGATIVE, and that
 * is allowed: «сторно КВИТАНЦІЇ ЄДИНИЙ шлях у мінус, і воно ДОЗВОЛЕНЕ, з
 * попередженням». There is no floor check anywhere, and adding one would
 * contradict the schema outright — «інваріанта борг >= 0 в цій схемі теж
 * немає».
 */
@Entity('intakes')
@Unique('UQ_intakes_code', ['code'])
@Check(
  'CHK_intakes_void_trio',
  `num_nulls("voided_at", "voided_by_user_id", "void_reason") IN (0, 3)`,
)
@Check('CHK_intakes_amount', `"amount" >= 0`)
@Index('IDX_intakes_supplier_created', ['supplier_id', 'created_at'])
@Index('IDX_intakes_shift', ['shift_id'])
export class Intake {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Composed server-side as `{POINT}-IN-{YYYYMMDD}-{typed}` — see
   *  `common/document-code.ts`. The raw typed part is not stored separately. */
  @Column({ type: 'varchar' })
  code: string;

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

  /** `numeric` — a STRING, never a number (foundation §5.1). Σ of the ROUNDED
   *  line amounts, which is what the paper shows. */
  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount: string;

  @Column({ type: 'uuid' })
  received_by_user_id: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'received_by_user_id' })
  received_by?: User;

  @Column({ type: 'timestamptz', nullable: true })
  voided_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  voided_by_user_id: string | null;

  /** MANDATORY when voided — §9.3, «сторно з обов'язковою причиною». That is
   *  why voiding is a trio of columns and not a status value, and why
   *  `transfer_status` lost its `void` member on 03.09.2026. */
  @Column({ type: 'text', nullable: true })
  void_reason: string | null;

  /**
   * `cascade: ['insert']` so ONE `save` writes the whole aggregate — §2.3, one
   * visit is one document, and a partially written intake is a receipt that
   * does not match the paper in the supplier's hand.
   *
   * `eager: false` deliberately: an eagerly loaded relation is how a list
   * endpoint quietly becomes N+1, and `GET /intakes` returns headers only.
   */
  @OneToMany(() => IntakeItem, (item) => item.intake, { cascade: ['insert'], eager: false })
  items?: IntakeItem[];

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}

import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Shift } from '../shifts/shift.entity';
import { Supplier } from '../suppliers/supplier.entity';
import { User } from '../users/user.entity';

/**
 * Cash handed over the counter. Like `intakes`, it stores neither the point nor
 * the business date — both come from `shift_id`.
 *
 * TWO TRIOS THAT LOOK ALIKE AND ARE NOT THE SAME RULE:
 *
 *   void_at / voided_by_user_id / void_reason     — reason MANDATORY (§9.3)
 *   return_settled_at / _by_user_id / return_note — note OPTIONAL
 *
 * §9.3 demands a reason for a void and says nothing about annotating the cash
 * coming back, so the CHECKs differ: the void trio is all-or-nothing, the
 * return pair requires only the timestamp and the settler.
 *
 * VOIDING A PAYOUT DOES NOT RETURN THE CASH, and this is the schema's sharpest
 * rule: «сторновано виплату 8 000,00 ₴ → каса НЕ виросла на 8 000 → створюється
 * ОЧІКУВАНЕ ПОВЕРНЕННЯ під фізичне внесення грошей… Інакше сторно стає способом
 * красти.» The money left the drawer and comes back only when a human puts it
 * back, which is what stamping `return_settled_at` records. The amount is NEVER
 * stored again — it always equals `amount`, and «внесення завжди на всю суму:
 * часткового не буває».
 *
 * THE ASYMMETRY THIS CREATES, named rather than fixed: the DEBT formula filters
 * voided payouts OUT (they were never really paid), while the CASH formula
 * counts them IN until `return_settled_at` is set (the money physically left).
 * One column, two opposite readings, in two different queries.
 *
 * `amount > 0` IS STRICTER THAN §3.7, which permits «будь-яка сума від 0 до
 * "Разом"». A zero payout is a receipt for handing over nothing; «видано 0,00»
 * in §3.7 describes an intake with no payout document at all, not a payout row
 * of zero. Spec §8.6.
 */
@Entity('payouts')
@Unique('UQ_payouts_code', ['code'])
@Check(
  'CHK_payouts_void_trio',
  `num_nulls("voided_at", "voided_by_user_id", "void_reason") IN (0, 3)`,
)
@Check(
  'CHK_payouts_return_pair',
  `("return_settled_at" IS NULL) = ("return_settled_by_user_id" IS NULL)`,
)
@Check('CHK_payouts_return_requires_void', `"return_settled_at" IS NULL OR "voided_at" IS NOT NULL`)
@Check('CHK_payouts_amount', `"amount" > 0`)
@Index('IDX_payouts_supplier_created', ['supplier_id', 'created_at'])
@Index('IDX_payouts_shift', ['shift_id'])
export class Payout {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** `{POINT}-PO-{YYYYMMDD}-{NNN}`, composed AND numbered server-side since
   *  2026-09-18 — see `common/document-code.ts`, and `intakes.code`'s twin of
   *  this comment. */
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

  /** `numeric` — a STRING, never a number. */
  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount: string;

  /** §10.6 — «підпис під документом належить тому, хто натиснув». */
  @Column({ type: 'uuid' })
  paid_by_user_id: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'paid_by_user_id' })
  paid_by?: User;

  @Column({ type: 'timestamptz', nullable: true })
  voided_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  voided_by_user_id: string | null;

  @Column({ type: 'text', nullable: true })
  void_reason: string | null;

  /** The moment a human physically put the cash back. See this class's header:
   *  a void alone does NOT do this. */
  @Column({ type: 'timestamptz', nullable: true })
  return_settled_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  return_settled_by_user_id: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'return_settled_by_user_id' })
  return_settled_by?: User | null;

  /** OPTIONAL, unlike `void_reason`. See this class's header. */
  @Column({ type: 'text', nullable: true })
  return_note: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}

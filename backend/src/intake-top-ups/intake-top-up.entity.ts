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
import { Intake } from '../intakes/intake.entity';
import { User } from '../users/user.entity';

/**
 * «Фантомний залишок» (#61) — a fixed sum the owner owes a supplier for berries
 * already received, at a price agreed after the receipt was printed.
 *
 * THERE IS NO `supplier_id`, NO `shift_id`, NO `collection_point_id` AND NO
 * DATE COLUMN, and all four absences are the design. The supplier arrives
 * through `intake_id`; the point arrives through the supplier (§3.9 —
 * «supplier_id уже означає точку»). Storing any of them again would be «два
 * примірники одного факту», which the DBML header forbids. The practical
 * consequence is the same one `Intake` warns about, one hop longer: SCOPING TO
 * A POINT IS A TWO-HOP JOIN — `intake_top_ups → intakes → suppliers`.
 *
 * THE `NOT NULL` ON `intake_id` IS LOAD-BEARING AND NOT A STYLE CHOICE. A
 * nullable link would make this table the «вступний залишок» mechanism the
 * owner removed on 04.09.2026 — «борг, набутий до запуску, у систему не
 * заводиться взагалі». Requiring a parent means debt can only be topped up
 * where berries were actually received and recorded; it cannot be invented.
 *
 * `amount > 0`, STRICTLY. A negative row would reduce a debt without money
 * leaving the drawer, which is the «Залишок» input field §3.2 refuses «для
 * ЖОДНОЇ ролі». The downward path is §9.3's void-and-reissue of the receipt.
 * Whoever wants a signed column must also revisit the locking argument in the
 * spec's §7.4 — it is safe only because this value cannot shrink a debt.
 *
 * NO `code` COLUMN. `composeDocumentCode` exists because an operator types the
 * number printed in the paper receipt book (§6.2); a top-up has no paper twin,
 * and a synthetic code would be a forged receipt number. `transfers` made the
 * same call for the same reason.
 *
 * A VOIDED PARENT NEUTRALISES THIS ROW WITHOUT TOUCHING IT — see `debtSql` in
 * `supplier-balance.service.ts`. There is deliberately no cascade: voiding an
 * intake is something an OPERATOR may do to their own receipt (§9.4), and a
 * cascade would have that operator stamping `voided_by_user_id` on a row the
 * OWNER created.
 */
@Entity('intake_top_ups')
@Check('CHK_intake_top_ups_amount', `"amount" > 0`)
@Check(
  'CHK_intake_top_ups_void_trio',
  `num_nulls("voided_at", "voided_by_user_id", "void_reason") IN (0, 3)`,
)
@Index('IDX_intake_top_ups_intake', ['intake_id'])
export class IntakeTopUp {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  intake_id: string;

  @ManyToOne(() => Intake, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'intake_id' })
  intake?: Intake;

  /** `numeric` — a STRING, never a number (foundation §5.1). */
  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount: string;

  /** MANDATORY, and free text by decision — #61's second requirement is «щоб
   *  при перегляді історії було ясно зрозуміло, чому». Every explanation field
   *  in this schema is free text; none is enumerated. */
  @Column({ type: 'text' })
  reason: string;

  @Column({ type: 'uuid' })
  created_by_user_id: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by_user_id' })
  created_by?: User;

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

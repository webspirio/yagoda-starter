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
import { CollectionPoint } from '../collection-points/collection-point.entity';
import { User } from '../users/user.entity';
import { TransferStatus } from './transfer-status.enum';

/**
 * Money and empty crates travelling from the base to a point in one trip
 * (§7.9). The ONLY thing in §7.3's closed list that puts cash INTO a drawer.
 *
 * IT CARRIES ITS OWN POINT AND ITS OWN DATE, unlike `intakes` and `payouts`,
 * which store neither and learn both from `shift_id`. That is deliberate and
 * this module honours it: accepting a transfer requires NO OPEN SHIFT (spec
 * §6.4). The carrier arrives when they arrive — §7.9 has the point counting in
 * the morning, before the 07:30 shift opens — and forcing a shift open would
 * commit that day's business date merely to sign for a delivery.
 *
 * `accepted_date` IS STAMPED BY BOTH POINT ACTIONS, «Прийняв» AND «Не
 * сходиться» (spec §6.2, and the 09.09.2026 amendment to the `transfers` Note
 * in `28-db-schema.dbml`). Both record the same physical fact — the money
 * arrived here today — and differ only on whether the amount matched. The
 * DBML's original invariant said `accepted_*` are filled «рівно при status =
 * accepted`; that was written before the cash formula, whose outer filter is
 * `accepted_date <= D`, and under it the formula's own `disputed` branch is
 * unreachable dead code.
 *
 * WHAT ENTERS THE CASH FORMULA, by client ruling of 09.09.2026 which overrules
 * §7.9 step 4б: an accepted transfer contributes `cash`; a disputed one
 * contributes `resolved_cash` once the owner has closed the dispute and
 * `reported_cash` until then. The money is credited AT THE AMOUNT ACTUALLY
 * RECEIVED, and the shortfall is settled outside the system. Excluding it
 * would leave that point's expected cash wrong by the shortfall on every count
 * from then on, burying the real discrepancy under a permanent phantom one.
 *
 * `carrier` IS TEXT, NOT AN ACCOUNT. «Іван, Ducato» is who signs the paper
 * book. A trip is identified by its DATE and its CARRIER — §7.9 describes a
 * transfer completely and never mentions a trip number.
 *
 * NO `PATCH`. §9.3 — a correction is a NEW document pointing at the one it
 * corrects (`correction_of_transfer_id`), never a silent edit.
 */
@Entity('transfers')
@Check('CHK_transfers_cash_non_negative', `"cash" >= 0`)
@Check('CHK_transfers_crates_non_negative', `"crates" >= 0`)
@Check('CHK_transfers_not_empty', `"cash" > 0 OR "crates" > 0`)
@Check(
  'CHK_transfers_reported_non_negative',
  `("reported_cash" IS NULL OR "reported_cash" >= 0)
   AND ("reported_crates" IS NULL OR "reported_crates" >= 0)`,
)
@Check(
  'CHK_transfers_resolved_non_negative',
  `("resolved_cash" IS NULL OR "resolved_cash" >= 0)
   AND ("resolved_crates" IS NULL OR "resolved_crates" >= 0)`,
)
@Check(
  'CHK_transfers_void_trio',
  `num_nulls("voided_at", "voided_by_user_id", "void_reason") IN (0, 3)`,
)
@Check('CHK_transfers_no_self_correction', `"correction_of_transfer_id" <> "id"`)
@Index('IDX_transfers_point_accepted_date', ['collection_point_id', 'accepted_date'])
@Index('IDX_transfers_status', ['status'])
export class Transfer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  collection_point_id: string;

  @ManyToOne(() => CollectionPoint, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'collection_point_id' })
  collection_point?: CollectionPoint;

  /** `numeric` — a STRING, never a number. */
  @Column({ type: 'numeric', precision: 12, scale: 2 })
  cash: string;

  @Column({ type: 'int' })
  crates: number;

  /** §7.9 — «без перевізника документ НЕ проводиться». */
  @Column({ type: 'varchar' })
  carrier: string;

  @Column({ type: 'uuid' })
  sent_by_user_id: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'sent_by_user_id' })
  sent_by?: User;

  @Column({ type: 'timestamptz' })
  sent_at: Date;

  @Column({
    type: 'enum',
    enum: TransferStatus,
    enumName: 'transfer_status',
    default: TransferStatus.Sent,
  })
  status: TransferStatus;

  @Column({ type: 'uuid', nullable: true })
  accepted_by_user_id: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'accepted_by_user_id' })
  accepted_by?: User | null;

  /** THE DAY THE MONEY REACHED THE POINT, and what the cash formula filters
   *  on. Stamped by BOTH point actions — see this class's header. */
  @Column({ type: 'date', nullable: true })
  accepted_date: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  accepted_at: Date | null;

  /** What the point counted at «Не сходиться». Enters the cash formula while
   *  the dispute is open — the 09.09.2026 ruling; see this class's header. */
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  reported_cash: string | null;

  @Column({ type: 'int', nullable: true })
  reported_crates: number | null;

  @Column({ type: 'text', nullable: true })
  dispute_note: string | null;

  /** The owner's final word, which supersedes `reported_*` once set. Status
   *  stays `disputed` forever. */
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  resolved_cash: string | null;

  @Column({ type: 'int', nullable: true })
  resolved_crates: number | null;

  @Column({ type: 'uuid', nullable: true })
  resolved_by_user_id: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'resolved_by_user_id' })
  resolved_by?: User | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolved_at: Date | null;

  /** §9.3 — a correction is a new document. Must name a transfer at the SAME
   *  point; the service checks that, because a cross-point correction would
   *  move money between drawers silently. */
  @Column({ type: 'uuid', nullable: true })
  correction_of_transfer_id: string | null;

  @ManyToOne(() => Transfer, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'correction_of_transfer_id' })
  correction_of?: Transfer | null;

  /** SEE THE ENUM'S HEADER: a voided transfer keeps `status = 'accepted'`. */
  @Column({ type: 'timestamptz', nullable: true })
  voided_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  voided_by_user_id: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'voided_by_user_id' })
  voided_by?: User | null;

  @Column({ type: 'text', nullable: true })
  void_reason: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}

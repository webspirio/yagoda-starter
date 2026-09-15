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
import { CollectionPoint } from '../collection-points/collection-point.entity';
import { User } from '../users/user.entity';
import { ShiftStatus } from './shift-status.enum';

/**
 * A shift is one point's working day. It exists so `intakes` and `payouts`
 * have somewhere to hang a point and a business date, neither of which they
 * store themselves — and, since the cash counts slice, so every cash count and
 * every cash movement has a container to be settled in (§3.3).
 *
 * THREE DELIBERATE ABSENCES, all of which a later reader will try to "fix":
 *
 * 1. NO `void_*` trio. A shift is not a paper document — it has no `code`, no
 *    receipt, no supplier copy — which is exactly why `intakes` and `payouts`
 *    carry one and this does not. A mistaken close is undone by REOPENING
 *    (owner-only), not by voiding. Spec §8.2.
 * 2. NO `opened_at`. `created_at` IS the open instant. The DBML gives both, but
 *    server-assigned they hold the same value in every row forever, and the
 *    schema's header forbids «два примірники одного факту». Same argument that
 *    removed `grade_prices.set_at`. Spec §8.3.
 * 3. NO cash columns of any kind, and `cash_counts` now SHIPS — so this is no
 *    longer a deferral but the settled shape. All three recounts live there
 *    (§20:50, §7.6): opening, midday and closing, one row each, written from
 *    inside this shift's own transactions. Denormalising any of them onto this
 *    row would be «два примірники одного факту».
 *
 * `explanation` IS WRITTEN, by `ShiftsService.setExplanation` behind
 * `PUT /shifts/:id/explanation` (owner-only, §6.5). `ShiftStatus`'s
 * `AwaitingExplanation` is the half that stayed unreachable, and BY DECISION
 * rather than by absence: the client's 09.09.2026 ruling removed the blocking
 * a discrepancy used to impose (§7.7, cash counts spec §11.1). See the enum.
 *
 * TWO UNIQUE CONSTRAINTS, AND THEY ARE A PAIR:
 *
 * - `UQ_shifts_open_per_point` is PARTIAL (`WHERE closed_at IS NULL`) and lives
 *   only in the migration — TypeORM cannot express it, so it is deliberately
 *   absent from this metadata rather than declared wrongly. §7.8: «дві
 *   відкриті зміни це дві книги на одну шухляду».
 * - `UQ_shifts_point_business_date` is an ADDITION to the DBML, which writes
 *   that index non-unique. It buys one row per point per day for every later
 *   report, and it costs a one-way close — which is why
 *   `POST /shifts/:id/reopen` exists. Removing one without the other strands a
 *   point for a whole day. Spec §8.1.
 *
 * `business_date` is a `date`, therefore a STRING ('YYYY-MM-DD') in TypeScript.
 * Typing it `Date` would put a timezone back into a column that has none, and
 * `common/document-code.ts` reads it as a string to build every receipt code.
 */
@Entity('shifts')
@Unique('UQ_shifts_point_business_date', ['collection_point_id', 'business_date'])
@Check('CHK_shifts_closed_pair', `("closed_at" IS NULL) = ("closed_by_user_id" IS NULL)`)
// Written as open <=> no closed_at, NOT closed <=> closed_at, so
// 'awaiting_explanation' stays STORABLE alongside a closed_at. Nothing writes
// that status today — the 09.09.2026 ruling made a discrepancy stop blocking a
// close — but the looser form is what keeps reversing that ruling a code
// change rather than a migration.
@Check('CHK_shifts_open_status', `("status" = 'open') = ("closed_at" IS NULL)`)
// DECLARED SO `migration:generate` DOES NOT PROPOSE DROPPING IT. TypeORM's
// `where` option can express this partial index, and omitting it made a
// generate run offer to remove the one constraint §7.8 rests on — «дві
// відкриті зміни це дві книги на одну шухляду». There is no separate
// `@Index` on (collection_point_id, business_date): `@Unique` above already
// creates one, and declaring both made generate propose a redundant index.
@Index('UQ_shifts_open_per_point', ['collection_point_id'], {
  unique: true,
  where: 'closed_at IS NULL',
})
export class Shift {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  collection_point_id: string;

  @ManyToOne(() => CollectionPoint, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'collection_point_id' })
  collection_point?: CollectionPoint;

  @Column({ type: 'uuid' })
  opened_by_user_id: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'opened_by_user_id' })
  opened_by?: User;

  @Column({ type: 'uuid', nullable: true })
  closed_by_user_id: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'closed_by_user_id' })
  closed_by?: User | null;

  /** `date`, so a STRING — see this class's header. Server-derived at open time
   *  from `TimeService` in `APP_TIMEZONE`; never accepted from a request. */
  @Column({ type: 'date' })
  business_date: string;

  @Column({ type: 'timestamptz', nullable: true })
  closed_at: Date | null;

  @Column({
    type: 'enum',
    enum: ShiftStatus,
    enumName: 'shift_status',
    default: ShiftStatus.Open,
  })
  status: ShiftStatus;

  /** The owner's note on a shift whose drawer did not balance — written by
   *  `ShiftsService.setExplanation` (§6.5). It records what is OPEN, never what
   *  is TRUE: an explained discrepancy stays in `Σ (counted − expected)`. */
  @Column({ type: 'text', nullable: true })
  explanation: string | null;

  /** The open instant. There is no `opened_at` — see absence 2. */
  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}

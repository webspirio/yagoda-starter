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
 * A shift is one point's working day, and in this slice it is a CONTAINER and
 * nothing more: it exists so `intakes` and `payouts` have somewhere to hang a
 * point and a business date, neither of which they store themselves.
 *
 * FOUR DELIBERATE ABSENCES, all of which a later reader will try to "fix":
 *
 * 1. NO `void_*` trio. A shift is not a paper document — it has no `code`, no
 *    receipt, no supplier copy — which is exactly why `intakes` and `payouts`
 *    carry one and this does not. A mistaken close is undone by REOPENING
 *    (owner-only), not by voiding. Spec §8.2.
 * 2. NO `opened_at`. `created_at` IS the open instant. The DBML gives both, but
 *    server-assigned they hold the same value in every row forever, and the
 *    schema's header forbids «два примірники одного факту». Same argument that
 *    removed `grade_prices.set_at`. Spec §8.3.
 * 3. NO cash columns of any kind. All three recounts live in `cash_counts`
 *    (§20:50, §7.6), which does not exist yet.
 * 4. `explanation` IS PRESENT AND NOTHING WRITES IT, and `ShiftStatus`'s
 *    `AwaitingExplanation` is likewise unreachable. Both land with
 *    `cash_counts`, the only thing that can detect the discrepancy they
 *    describe (§7.7). They stay because 28-db-schema.dbml is the schema of
 *    record and because adding an enum value later is a migration nobody
 *    should have to write.
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
// 'awaiting_explanation' stays storable alongside a closed_at when cash_counts
// lands. The stricter form would need a migration then.
@Check('CHK_shifts_open_status', `("status" = 'open') = ("closed_at" IS NULL)`)
@Index('IDX_shifts_point_business_date', ['collection_point_id', 'business_date'])
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

  /** Written by NOTHING in this slice. See absence 4 in this class's header. */
  @Column({ type: 'text', nullable: true })
  explanation: string | null;

  /** The open instant. There is no `opened_at` — see absence 2. */
  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}

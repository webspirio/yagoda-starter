import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Shift } from '../shifts/shift.entity';
import { User } from '../users/user.entity';
import { CashBook } from './cash-book.enum';
import { CashCountKind } from './cash-count-kind.enum';

/**
 * A human counting the drawer. The only thing in this system that can notice
 * money is missing.
 *
 * THE POINT IS NOT HERE — it is on `shifts`, and two copies of one fact are
 * forbidden by construction. Scoping a count query to a point is a JOIN.
 *
 * `expected_amount` IS A SNAPSHOT, frozen at the moment of counting, and the
 * DBML's defence of it names a real event: voiding a transfer drops it from
 * the cash formula retroactively, so an owner voiding a three-day-old transfer
 * would otherwise silently rewrite every discrepancy recorded since. Voided
 * PAYOUTS cannot do this — they stay subtracted.
 *
 * WHAT IT MEANS: the previous non-midday count's `counted_amount`, plus this
 * shift's movements when the count is a `closing` (spec §3). For a point's
 * FIRST count there is no predecessor, so it equals `counted_amount` and the
 * discrepancy is zero by construction — not a fudge, because the client's
 * ruling is that the counted figure BECOMES the starting balance, which means
 * at that instant the expectation genuinely is whatever is in the drawer.
 *
 * THE DISCREPANCY IS NOT STORED. It is `counted_amount − expected_amount`, it
 * has no input field for any role (§7.7), and there are no thresholds — a
 * kopiyka out is the same kind of event as 350 ₴ out. A point's accumulated
 * unexplained difference is `Σ (counted − expected)` over its counts and is
 * likewise never stored: the count chain and the document line can differ by
 * the discrepancies and by nothing else.
 *
 * `counted_by_user_id` IS WHO PRESSED THE BUTTON, not who opened the shift.
 * §10.6 — «якщо касу перерахує Марія, у документі перерахунку стоїть Марія,
 * навіть якщо зміну відкривала Оксана».
 *
 * NO `void_*` TRIO AND NO `PATCH`. A count is evidence, not a document (§7.6):
 * no code, no paper twin, no supplier copy. A count that was wrong is answered
 * by counting again, never by editing. The ONE exception is §6.3's demotion of
 * `kind` on reopen, argued there.
 */
@Entity('cash_counts')
// ONLY `counted_amount` IS CONSTRAINED, AND THE ASYMMETRY IS THE POINT. A
// count is a pile of banknotes and cannot be negative. An expectation is an
// arithmetic result — the previous count plus this shift's SIGNED movements
// (§3.3) — and it goes negative whenever more money left the drawer than
// entered it, which is exactly the fact this slice exists to surface. The
// matching `CHK_cash_counts_expected_non_negative` shipped in
// `1788600000009`, made every such shift uncloseable, and was dropped by
// `1788600000010`; re-adding it here would make `migration:generate` propose
// putting it back.
@Check('CHK_cash_counts_counted_non_negative', `"counted_amount" >= 0`)
@Index('IDX_cash_counts_shift_counted_at', ['shift_id', 'counted_at'])
export class CashCount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  shift_id: string;

  @ManyToOne(() => Shift, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'shift_id' })
  shift?: Shift;

  @Column({ type: 'enum', enum: CashBook, enumName: 'cash_book' })
  book: CashBook;

  @Column({ type: 'enum', enum: CashCountKind, enumName: 'cash_count_kind' })
  kind: CashCountKind;

  /** `numeric` — a STRING, never a number. */
  @Column({ type: 'numeric', precision: 12, scale: 2 })
  counted_amount: string;

  /** See this class's header — a SNAPSHOT, never recomputed. It is SIGNED and
   *  may be negative; see the `@Check` note above the class. */
  @Column({ type: 'numeric', precision: 12, scale: 2 })
  expected_amount: string;

  @Column({ type: 'uuid' })
  counted_by_user_id: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'counted_by_user_id' })
  counted_by?: User;

  @Column({ type: 'timestamptz' })
  counted_at: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}

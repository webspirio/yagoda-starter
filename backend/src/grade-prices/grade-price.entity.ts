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
import { CollectionPoint } from '../collection-points/collection-point.entity';
import { ProductGrade } from '../products/product-grade.entity';
import { User } from '../users/user.entity';

/**
 * §4.2 — an APPEND-ONLY price journal. «Кожна зміна ціни лягає ОКРЕМИМ записом
 * із часом і автором; записи не перетираються, а додаються.» The current price
 * for a (point, grade) pair is the row with the greatest `created_at`.
 *
 * THREE ABSENCES, ALL DELIBERATE, ALL THE KIND A LATER READER "FIXES":
 *
 * 1. NO `updated_at`, and no update path anywhere. A correction is a new row.
 * 2. NO UNIQUE on (collection_point_id, product_grade_id). That constraint is
 *    exactly what forbade history in the old `shift_grade_prices`. Its absence
 *    is asserted by an inverted test in `suppliers-prices-schema.db-spec.ts`,
 *    because a `migration:generate` run that helpfully adds it would destroy
 *    §4.2 silently. A double-submitted save therefore appends two identical
 *    rows: harmless (latest wins, values match), and accepted rather than
 *    fixed, since every mechanism for preventing it is either forbidden by
 *    §4.2 or larger than the problem.
 * 3. NO `business_date`, diverging from the DBML and from foundation §5.2.
 *    Prices carry over until changed. Spec §8.1 records what that costs: §4.5
 *    stops being a DAILY mechanism, day-to-day availability rests entirely on
 *    the network-wide `product_grades.is_active`, and a stale price now fails
 *    silently and in the buyer's disfavour.
 *
 * `set_at` from the DBML is gone too: with it server-assigned it held the same
 * instant as `created_at` in every row forever, and the schema's header forbids
 * two copies of one fact. `set_by_user_id` was renamed `created_by_user_id` to
 * match.
 *
 * `max_markup` AND `max_discount` ARE POSITIVE MAGNITUDES. `max_markup = 30`
 * means `bonus <= +30`; `max_discount = 20` means `bonus >= -20`. Storing the
 * discount as -20 reads naturally here and inverts a comparison at the call
 * site; this is the form that was picked, and this comment is where it is
 * written down. They close §2.9's admitted hole — «межа мережі ±30 ₴/кг обрізає
 * bonus, але самої межі в цій схемі поки НЕМАЄ де зберігати» — split into two
 * independent numbers because a premium and a docking for «мʼята чи цвіла
 * ягода» have no reason to share a limit.
 *
 * BOTH ARE NOT NULL, and that is load-bearing. Nullable would make `null` mean
 * either "no limit" or "inherit a default", which is the `target_crates` trap
 * the DBML warns about twice: «читач, який бачить голий nullable int,
 * відтворить заборону, якої правило не просить». `0` is legal and means "no
 * adjustment permitted"; "unlimited" is inexpressible, which is correct.
 *
 * NOTHING IN THIS SLICE READS THE TWO LIMITS. The clamp lives in
 * `intake_items`, which does not exist yet. They are stored and constrained,
 * and no test here can prove they do anything — `intakes` owes that test.
 *
 * All three money columns are `numeric`, therefore STRINGS in TypeScript,
 * never numbers. No arithmetic is performed on them anywhere in this module.
 */
@Entity('grade_prices')
@Check('CHK_grade_prices_base_price', `"base_price" >= 0`)
@Check('CHK_grade_prices_max_markup', `"max_markup" >= 0`)
@Check('CHK_grade_prices_max_discount', `"max_discount" >= 0`)
@Index('IDX_grade_prices_lookup', ['collection_point_id', 'product_grade_id', 'created_at'])
export class GradePrice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  collection_point_id: string;

  @ManyToOne(() => CollectionPoint, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'collection_point_id' })
  collection_point: CollectionPoint;

  /** §4.1 — the price key is the GRADE; the reporting key is the product. */
  @Column({ type: 'uuid' })
  product_grade_id: string;

  @ManyToOne(() => ProductGrade, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_grade_id' })
  product_grade: ProductGrade;

  /** `numeric` — a STRING in TypeScript, never a number. */
  @Column({ type: 'numeric', precision: 10, scale: 2 })
  base_price: string;

  /** Positive magnitude: `bonus <= +max_markup`. */
  @Column({ type: 'numeric', precision: 10, scale: 2 })
  max_markup: string;

  /** Positive magnitude: `bonus >= -max_discount`. */
  @Column({ type: 'numeric', precision: 10, scale: 2 })
  max_discount: string;

  @Column({ type: 'uuid' })
  created_by_user_id: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by_user_id' })
  created_by: User;

  /** §4.2's worked example — «конкуренти підняли». */
  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}

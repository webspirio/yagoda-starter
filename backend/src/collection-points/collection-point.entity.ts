import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { PointKind } from './point-kind.enum';

/**
 * A point in the network. `target_cash` and `target_crates` are the daily
 * orientation figures the owner sets.
 *
 * BOTH TARGETS ARE NULLABLE WITH NO DEFAULT, AND THAT IS LOAD-BEARING.
 * §6.9 requires "—" for a point with no target rather than a zero ("нуль
 * стверджував би, що ящиків немає, тоді як ми просто не знаємо, скільки їх
 * має бути"), and §7.10 requires that a point with no cash target not appear
 * in the network-debt table at all. `default: 0` would make "not set"
 * indistinguishable from zero and break both rules at once.
 *
 * There is NO target history and no `effective_from`, by the owner's decision
 * of 03.09.2026: a target is an orientation figure for the day, not a fact
 * about the past. The mechanical consequence is accepted: changing a target
 * applies to every day, including past ones.
 *
 * An unset `target_crates` does NOT block issuing crates — it shows a warning
 * (правка 14, which overrides §9.1's "the issue button is inactive"). A target
 * lower than what is already out with people is likewise allowed WITH A
 * WARNING, not a refusal (§6.1): a target is a management decision.
 *
 * `name` is UNIQUE — AN ADDITION THIS PROJECT MAKES; `28-db-schema.dbml` does
 * not specify it. The DBML marks `products.name` and `tare_types.name` unique
 * explicitly and is silent here with no Note defending the silence, so this
 * reads as an oversight: two points both called "Копайгород" would be a live
 * hazard on the transfer screen, where a mistaken transfer is money in dispute.
 *
 * That uniqueness is now CASE-INSENSITIVE and is NOT declared here. It lives in
 * `1788600000005-YagodaCatalog` as `UQ_collection_points_name_lower`, a unique
 * index on `lower(name)` — a shape TypeORM metadata cannot express, so a
 * `@Unique` decorator here would make `migration:generate` propose re-creating
 * the old case-sensitive constraint on every run. The case fold is the DBML's
 * own argument, applied here: the `villages` table was deleted because one
 * village appeared four ways in the client's book.
 */
@Entity('collection_points')
@Unique('UQ_collection_points_code', ['code'])
@Check('CHK_collection_points_code', `"code" ~ '^[A-Z0-9]{2,8}$'`)
@Check('CHK_collection_points_target_cash', `"target_cash" IS NULL OR "target_cash" >= 0`)
@Check('CHK_collection_points_target_crates', `"target_crates" IS NULL OR "target_crates" >= 0`)
export class CollectionPoint {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  name: string;

  /**
   * The point's short identifier, and the first segment of every document code
   * written here: `KPG-IN-20260908-004` (spec §6.2).
   *
   * NOT IN `28-db-schema.dbml`. It exists because THE SEQUENCE RESTARTS AT 001
   * EVERY SHIFT (`common/document-code.ts`): without a point segment two points
   * numbering in parallel both reach «004» on the same day, and the DBML's own
   * global UNIQUE on `intakes.code` refuses the second one mid-transaction with
   * a car waiting.
   *
   * THE REASON WAS CORRECTED 2026-09-18, THE COLUMN WAS NOT. It used to say the
   * operator types the number from the paper receipt book, and that two points
   * buying identical books both have an 04412 — true while `IN` and `PO` carried
   * a number read off paper, and true of no document kind since the server
   * started numbering all four. The point segment is load-bearing either way;
   * only what it defends against moved.
   *
   * Upper ASCII alphanumeric only, CHECK-enforced, so a composed code survives
   * any encoding. THE ALPHABET HERE AND IN `common/document-code.ts` MUST
   * AGREE — changing one without the other writes codes the database rejects.
   *
   * MUTABLE, deliberately. A rename does NOT rewrite codes on documents already
   * written: those are frozen strings, not a join. The only cost is that old
   * and new receipts read differently, which is true of paper books too.
   */
  @Column({ type: 'varchar' })
  code: string;

  @Column({ type: 'enum', enum: PointKind, enumName: 'point_kind', default: PointKind.Reception })
  kind: PointKind;

  /** `numeric` — a STRING in TypeScript, never a number. See the spec's §5.1. */
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  target_cash: string | null;

  @Column({ type: 'int', nullable: true })
  target_crates: number | null;

  /** §5.6 — there is no deletion, only deactivation. */
  @Column({ type: 'bool', default: true })
  is_active: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}

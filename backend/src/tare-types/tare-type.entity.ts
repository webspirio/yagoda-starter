import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * §2.5 — a tare's weight is subtracted automatically on the intake screen.
 *
 * BOTH NUMBERS ARE OWNER-EDITABLE AND BOTH ARE SNAPSHOTTED DOWNSTREAM (§2.7):
 * `intake_items.tare_weight_kg` and `crate_issuances.deposit_per_unit` copy
 * them at write time. That is what lets this module edit money while owning no
 * money logic — raising a crate from 120 to 130 cannot move a July issuance.
 *
 * `weight_kg` and `deposit_price` are `numeric`, therefore STRINGS in
 * TypeScript, never numbers. No arithmetic is performed on them anywhere in
 * this module. See the foundation spec's §5.1.
 *
 * The two CHECKs permit ZERO and forbid NEGATIVE. A negative `weight_kg` would
 * ADD weight in §2.4's `net = (gross − pallet) − tare`, which is nonsense in
 * every direction; a genuine zero-weight row (a supplier's own bucket) and a
 * zero-deposit non-crate tare are both plausible catalog entries.
 *
 * THERE IS DELIBERATELY NO CROSS-RULE between `is_crate` and `deposit_price`.
 * `is_crate = false ⇒ deposit_price = 0` is tempting, since §6.3's завдаток is
 * a crate concept — but no rule states it, and a CHECK encoding an unstated
 * rule is exactly the trap the DBML warns about: «читач… відтворить заборону,
 * якої правило не просить». A nonsense row is inert; a wrong constraint blocks
 * a real case later.
 *
 * ЗАПИТАННЯ 12 — whether «Ящик» and «Чешка» are one unit for counting — is
 * still OPEN in the schema. It does not block this table: the counting question
 * lives in `crate_issuances` and `collection_points.target_crates`.
 *
 * NO `@Unique`: uniqueness is `UQ_tare_types_name_lower` in the migration.
 */
@Entity('tare_types')
@Check('CHK_tare_types_weight_kg', `"weight_kg" >= 0`)
@Check('CHK_tare_types_deposit_price', `"deposit_price" >= 0`)
/**
 * ONE CRATE, NETWORK-WIDE (spec §5.4). A unique index on a column that is
 * `true` for every row it covers admits exactly one such row. `is_crate` is
 * what `crate_issuances.deposit_per_unit` is snapshotted from, so two flagged
 * rows would make «the price of a crate» ambiguous — which is what the seeded
 * catalogue was until this slice.
 *
 * The owner never meets this index: `TareTypesService` demotes every other row
 * in the same transaction when the flag is set. It is the backstop, not the
 * error path.
 */
@Index('UQ_tare_types_single_crate', ['is_crate'], { unique: true, where: '"is_crate"' })
export class TareType {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  name: string;

  /** `numeric` — a STRING in TypeScript, never a number. */
  @Column({ type: 'numeric', precision: 10, scale: 2 })
  weight_kg: string;

  /** `numeric` — a STRING in TypeScript, never a number. */
  @Column({ type: 'numeric', precision: 12, scale: 2 })
  deposit_price: string;

  /** §6.2/§6.3 — which tare counts as a "ящик" for crate targets and deposits. */
  @Column({ type: 'bool', default: false })
  is_crate: boolean;

  @Column({ type: 'bool', default: true })
  is_active: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}

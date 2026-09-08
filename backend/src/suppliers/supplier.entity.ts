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
import { SupplierKind } from './supplier-kind.enum';

/**
 * A person who brings berries to ONE point.
 *
 * §3.9 — the record is nailed to the point: someone delivering to two points
 * is TWO rows, and debt from one is never settled at the other.
 * `collection_point_id` is therefore IMMUTABLE and absent from the update DTO
 * — re-pointing a row silently moves a money balance from one point's books to
 * another's, with no document changing and no trail explaining it.
 *
 * DEBT IS NOT A COLUMN HERE AND MUST NEVER BECOME ONE. It is the difference of
 * two histories, `Σ intakes − Σ payouts` filtered by `supplier_id` alone, with
 * `voided_at IS NULL` on BOTH sides. The `suppliers` Note is emphatic: «полів
 * paid / debt / balance немає ані тут, ані в intakes, і додавати їх не можна» —
 * a stored cache is exactly where the client's own working book broke, 124
 * breaks out of 1473.
 *
 * `phone` is stored CANONICAL (E.164) and nothing else — see `phone.ts` for
 * why this table diverges from the catalog's "store as typed" rule.
 * `CHK_suppliers_phone_e164` is the real guarantee; `canonicalizePhone` only
 * produces the friendly error.
 *
 * MANY NULL PHONES COEXIST AT ONE POINT, and that is правка 8's «без номеру
 * телефону» escape hatch working as designed: Postgres unique indexes treat
 * NULLs as distinct. There is deliberately no separate "has no phone" column —
 * «окремого поля під цей факт немає навмисно» — so the server cannot and must
 * not distinguish "checkbox ticked" from "field omitted".
 *
 * Constraint names are declared here explicitly so `migration:generate`
 * recognises what the migration already created and proposes nothing.
 */
@Entity('suppliers')
@Unique('UQ_suppliers_point_phone', ['collection_point_id', 'phone'])
@Check('CHK_suppliers_phone_e164', `"phone" IS NULL OR "phone" ~ '^[+][1-9][0-9]{7,14}$'`)
@Index('IDX_suppliers_point_last_name', ['collection_point_id', 'last_name'])
export class Supplier {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** IMMUTABLE after create — §3.9. Absent from `UpdateSupplierDto`. */
  @Column({ type: 'uuid' })
  collection_point_id: string;

  // The relation exists so TypeORM knows about the foreign key, and
  // `foreignKeyConstraintName` is what makes that work: the schema builder
  // matches foreign keys by NAME, so without it a future `migration:generate`
  // compares the database's `FK_suppliers_point` against a computed
  // `FK_<sha1>`, never matches, and proposes a drop-and-recreate. Same
  // reasoning as `User.collection_point` and `ProductGrade.product`.
  @ManyToOne(() => CollectionPoint, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'collection_point_id', foreignKeyConstraintName: 'FK_suppliers_point' })
  collection_point: CollectionPoint;

  @Column({ type: 'varchar' })
  first_name: string;

  @Column({ type: 'varchar' })
  last_name: string;

  /** Canonical E.164, or null. Never the raw string the operator typed. */
  @Column({ type: 'varchar', nullable: true })
  phone: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'enum', enum: SupplierKind, enumName: 'supplier_kind', default: SupplierKind.None })
  kind: SupplierKind;

  /** §5.6 — «видалення немає, тільки is_active». */
  @Column({ type: 'bool', default: true })
  is_active: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}

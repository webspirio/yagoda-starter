import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Product } from './product.entity';

/**
 * The grade is the PRICE key (§4.1) and the thing every later table points at:
 * `grade_prices.product_grade_id` and `intake_items.product_grade_id` both name
 * a grade and never mention its product. That is why the API addresses grades
 * flatly at `/product-grades/:id` rather than under their parent.
 *
 * `product_id` IS IMMUTABLE — it is absent from the update DTO. Re-parenting a
 * grade would silently rewrite history: `intake_items` stores the grade id
 * alone, so moving "1 сорт" from Малина to Полуниця moves every receipt line
 * ever written against it into another product's totals, with no document
 * changing and no trail explaining it. A grade under the wrong product is
 * deactivated and recreated.
 *
 * The name IS mutable, and a rename is retroactive by construction — nothing
 * downstream snapshots it. That is accepted: a rename corrects spelling, it
 * does not change identity. A different berry is a new product.
 *
 * NO `@Unique`: uniqueness is `UQ_product_grades_product_name_lower`, a unique
 * index on `(product_id, lower(name))` in the migration. Same name is legal
 * under two different products — "1 сорт" exists for every berry.
 */
@Entity('product_grades')
@Index('IDX_product_grades_product', ['product_id'])
export class ProductGrade {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  product_id: string;

  // The relation exists so TypeORM knows about the foreign key, and
  // `foreignKeyConstraintName` is what makes that work: the schema builder
  // matches foreign keys by NAME, so without it a future `migration:generate`
  // compares the database's `FK_product_grades_product` against a computed
  // `FK_<sha1>`, never matches, and proposes a drop-and-recreate. Same reasoning
  // as `User.collection_point`.
  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_id', foreignKeyConstraintName: 'FK_product_grades_product' })
  product: Product;

  @Column({ type: 'varchar' })
  name: string;

  /** §4.1 — this flag is what makes a product visible or not. There is no
   *  deletion; deactivation is the only removal verb. */
  @Column({ type: 'bool', default: true })
  is_active: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}

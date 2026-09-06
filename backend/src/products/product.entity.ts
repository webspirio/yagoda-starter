import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * A product is the REPORTING key (§4.1); the price key is its grade.
 *
 * THERE IS NO `is_active` COLUMN, and that is a decision the DBML argues for
 * at length: «видимість товару ВИВОДИТЬСЯ, а не зберігається». §4.1 states the
 * mechanism literally — «Товар без жодного АКТИВНОГО сорту приймальнику не
 * показується» — with Кизил, which has no grades at all, as the worked
 * example. A flag here would be a second copy of a fact that already lives in
 * `product_grades.is_active`, and would create a state no rule answers: product
 * off, grade on, day price set.
 *
 * Retirement is therefore deactivating the grades, and deactivating the LAST
 * active grade is never blocked — that IS the mechanism.
 *
 * NO `@Unique` ON `name`, deliberately. Uniqueness is case-INSENSITIVE and
 * lives in the migration as `UQ_products_name_lower`, a unique index on
 * `lower(name)`, which TypeORM metadata cannot express. A decorator here would
 * make `migration:generate` propose re-creating a plain case-sensitive
 * constraint on every run. The reason case matters is the DBML's own: the
 * `villages` table was deleted because one village appeared four ways in the
 * client's book — «копайгород» 571 rows, «Копайгород» 175, «Копайгород » 45,
 * «Копай».
 *
 * NO `display_order` either. The DBML has one; nothing consumes it and no rule
 * cites it, so it is not implemented — see the spec's §8.1. Lists order by name.
 */
@Entity('products')
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  name: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}

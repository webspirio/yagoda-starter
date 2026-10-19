import type { SelectQueryBuilder } from 'typeorm';
import type { Supplier } from './supplier.entity';

/**
 * THE supplier name order (last, then first name), shared by `GET /suppliers`
 * and `GET /supplier-totals`. The builder's supplier alias MUST be `s`.
 *
 * ICU's Ukrainian collation, not the database default: the cluster is
 * `en_US.utf8` under the `c` provider, which orders by code point — Є and І
 * before А, Ґ after Я.
 */
export function orderBySupplierName(qb: SelectQueryBuilder<Supplier>, dir: 'ASC' | 'DESC'): void {
  qb.addOrderBy('s.last_name COLLATE "uk-UA-x-icu"', dir).addOrderBy('s.first_name COLLATE "uk-UA-x-icu"', dir);
}

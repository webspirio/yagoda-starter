import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ListSupplierBalancesQueryDto } from '../dto/list-supplier-balances.query';
import {
  SupplierBalanceRow,
  SupplierBalanceRowResponse,
  toSupplierBalanceRowResponse,
} from '../supplier-balance.mapper';
import { debtSql } from '../supplier-debt.sql';
import { resolvePointFilter } from '../../auth/access/point-scope';
import { Paginated } from '../../common/dto/paginated';
import { skipOf } from '../../common/dto/pagination-query.dto';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

/**
 * The «Залишки» screen: every supplier in scope with THE debt formula correlated per row,
 * filtered, ordered and paged in Postgres. `include_zero=false` drops exactly `0.00` — a
 * deactivated supplier still owed money stays. The order is total (debt, names, id) so paging
 * is stable. The point filter chooses WHICH suppliers appear; the formula has none.
 */
@Injectable()
export class ListSupplierBalancesQuery {
  constructor(private readonly dataSource: DataSource) {}

  async list(
    actor: AuthenticatedUser,
    query: ListSupplierBalancesQueryDto,
  ): Promise<Paginated<SupplierBalanceRowResponse>> {
    const pointId = resolvePointFilter(actor, query.collection_point_id) ?? null;
    const manager = this.dataSource.manager;

    // Shared by the page and the count, so the two cannot drift apart.
    const scoped = `SELECT s.id, s.first_name, s.last_name, s.is_active, s.collection_point_id,
                           ${debtSql('s.id')} AS debt
                      FROM suppliers s
                     WHERE ($1::uuid IS NULL OR s.collection_point_id = $1::uuid)`;
    const visible = `($2::boolean OR b.debt <> 0)`;

    const rows = (await manager.query(
      `SELECT b.id AS supplier_id, b.first_name, b.last_name, b.is_active,
              b.collection_point_id, b.debt::text AS debt
         FROM (${scoped}) b
        WHERE ${visible}
        ORDER BY b.debt DESC, b.last_name ASC, b.first_name ASC, b.id ASC
        LIMIT $3 OFFSET $4`,
      [pointId, query.include_zero, query.limit, skipOf(query)],
    )) as SupplierBalanceRow[];

    // `::int` so the driver hands back a number: `COUNT` is `bigint`, which
    // `pg` returns as a string, and `Number()` is banned in this module.
    const [{ total }] = (await manager.query(
      `SELECT COUNT(*)::int AS total FROM (${scoped}) b WHERE ${visible}`,
      [pointId, query.include_zero],
    )) as { total: number }[];

    return {
      data: rows.map(toSupplierBalanceRowResponse),
      total,
      page: query.page,
      limit: query.limit,
    };
  }
}

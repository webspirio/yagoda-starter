import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ListSupplierBalancesQueryDto } from '../dto/list-supplier-balances.query';
import {
  SupplierBalanceListResponse,
  SupplierBalanceRow,
  toSupplierBalanceRowResponse,
} from '../supplier-balance.mapper';
import { debtSql, oldestOpenDateSql } from '../supplier-debt.sql';
import { resolvePointFilter } from '../../auth/access/point-scope';
import { skipOf } from '../../common/dto/pagination-query.dto';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

/**
 * The «Залишки» screen: every supplier in scope with THE debt formula correlated per row,
 * filtered, ordered and paged in Postgres. `include_zero=false` drops exactly `0.00` — a
 * deactivated supplier still owed money stays. The order is total (debt, names, id) so paging
 * is stable. The point filter chooses WHICH suppliers appear; the formula has none.
 *
 * Each row also carries its oldest open line's date, and the envelope the oldest of those among
 * the rows owed money (#101) — computed beside `total`, over every visible row rather than the
 * loaded page, so «Найстаріший залишок» stays true past the screen's 100-row `limit`. «Всього
 * винні» is summed there too (#229): across every point a network passes 100 debtors, and a tile
 * that summed the page would print a partial figure as the headline.
 */
@Injectable()
export class ListSupplierBalancesQuery {
  constructor(private readonly dataSource: DataSource) {}

  async list(
    actor: AuthenticatedUser,
    query: ListSupplierBalancesQueryDto,
  ): Promise<SupplierBalanceListResponse> {
    const pointId = resolvePointFilter(actor, query.collection_point_id) ?? null;
    const manager = this.dataSource.manager;

    // Shared by the page and the count, so the two cannot drift apart.
    const scoped = `SELECT s.id, s.first_name, s.last_name, s.is_active, s.collection_point_id,
                           ${debtSql('s.id')} AS debt,
                           ${oldestOpenDateSql('s.id')} AS oldest_open_date
                      FROM suppliers s
                     WHERE ($1::uuid IS NULL OR s.collection_point_id = $1::uuid)`;
    const visible = `($2::boolean OR b.debt <> 0)`;

    const rows = (await manager.query(
      `SELECT b.id AS supplier_id, b.first_name, b.last_name, b.is_active,
              b.collection_point_id, b.debt::text AS debt,
              b.oldest_open_date::text AS oldest_open_date
         FROM (${scoped}) b
        WHERE ${visible}
        ORDER BY b.debt DESC, b.last_name ASC, b.first_name ASC, b.id ASC
        LIMIT $3 OFFSET $4`,
      [pointId, query.include_zero, query.limit, skipOf(query)],
    )) as SupplierBalanceRow[];

    // `::int` so the driver hands back a number: `COUNT` is `bigint`, which
    // `pg` returns as a string, and `Number()` is banned in this module.
    // The three tiles are over rows OWED money only: a supplier in credit must never shrink the
    // total owed to suppliers who are actually waiting on cash, nor count among «Постачальників із
    // залишком» (audit D9) — `total` stays the pager's row count, credits included. `0.00`, not
    // `0`, keeps the sum scale 2.
    const [{ total, oldest_open_date, total_owed, owed_count }] = (await manager.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE b.debt > 0)::int AS owed_count,
              (MIN(b.oldest_open_date) FILTER (WHERE b.debt > 0))::text AS oldest_open_date,
              COALESCE(SUM(b.debt) FILTER (WHERE b.debt > 0), 0.00)::text AS total_owed
         FROM (${scoped}) b WHERE ${visible}`,
      [pointId, query.include_zero],
    )) as {
      total: number;
      oldest_open_date: string | null;
      total_owed: string;
      owed_count: number;
    }[];

    return {
      data: rows.map(toSupplierBalanceRowResponse),
      total,
      page: query.page,
      limit: query.limit,
      oldest_open_date,
      total_owed,
      owed_count,
    };
  }
}

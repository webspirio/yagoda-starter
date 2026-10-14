import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Supplier } from '../../suppliers/supplier.entity';
import { applySupplierSearch } from '../../suppliers/supplier-search';
import {
  ListSupplierTotalsQueryDto,
  SortOrder,
  SupplierTotalsSort,
} from '../dto/list-supplier-totals.query';
import {
  SupplierTotals,
  SupplierTotalsRowResponse,
  toSupplierTotalsRowResponse,
} from '../supplier-balance.mapper';
import { accruedSql, kgTotalSql, mainProductSql } from '../supplier-totals.sql';
import { resolvePointFilter } from '../../auth/access/point-scope';
import { Paginated } from '../../common/dto/paginated';
import { skipOf } from '../../common/dto/pagination-query.dto';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

const DEFAULT_ORDER: Record<SupplierTotalsSort, SortOrder> = { weight: 'desc', amount: 'desc', name: 'asc' };
const AGGREGATE: Record<Exclude<SupplierTotalsSort, 'name'>, string> = { weight: 'kg_total', amount: 'accrued' };

/**
 * §11.4's «топ здавальників»: every active supplier in scope with all-time
 * weight, accrued and main product, ranked and paged in Postgres. Each total is
 * a correlated subquery on an indexed `supplier_id`; ranking by one evaluates
 * it for every supplier in scope — hundreds, not a concern.
 *
 * Counted BEFORE the aggregates are selected, on the same builder, so the page
 * and `total` share scope and search by construction. The tail
 * (names, then id) keeps paging stable: same-named people at two points are
 * ordinary (§3.9).
 */
@Injectable()
export class ListSupplierTotalsQuery {
  constructor(@InjectRepository(Supplier) private readonly repo: Repository<Supplier>) {}

  async list(
    actor: AuthenticatedUser,
    query: ListSupplierTotalsQueryDto,
  ): Promise<Paginated<SupplierTotalsRowResponse>> {
    const pointId = resolvePointFilter(actor, query.collection_point_id);
    const qb = this.repo.createQueryBuilder('s').where('s.is_active = true');
    if (pointId) qb.andWhere('s.collection_point_id = :pointId', { pointId });
    applySupplierSearch(qb, query.q);

    const total = await qb.getCount();

    const sort = query.sort ?? 'weight';
    const dir = (query.order ?? DEFAULT_ORDER[sort]) === 'asc' ? 'ASC' : 'DESC';
    qb.addSelect(kgTotalSql('s.id'), 'kg_total')
      .addSelect(accruedSql('s.id'), 'accrued')
      .addSelect(mainProductSql('s.id'), 'main_product_name');
    if (sort === 'name') {
      qb.orderBy('s.last_name', dir).addOrderBy('s.first_name', dir);
    } else {
      qb.orderBy(AGGREGATE[sort], dir).addOrderBy('s.last_name', 'ASC').addOrderBy('s.first_name', 'ASC');
    }
    qb.addOrderBy('s.id', 'ASC').offset(skipOf(query)).limit(query.limit);

    // No joins, so raw rows and entities are one-to-one and in the same order.
    const { entities, raw } = await qb.getRawAndEntities<SupplierTotals>();
    return {
      data: entities.map((s, i) => toSupplierTotalsRowResponse(s, raw[i])),
      total,
      page: query.page,
      limit: query.limit,
    };
  }
}

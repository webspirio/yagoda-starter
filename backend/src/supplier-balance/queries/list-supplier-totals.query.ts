import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Supplier } from '../../suppliers/supplier.entity';
import { applySupplierSearch } from '../../suppliers/supplier-search';
import { orderBySupplierName } from '../../suppliers/supplier-order';
import {
  ListSupplierTotalsQueryDto,
  SortOrder,
  SupplierTotalsSort,
  SupplierTotalsStatus,
} from '../dto/list-supplier-totals.query';
import {
  SupplierTotals,
  SupplierTotalsRowResponse,
  toSupplierTotalsRowResponse,
} from '../supplier-balance.mapper';
import { accruedSql, kgTotalSql, mainProductSql } from '../supplier-totals.sql';
import { resolvePointFilter } from '../../auth/access/point-scope';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

const DEFAULT_ORDER: Record<SupplierTotalsSort, SortOrder> = { weight: 'desc', amount: 'desc', name: 'asc' };
const AGGREGATE: Record<Exclude<SupplierTotalsSort, 'name'>, string> = { weight: 'kg_total', amount: 'accrued' };

/**
 * §11.4's «топ здавальників»: every supplier in scope matching `status` (active by default) with all-time
 * weight, accrued and main product, ranked in Postgres.
 *
 * UNPAGED on purpose (PR #253 review): the sort keys are live sums, so an
 * offset page drifts whenever a document lands between two requests and a
 * supplier can be skipped outright. Ranking evaluates every aggregate for
 * every supplier in scope anyway, so a LIMIT saved only the transfer — at
 * hundreds of suppliers per point, not worth a list that can lie.
 *
 * The tail (names, then id) keeps the order total: same-named people at two
 * points are ordinary (§3.9).
 */
const STATUS_PREDICATE: Record<SupplierTotalsStatus, string | null> = {
  active: 's.is_active = true',
  inactive: 's.is_active = false',
  all: null,
};

@Injectable()
export class ListSupplierTotalsQuery {
  constructor(@InjectRepository(Supplier) private readonly repo: Repository<Supplier>) {}

  async list(actor: AuthenticatedUser, query: ListSupplierTotalsQueryDto): Promise<SupplierTotalsRowResponse[]> {
    const pointId = resolvePointFilter(actor, query.collection_point_id);
    const qb = this.repo
      .createQueryBuilder('s')
      .addSelect(kgTotalSql('s.id'), 'kg_total')
      .addSelect(accruedSql('s.id'), 'accrued')
      .addSelect(mainProductSql('s.id'), 'main_product_name');
    const active = STATUS_PREDICATE[query.status ?? 'active'];
    if (active) qb.andWhere(active);
    if (pointId) qb.andWhere('s.collection_point_id = :pointId', { pointId });
    applySupplierSearch(qb, query.q);

    const { sort } = query;
    const dir = (query.order ?? DEFAULT_ORDER[sort]) === 'asc' ? 'ASC' : 'DESC';
    if (sort === 'name') {
      orderBySupplierName(qb, dir);
    } else {
      qb.orderBy(AGGREGATE[sort], dir);
      orderBySupplierName(qb, 'ASC');
    }
    qb.addOrderBy('s.id', 'ASC');

    // No joins, so raw rows and entities are one-to-one and in the same order.
    const { entities, raw } = await qb.getRawAndEntities<SupplierTotals>();
    return entities.map((s, i) => toSupplierTotalsRowResponse(s, raw[i]));
  }
}

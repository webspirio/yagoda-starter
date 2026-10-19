import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Supplier } from '../supplier.entity';
import { ListSuppliersQueryDto } from '../dto/list-suppliers.query';
import { SupplierResponse, toSupplierResponse } from '../supplier.mapper';
import { applySupplierSearch } from '../supplier-search';
import { orderBySupplierName } from '../supplier-order';
import { resolvePointFilter } from '../../auth/access/point-scope';
import { Paginated } from '../../common/dto/paginated';
import { skipOf } from '../../common/dto/pagination-query.dto';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

/** The browsable directory: the pickers, the journal filter, the day screen. Totals
 *  per supplier are `GET /supplier-totals`'s job — a picker must not pay for them. */
@Injectable()
export class ListSuppliersQuery {
  constructor(@InjectRepository(Supplier) private readonly repo: Repository<Supplier>) {}

  async list(actor: AuthenticatedUser, query: ListSuppliersQueryDto): Promise<Paginated<SupplierResponse>> {
    const pointId = resolvePointFilter(actor, query.collection_point_id);

    const qb = this.repo.createQueryBuilder('s');
    if (pointId) qb.andWhere('s.collection_point_id = :pointId', { pointId });
    if (!query.include_inactive) qb.andWhere('s.is_active = true');
    applySupplierSearch(qb, query.q);

    orderBySupplierName(qb, 'ASC');
    const [data, total] = await qb
      // Tiebreaker, not a third sort key anyone reads. §6.3 refuses name
      // uniqueness outright — two «Іван Коваль»s at one point are ordinary —
      // and §3.9 makes the tie STRUCTURAL for an owner reading network-wide,
      // since one person delivering to two points is two rows with identical
      // names. Postgres promises no order among tied rows, so without this
      // `skip`/`take` can return one twice across pages or drop it entirely.
      // Same reasoning as `ProductGradesService.list`.
      .addOrderBy('s.id', 'ASC')
      .skip(skipOf(query))
      .take(query.limit)
      .getManyAndCount();

    return { data: data.map(toSupplierResponse), total, page: query.page, limit: query.limit };
  }
}

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payout } from '../payout.entity';
import { Shift } from '../../shifts/shift.entity';
import { ListPayoutsQueryDto } from '../dto/list-payouts.query';
import { PayoutResponse, toPayoutResponse } from '../payout.mapper';
import { resolvePointFilter } from '../../auth/access/point-scope';
import { Paginated } from '../../common/dto/paginated';
import { skipOf } from '../../common/dto/pagination-query.dto';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

@Injectable()
export class ListPayoutsQuery {
  constructor(
    @InjectRepository(Payout)
    private readonly repo: Repository<Payout>,
  ) {}

  async list(
    actor: AuthenticatedUser,
    query: ListPayoutsQueryDto,
  ): Promise<Paginated<PayoutResponse>> {
    const pointId = resolvePointFilter(actor, query.collection_point_id);

    const qb = this.repo
      .createQueryBuilder('p')
      .innerJoinAndMapOne('p.shift', Shift, 's', 's.id = p.shift_id');

    if (pointId) qb.andWhere('s.collection_point_id = :pointId', { pointId });
    if (query.shift_id) qb.andWhere('p.shift_id = :shiftId', { shiftId: query.shift_id });
    if (query.supplier_id) {
      qb.andWhere('p.supplier_id = :supplierId', { supplierId: query.supplier_id });
    }
    if (query.from) qb.andWhere('s.business_date >= :from', { from: query.from });
    if (query.to) qb.andWhere('s.business_date <= :to', { to: query.to });
    if (!query.include_voided) qb.andWhere('p.voided_at IS NULL');

    const [data, total] = await qb
      .orderBy('p.created_at', 'DESC')
      .addOrderBy('p.id', 'ASC')
      .skip(skipOf(query))
      .take(query.limit)
      .getManyAndCount();

    return {
      data: data.map((p) => toPayoutResponse(p, p.shift as Shift)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }
}

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IntakeTopUp } from '../intake-top-up.entity';
import { IntakeTopUpResponse } from '../intake-top-up.mapper';
import { ListIntakeTopUpsQueryDto } from '../dto/list-intake-top-ups.query';
import { RawTopUpRow, toTopUpResponse, topUpRows } from './intake-top-up-rows';
import { resolvePointFilter } from '../../auth/access/point-scope';
import { Paginated } from '../../common/dto/paginated';
import { skipOf } from '../../common/dto/pagination-query.dto';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

@Injectable()
export class ListIntakeTopUpsQuery {
  constructor(@InjectRepository(IntakeTopUp) private readonly repo: Repository<IntakeTopUp>) {}

  async list(
    actor: AuthenticatedUser,
    query: ListIntakeTopUpsQueryDto,
  ): Promise<Paginated<IntakeTopUpResponse>> {
    const qb = topUpRows(this.repo, resolvePointFilter(actor, query.collection_point_id));
    if (query.supplier_id)
      qb.andWhere('i.supplier_id = :supplierId', { supplierId: query.supplier_id });
    if (query.intake_id) qb.andWhere('t.intake_id = :intakeId', { intakeId: query.intake_id });
    if (!query.include_voided) qb.andWhere('t.voided_at IS NULL');

    const total = await qb.getCount();
    const rows = await qb
      .orderBy('t.created_at', 'DESC')
      .addOrderBy('t.id', 'ASC')
      .limit(query.limit)
      .offset(skipOf(query))
      .getRawMany<RawTopUpRow>();

    return { data: rows.map(toTopUpResponse), total, page: query.page, limit: query.limit };
  }
}

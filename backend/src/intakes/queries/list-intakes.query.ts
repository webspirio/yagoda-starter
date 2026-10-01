import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Intake } from '../intake.entity';
import { IntakeItem } from '../intake-item.entity';
import { Shift } from '../../shifts/shift.entity';
import { Supplier } from '../../suppliers/supplier.entity';
import { ListIntakesQueryDto } from '../dto/list-intakes.query';
import { IntakeResponse, toIntakeResponse } from '../intake.mapper';
import { rowExtrasSelects } from '../intake-row-extras';
import { resolvePointFilter } from '../../auth/access/point-scope';
import { Paginated } from '../../common/dto/paginated';
import { skipOf } from '../../common/dto/pagination-query.dto';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

/** The journal (§11.5); §9.3 keeps a voided receipt in it forever, hence include_voided defaults
 *  to true. The point scope is a JOIN through shifts. */
@Injectable()
export class ListIntakesQuery {
  constructor(@InjectRepository(Intake) private readonly repo: Repository<Intake>) {}

  async list(
    actor: AuthenticatedUser,
    query: ListIntakesQueryDto,
  ): Promise<Paginated<IntakeResponse>> {
    const pointId = resolvePointFilter(actor, query.collection_point_id);

    const qb = this.repo
      .createQueryBuilder('i')
      .innerJoinAndMapOne('i.shift', Shift, 's', 's.id = i.shift_id')
      .innerJoin(Supplier, 'sup', 'sup.id = i.supplier_id');
    for (const { sql, alias } of rowExtrasSelects('i', 'sup')) qb.addSelect(sql, alias);

    if (pointId) qb.andWhere('s.collection_point_id = :pointId', { pointId });
    if (query.shift_id) qb.andWhere('i.shift_id = :shiftId', { shiftId: query.shift_id });
    if (query.supplier_id) {
      qb.andWhere('i.supplier_id = :supplierId', { supplierId: query.supplier_id });
    }
    if (query.from) qb.andWhere('s.business_date >= :from', { from: query.from });
    if (query.to) qb.andWhere('s.business_date <= :to', { to: query.to });
    if (!query.include_voided) qb.andWhere('i.voided_at IS NULL');

    qb.orderBy('i.created_at', 'DESC')
      // Tiebreaker: two receipts punched in the same millisecond are ordinary at a busy point.
      .addOrderBy('i.id', 'ASC')
      .skip(skipOf(query))
      .take(query.limit);

    // `qb.clone()`, not `qb`: `getCount()` mutates the builder `getRawAndEntities()` is using.
    const [{ entities, raw }, total] = await Promise.all([
      qb.getRawAndEntities(),
      qb.clone().getCount(),
    ]);

    // Map by id: a position mismatch would hand one intake's extras to another, silently.
    const byId = new Map(raw.map((r) => [r.i_id as string, r]));

    // ONE query for every row's lines, not one per row. `In` over the page's
    // ids keeps this at two round trips whatever the page size; a relation on
    // the main builder would instead multiply the joined rows by the lines and
    // break `skip`/`take`.
    const itemsByIntake = new Map<string, IntakeItem[]>();
    if (query.expand === 'items' && entities.length > 0) {
      const lines = await this.repo.manager.find(IntakeItem, {
        where: { intake_id: In(entities.map((i) => i.id)) },
        relations: { tare: true, product_grade: { product: true } },
      });
      for (const line of lines) {
        const bucket = itemsByIntake.get(line.intake_id);
        if (bucket) bucket.push(line);
        else itemsByIntake.set(line.intake_id, [line]);
      }
    }

    return {
      data: entities.map((i) => {
        const row = byId.get(i.id);
        if (!row) throw new Error('intake row extras missing for ' + i.id);
        return toIntakeResponse(
          i,
          i.shift as Shift,
          {
            net_kg: row.net_kg,
            lines_count: row.lines_count,
            supplier_name: row.supplier_name,
            paid_amount: row.paid_amount,
            open_amount: row.open_amount,
          },
          // `undefined` when nobody asked (mapper omits `items` entirely);
          // `[]` — not `undefined` — when they asked and this row's bucket
          // stayed empty, so «asked, found none» stays distinguishable from
          // «not asked» even though no intake reaches zero lines today.
          itemsByIntake.get(i.id) ?? (query.expand === 'items' ? [] : undefined),
        );
      }),
      total,
      page: query.page,
      limit: query.limit,
    };
  }
}

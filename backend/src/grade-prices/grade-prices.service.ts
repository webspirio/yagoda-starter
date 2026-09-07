import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GradePrice } from './grade-price.entity';
import { CreateGradePriceDto } from './dto/create-grade-price.dto';
import { ListGradePricesQueryDto } from './dto/list-grade-prices.query';
import { CurrentGradePricesQueryDto } from './dto/current-grade-prices.query';
import { GradePriceResponse, toGradePriceResponse } from './grade-price.mapper';
import { CollectionPointsService } from '../collection-points/collection-points.service';
import { ProductGradesService } from '../products/product-grades.service';
import { assertOwnsPoint, resolvePointFilter } from '../auth/access/point-scope';
import { Paginated } from '../common/dto/paginated';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * NO `AuditService` AND NO `DataSource` HERE, AND BOTH ABSENCES ARE ARGUED FOR.
 *
 * The catalog slice's reason for auditing `tare_types` is explicitly
 * conditional — «keeps no history of its own… the audit log is the only place
 * that fact can live» — and the condition FAILS here: this table IS the
 * history. An `audit_log` row would carry the actor (already
 * `created_by_user_id`), the timestamp (already `created_at`), the reason
 * (already `reason`) and a diff reconstructible from two adjacent journal
 * rows. Four duplicated facts, in a schema whose header declares «два
 * примірники одного факту в цьому проєкті заборонені».
 *
 * With no audit write there is no second write to keep atomic, so `create()`
 * is a single `insert` and needs no transaction. Do not add one "for
 * consistency" — there is nothing to be consistent with.
 *
 * NAMED COST: `audit_log` is the single cross-cutting "what did this person
 * change last Tuesday" view, and prices are a hole in it. Cheap to close later
 * with an audit READER that unions this journal; duplicated rows written today
 * could never be un-written.
 */
@Injectable()
export class GradePricesService {
  constructor(
    @InjectRepository(GradePrice)
    private readonly repo: Repository<GradePrice>,
    private readonly points: CollectionPointsService,
    private readonly grades: ProductGradesService,
  ) {}

  /**
   * The CURRENT price per grade: `DISTINCT ON` the pair, newest first. This is
   * the read the intake screen makes, and `IDX_grade_prices_lookup` exists for
   * exactly this shape.
   *
   * Raw SQL rather than the query builder because `DISTINCT ON` has no
   * TypeORM expression, and the count must be taken over the DISTINCT result
   * rather than the underlying rows — a `findAndCount` here would report the
   * size of the whole journal as the number of current prices.
   */
  async current(
    actor: AuthenticatedUser,
    query: CurrentGradePricesQueryDto,
  ): Promise<Paginated<GradePriceResponse>> {
    const pointId = resolvePointFilter(actor, query.collection_point_id);

    const params: unknown[] = [];
    const conditions: string[] = [];
    if (pointId) {
      params.push(pointId);
      conditions.push(`gp.collection_point_id = $${params.length}`);
    }
    // §4.5 — a grade the network has retired is not offered at intake. The
    // owner's price screen passes include_inactive to see its last price.
    if (!query.include_inactive) conditions.push(`pg.is_active = true`);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // DISTINCT ON must key on the PAIR, not the grade alone: an owner with no
    // point filter spans every point, and keying on the grade alone would
    // collapse five points' prices into one arbitrary row.
    const latest = `
      SELECT DISTINCT ON (gp.collection_point_id, gp.product_grade_id) gp.*
        FROM grade_prices gp
        JOIN product_grades pg ON pg.id = gp.product_grade_id
        ${where}
       ORDER BY gp.collection_point_id, gp.product_grade_id, gp.created_at DESC`;

    const [countRow] = await this.repo.manager.query(
      `SELECT count(*)::int AS count FROM (${latest}) t`,
      params,
    );
    const rows: GradePrice[] = await this.repo.manager.query(
      `SELECT * FROM (${latest}) t
        ORDER BY t.collection_point_id, t.product_grade_id
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.limit, (query.page - 1) * query.limit],
    );

    return {
      data: rows.map(toGradePriceResponse),
      total: countRow.count,
      page: query.page,
      limit: query.limit,
    };
  }

  /** The raw journal — every row, newest first. §4.2's history, readable. */
  async list(
    actor: AuthenticatedUser,
    query: ListGradePricesQueryDto,
  ): Promise<Paginated<GradePriceResponse>> {
    const pointId = resolvePointFilter(actor, query.collection_point_id);

    const where: Record<string, unknown> = {};
    if (pointId) where.collection_point_id = pointId;
    if (query.product_grade_id) where.product_grade_id = query.product_grade_id;

    const [data, total] = await this.repo.findAndCount({
      where,
      order: { created_at: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    return { data: data.map(toGradePriceResponse), total, page: query.page, limit: query.limit };
  }

  /**
   * Appends one row. There is no update path on this table at all — §4.2,
   * «записи не перетираються, а додаються».
   *
   * §4.8's «поставити всім» bulk gesture is NOT here and is deferred to its
   * own route. WHEN IT IS BUILT, THE CARVE-OUT BELONGS ON THE SERVER: «склад
   * це звичайний пункт прийому зі своєю, вищою ціною, якого жест "поставити
   * всім" НЕ чіпає». Take the target as INTENT — `{ kind:
   * 'all_reception_points' }` expanded here to active points with `kind =
   * 'reception'` — not as an array of point ids from the client, or §4.8 ends
   * up in the browser where no test can reach it.
   */
  async create(actor: AuthenticatedUser, dto: CreateGradePriceDto): Promise<GradePriceResponse> {
    assertOwnsPoint(actor, dto.collection_point_id);

    const point = await this.points.findOneRaw(dto.collection_point_id);
    if (!point) throw new NotFoundException('Collection point not found');

    const grade = await this.grades.findOneRaw(dto.product_grade_id);
    if (!grade) throw new NotFoundException('Product grade not found');
    // REJECTED, never silently skipped: a dropped grade looks like success.
    if (!grade.is_active) {
      throw new BadRequestException({
        message: 'That grade is inactive and cannot be priced',
        code: 'PRODUCT_GRADE_INACTIVE',
      });
    }

    const price = await this.repo.save(
      this.repo.create({
        collection_point_id: dto.collection_point_id,
        product_grade_id: dto.product_grade_id,
        // Stored verbatim as strings. No arithmetic anywhere in this module.
        base_price: dto.base_price,
        max_markup: dto.max_markup,
        max_discount: dto.max_discount,
        created_by_user_id: actor.sub,
        reason: dto.reason ?? null,
      }),
    );

    return toGradePriceResponse(price);
  }
}

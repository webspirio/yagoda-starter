import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { GradePrice } from './grade-price.entity';
import { CreateGradePriceDto } from './dto/create-grade-price.dto';
import { ListGradePricesQueryDto } from './dto/list-grade-prices.query';
import { CurrentGradePricesQueryDto } from './dto/current-grade-prices.query';
import { GradePriceSheetQueryDto } from './dto/grade-price-sheet.query';
import { skipOf } from '../common/dto/pagination-query.dto';
import { BulkGradePriceDto } from './dto/bulk-grade-price.dto';
import {
  GradePriceResponse,
  GradePriceSheetResponse,
  PriceChangeRow,
  PriceChangesResponse,
  SheetCell,
  SheetPointColumn,
  toGradePriceResponse,
  toPriceChangeResponse,
} from './grade-price.mapper';
import { CollectionPointsService } from '../collection-points/collection-points.service';
import { ProductGradesService } from '../products/product-grades.service';
import { assertOwnsPoint, resolvePointFilter } from '../auth/access/point-scope';
import { Paginated } from '../common/dto/paginated';
import { timezoneConfig } from '../config/timezone.config';
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
/**
 * THE ONE DEFINITION OF «the current price»: `DISTINCT ON` the pair, newest
 * first. `IDX_grade_prices_lookup` exists for exactly this shape.
 *
 * `current()` (the operator's picker — one point, paginated, `include_inactive`)
 * and `sheet()` (the owner's grid — every point, unpaginated, active only) are
 * two READS of one rule. A second copy of this fragment is precisely how they
 * would come to disagree about which row wins, and nothing would fail loudly
 * when they did.
 *
 * KEYED ON THE PAIR, never the grade alone: a query spanning every point would
 * otherwise collapse five points' prices into one arbitrary row.
 */
function latestPricesSql(where: string): string {
  return `
      SELECT DISTINCT ON (gp.collection_point_id, gp.product_grade_id) gp.*
        FROM grade_prices gp
        JOIN product_grades pg ON pg.id = gp.product_grade_id
        ${where}
       ORDER BY gp.collection_point_id, gp.product_grade_id, gp.created_at DESC, gp.id DESC`;
}

@Injectable()
export class GradePricesService {
  constructor(
    @InjectRepository(GradePrice)
    private readonly repo: Repository<GradePrice>,
    private readonly points: CollectionPointsService,
    private readonly grades: ProductGradesService,
    /** For `changes()` alone: «today» is a LOCAL date, and `created_at` is a
     *  `timestamptz` that only the app zone can turn into one. */
    @Inject(timezoneConfig.KEY)
    private readonly tz: ConfigType<typeof timezoneConfig>,
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

    const latest = latestPricesSql(where);

    const [countRow] = await this.repo.manager.query(
      `SELECT count(*)::int AS count FROM (${latest}) t`,
      params,
    );
    const rows: GradePrice[] = await this.repo.manager.query(
      `SELECT * FROM (${latest}) t
        ORDER BY t.collection_point_id, t.product_grade_id
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.limit, skipOf(query)],
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
      // `id: 'DESC'` is a tiebreaker, not a second sort key anyone reads —
      // same reasoning as `ProductGradesService.list`. `created_at` defaults
      // to `now()`, which is TRANSACTION start time, so every row §4.8's bulk
      // «поставити всім» writes in one transaction will carry the SAME
      // timestamp. `id` is a random uuid: this buys DETERMINISM across pages,
      // not «the later one».
      order: { created_at: 'DESC', id: 'DESC' },
      skip: skipOf(query),
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
  /**
   * The CURRENT price for ONE (point, grade) pair, or `null`.
   *
   * `current()` above is the same read shaped for a screen — paginated, many
   * grades, mapped to a response. The intake path needs one row per line as an
   * entity, inside its own transaction, so it gets its own narrow seam rather
   * than paging through a list to find one pair.
   *
   * INACTIVE GRADES RETURN NULL. §4.5 — «сорт без ціни дня на прийомці не
   * показується взагалі» — and the intake path has no other place to learn a
   * grade was retired network-wide.
   *
   * KNOWN GAP, recorded rather than fixed here: this returns the newest row
   * WHATEVER ITS AGE, so a grade priced last week is still «current» today.
   * §4.5's literal reason is «щоб ніхто не порахував по вчорашній», and the
   * prices slice removed `grade_prices.business_date` (its §8.1), which is what
   * makes the rule unenforceable. Closing it needs no migration — refuse a row
   * whose `created_at` predates the shift's `business_date` — and it was
   * deferred deliberately (owner, 2026-09-08) because the gate means a morning
   * with no prices set is a morning the point cannot trade. Spec §10.3.
   */
  async currentFor(
    pointId: string,
    gradeId: string,
    manager?: EntityManager,
  ): Promise<GradePrice | null> {
    // `manager.query` rather than a repository call, matching `current()` above:
    // both need raw SQL, and passing the caller's EntityManager is what keeps
    // this read inside the intake's transaction.
    const runner = manager ?? this.repo.manager;
    const [row] = await runner.query(
      `SELECT gp.*
         FROM grade_prices gp
         JOIN product_grades pg ON pg.id = gp.product_grade_id
        WHERE gp.collection_point_id = $1
          AND gp.product_grade_id = $2
          AND pg.is_active = true
        ORDER BY gp.created_at DESC, gp.id DESC
        LIMIT 1`,
      [pointId, gradeId],
    );
    return (row as GradePrice | undefined) ?? null;
  }

  /**
   * #151 — «Зміни протягом дня»: every price written TODAY, newest first, each
   * paired with the price it replaced. §4.2's «кожна зміна лягає окремим
   * записом із часом і автором», read as a feed of when, where and by how much.
   *
   * «TODAY» IS `created_at`'s LOCAL DATE, and the `AT TIME ZONE` is not
   * decoration — the same hazard `TransfersService.list` documents. There is no
   * `business_date` on this table (spec `2026-09-07` §8.1), and a bare `::date`
   * resolves in the SESSION zone: with a UTC session the owner's 07:10 Kyiv
   * price is stored at 04:10Z and survives, but a 01:00 Kyiv one lands on
   * yesterday. Both sides go through the app zone, so they agree.
   *
   * THE «WAS» IS NOT LIMITED TO TODAY. The morning's first change replaces
   * yesterday's (or last week's — prices carry over) price, and that is the
   * number the point was trading at. A `LAG` over today's rows alone would show
   * the day's first change with no «was» at all. The LATERAL read orders by the
   * same `created_at, id` pair as `latestPricesSql`, so «the row before» and
   * «the current row» can never disagree about the order of two rows.
   *
   * SCOPED BY `resolvePointFilter` with no request value, as `sheet()` is: the
   * operator gets their own point's changes, the owner the network's — «коли,
   * ДЕ, наскільки» is a cross-point question.
   *
   * UNPAGINATED: bounded by one day of one owner's writes. NOT filtered by
   * `is_active` on grade or point — history is not filtered by the current
   * state of the thing it describes (see `ListGradePricesQueryDto`).
   */
  async changes(actor: AuthenticatedUser): Promise<PriceChangesResponse> {
    const pointId = resolvePointFilter(actor, undefined);

    // `CAST($1 AS text)`: `AT TIME ZONE` is overloaded on `text` and
    // `interval`, so an untyped parameter is ambiguous to Postgres.
    const localDate = (expr: string) => `(${expr} AT TIME ZONE CAST($1 AS text))::date`;

    // «Today» is read ONCE and then passed in, so the `date` this returns and
    // the rows it filters cannot straddle midnight between two `now()` calls.
    const [{ date }]: { date: string }[] = await this.repo.manager.query(
      `SELECT ${localDate('now()')}::text AS date`,
      [this.tz.appTimezone],
    );

    const params: unknown[] = [this.tz.appTimezone, date];
    let pointWhere = '';
    if (pointId) {
      params.push(pointId);
      pointWhere = `AND gp.collection_point_id = $${params.length}`;
    }

    const rows: PriceChangeRow[] = await this.repo.manager.query(
      `SELECT gp.id, gp.created_at, gp.collection_point_id, cp.name AS point_name,
              gp.product_grade_id, p.name AS product_name, pg.name AS grade_name,
              prev.base_price AS previous_base_price, gp.base_price, gp.reason,
              u.first_name, u.last_name
         FROM grade_prices gp
         JOIN collection_points cp ON cp.id = gp.collection_point_id
         JOIN product_grades pg ON pg.id = gp.product_grade_id
         JOIN products p ON p.id = pg.product_id
         JOIN users u ON u.id = gp.created_by_user_id
         LEFT JOIN LATERAL (
           SELECT g2.base_price
             FROM grade_prices g2
            WHERE g2.collection_point_id = gp.collection_point_id
              AND g2.product_grade_id = gp.product_grade_id
              AND (g2.created_at, g2.id) < (gp.created_at, gp.id)
            ORDER BY g2.created_at DESC, g2.id DESC
            LIMIT 1
         ) prev ON true
        WHERE ${localDate('gp.created_at')} = CAST($2 AS date)
          ${pointWhere}
        ORDER BY gp.created_at DESC, gp.id DESC`,
      params,
    );

    return {
      date,
      changes: rows.map(toPriceChangeResponse),
    };
  }

  /**
   * THE OWNER'S GRID — every active grade against every point in scope, which
   * is #89's «аркуш»: rows are grades, columns are points.
   *
   * UNPAGINATED, and that is the reason this route exists at all.
   * `CurrentGradePricesQueryDto`'s `@Max(100)` is what forced the old screen to
   * fetch «one point at a time» (its own header says so), and a sheet that
   * silently dropped a column would be worse than no sheet: a missing column
   * and an unpriced column look identical to a reader. The result is bounded by
   * (active grades x points in scope) — both small, both administered.
   *
   * SCOPED BY `resolvePointFilter`, so an OPERATOR receives a ONE-COLUMN sheet
   * of their own point and NO NEW ACCESS RULE IS WRITTEN ANYWHERE. `undefined`
   * is passed rather than a request value because there is no point parameter
   * to forge: the owner always gets every active point.
   *
   * THE WAREHOUSE IS A COLUMN LIKE ANY OTHER. §4.8 excludes it from the
   * «поставити всім» GESTURE, not from the screen — it is «звичайний пункт
   * прийому зі своєю, вищою ціною», and hiding it would lose the higher price
   * the owner needs to see. `kind` travels so the client can both mark the
   * column and leave it out of the gesture.
   *
   * INACTIVE GRADES ARE ABSENT and there is no `include_inactive` twin: §4.5
   * makes a retired grade unpriced, and the flag belongs to the picker, where
   * the owner needs the last price of a grade retired mid-season.
   */
  async sheet(
    actor: AuthenticatedUser,
    _query: GradePriceSheetQueryDto,
  ): Promise<GradePriceSheetResponse> {
    const pointId = resolvePointFilter(actor, undefined);

    const pointParams: unknown[] = [];
    let pointWhere = `WHERE cp.is_active = true`;
    if (pointId) {
      pointParams.push(pointId);
      pointWhere += ` AND cp.id = $${pointParams.length}`;
    }
    // ORDER IS TOTAL — kind, then name, then id. Postgres promises no order
    // among ties, and a sheet whose columns reshuffled between reads would be
    // unreadable. `kind` first puts the reception points together and the
    // warehouse at the end, where the gesture does not reach.
    const points: SheetPointColumn[] = await this.repo.manager.query(
      `SELECT cp.id, cp.name, cp.kind FROM collection_points cp ${pointWhere}
        ORDER BY cp.kind, cp.name, cp.id`,
      pointParams,
    );

    const grades: { id: string; grade_name: string; product_name: string }[] =
      await this.repo.manager.query(
        `SELECT pg.id, pg.name AS grade_name, p.name AS product_name
           FROM product_grades pg JOIN products p ON p.id = pg.product_id
          WHERE pg.is_active = true
          ORDER BY p.name, pg.name, pg.id`,
      );

    const ids = points.map((p) => p.id);
    // `ANY($1::uuid[])` rather than an id list built into the string: the array
    // is one parameter however many points there are.
    const cells: GradePrice[] = ids.length
      ? await this.repo.manager.query(
          `SELECT * FROM (${latestPricesSql(
            `WHERE pg.is_active = true AND gp.collection_point_id = ANY($1::uuid[])`,
          )}) t`,
          [ids],
        )
      : [];

    const byGrade = new Map<string, Record<string, SheetCell>>();
    for (const c of cells) {
      const row = byGrade.get(c.product_grade_id) ?? {};
      // Strings straight through — no arithmetic, no reformatting, no `Number`.
      row[c.collection_point_id] = {
        base_price: c.base_price,
        max_markup: c.max_markup,
        max_discount: c.max_discount,
      };
      byGrade.set(c.product_grade_id, row);
    }

    return {
      points,
      rows: grades.map((g) => ({
        product_grade_id: g.id,
        grade_name: g.grade_name,
        product_name: g.product_name,
        // AN UNPRICED CELL IS ABSENT, never `null`. §4.5 makes the absence of a
        // row the disabling mechanism itself, and a `null` on the wire invites
        // the next reader to render it as «0» — a price of zero is a thing this
        // schema can legally express, so the two must not look alike.
        prices: byGrade.get(g.id) ?? {},
      })),
    };
  }


  /**
   * «Поставити всім» — one grade, one set of numbers, every NAMED point, in ONE
   * TRANSACTION.
   *
   * THE TRANSACTION IS THE WHOLE POINT OF THE ROUTE, and spec `2026-09-07` §8.1
   * asked for it by name when it removed `business_date`: «Carry this into
   * §4.8's bulk route when it is built — that route must be ONE transaction».
   * The argument is about what a HALF-APPLIED write looks like on screen. A
   * client-side loop of N POSTs that fails on the third leaves three points at
   * 150 and two at 145 — which the sheet renders as «різні · 145–150», exactly
   * the same as prices the owner set differently ON PURPOSE. The screen would
   * be lying about the state of the network, and nothing would be visibly
   * broken.
   *
   * EVERY VALIDATION RUNS BEFORE THE TRANSACTION OPENS, so a refusal is not a
   * rollback: the write is never begun. That also keeps the failure modes
   * identical to `create()`'s, one point at a time.
   *
   * A DUPLICATE POINT ID IS REFUSED rather than deduplicated. §4.2 makes this
   * table an append-only journal, so writing the same point twice would put two
   * rows in the history for one gesture — harmless to «latest wins» and a lie
   * to anyone reading the journal. Silently collapsing it would instead make
   * `created` disagree with what was asked for.
   */
  async bulk(actor: AuthenticatedUser, dto: BulkGradePriceDto): Promise<{ created: number }> {
    if (new Set(dto.collection_point_ids).size !== dto.collection_point_ids.length) {
      throw new BadRequestException({
        message: 'The same collection point was named twice',
        code: 'DUPLICATE_COLLECTION_POINT',
      });
    }

    const grade = await this.grades.findOneRaw(dto.product_grade_id);
    if (!grade) throw new NotFoundException('Product grade not found');
    // REJECTED, never silently skipped: a dropped grade looks like success.
    if (!grade.is_active) {
      throw new BadRequestException({
        message: 'That grade is inactive and cannot be priced',
        code: 'PRODUCT_GRADE_INACTIVE',
      });
    }

    for (const id of dto.collection_point_ids) {
      assertOwnsPoint(actor, id);
      const point = await this.points.findOneRaw(id);
      if (!point) throw new NotFoundException('Collection point not found');
    }

    return this.repo.manager.transaction(async (manager: EntityManager) => {
      const rows = dto.collection_point_ids.map((id) =>
        manager.create(GradePrice, {
          collection_point_id: id,
          product_grade_id: dto.product_grade_id,
          // Stored verbatim as strings. No arithmetic anywhere in this module.
          base_price: dto.base_price,
          max_markup: dto.max_markup,
          max_discount: dto.max_discount,
          created_by_user_id: actor.sub,
          reason: dto.reason ?? null,
        }),
      );
      await manager.save(rows);
      return { created: rows.length };
    });
  }

  async create(actor: AuthenticatedUser, dto: CreateGradePriceDto): Promise<GradePriceResponse> {
    // A no-op for an owner, since they own every point — and the route is
    // owner-only, so nothing else reaches this line. Kept as defensive depth
    // and ordered before the existence check, but the body-supplied point is
    // really guarded by `@Auth(UserRole.NetworkOwner)` plus the 404 below.
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

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { CrateIssuanceMode } from './crate-issuance-mode.enum';
import { CrateTranche } from './crate-allocation';
import { CrateIssuance } from './crate-issuance.entity';
import { CrateReturn } from './crate-return.entity';
import { CrateReturnAllocation } from './crate-return-allocation.entity';
import { CrateIssuanceResponse, toCrateIssuanceResponse } from './crate-issuance.mapper';
import { CrateReturnResponse, CrateReturnIssuanceInfo, toCrateReturnResponse } from './crate-return.mapper';
import { ListCrateIssuancesQueryDto } from './dto/list-crate-issuances.query';
import { ListCrateReturnsQueryDto } from './dto/list-crate-returns.query';
import { Shift } from '../shifts/shift.entity';
import { Paginated } from '../common/dto/paginated';
import { skipOf } from '../common/dto/pagination-query.dto';
import { resolvePointFilter } from '../auth/access/point-scope';
import { mul, sum } from '../common/money';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

export interface CrateTrancheView extends CrateTranche {
  code: string;
  issued_at: string;
}

export interface CrateBalanceResponse {
  supplier_id: string;
  outstanding_units: number;
  deposit_held: string;
  tranches: CrateTrancheView[];
}

/**
 * THE CRATES BOOK, IN SQL, IN ONE PLACE. Both the balance below and
 * `point-cash`'s crates figure read this file rather than re-deriving the
 * `voided_at IS NULL` filters that make it correct — the same discipline
 * `supplier-balance` holds for the berry debt.
 *
 * POINT-LIFETIME, NO DATE FLOOR. §7.5: «завдаток, узятий у липні, лежить у
 * шухляді в серпні», «від першої видачі». This is a DIFFERENT SHAPE from the
 * berry book, which is anchored on the last physical count and bounded by
 * `as_of`, and the two must not be made to share SQL.
 *
 * IT IS A FUNCTION OF A POINT EXPRESSION, NOT A FIXED `$1` FRAGMENT — the
 * ONE definition either caller needs. `pointDepositBook` below calls
 * `crateBookSql('$1')`, immediately followed by `[pointId]` as the actual
 * bound parameter; `point-cash.service.ts`'s list CTE calls
 * `crateBookSql('cp.id')` so the list screen can compute this figure once per
 * row inside its own CTE instead of running a query per row, correlated
 * against a column rather than a shared bind. Earlier this was a `$1`-only
 * string constant that the list caller rewrote by TEXT SUBSTITUTION — real
 * SQL parameterisation now, not a regex trusting the constant's current
 * shape.
 */
export const crateBookSql = (pointExpr: string): string => `(
    COALESCE((SELECT SUM(ci.deposit_taken)
         FROM crate_issuances ci
         JOIN shifts cs ON cs.id = ci.shift_id
        WHERE cs.collection_point_id = ${pointExpr}
          AND ci.voided_at IS NULL), 0.00)
  - COALESCE((SELECT SUM(cr.deposit_refund)
         FROM crate_returns cr
         JOIN shifts rs ON rs.id = cr.shift_id
        WHERE rs.collection_point_id = ${pointExpr}
          AND cr.voided_at IS NULL), 0.00)
)`;

/**
 * CRATES ON RECEIPTS — the ONE place that knows `is_crate` selects the crate
 * tare. §6.8's «з ягодою» for one shift (`CrateDispatchService`) reads it, and
 * so does `CrateStandingService`'s revised standing (§8.1–§8.2) — TWICE: once
 * unfiltered, over every live receipt at the point (`all_receipt_crates`,
 * since full crates are always ours and every receipt's tare leaves the
 * empties), and once filtered to the point's OPEN shift (`with_berry`, «у нас
 * з ягодою» — closed shifts already moved that tare to the base). Neither
 * caller re-derives the filter, so the three cannot drift. `where` is a
 * predicate over `i` (intakes) and `sh` (the intake's shift) — an SQL naming,
 * never a request value.
 */
export const crateTareUnitsSql = (where: string): string => `(
    SELECT COALESCE(SUM(itt.units), 0)::int
      FROM intake_item_tare_types itt
      JOIN intake_items ii ON ii.id = itt.item_id
      JOIN intakes i       ON i.id = ii.intake_id
      JOIN shifts sh       ON sh.id = i.shift_id
      JOIN tare_types tt   ON tt.id = itt.tare_type_id
     WHERE ${where}
       AND i.voided_at IS NULL
       AND tt.is_crate
)`;

/**
 * OPEN TRANCHES — the ONE definition both `/crate-balances`'s aggregate and
 * `CrateStandingService`'s point total read, so a tranche open in one cannot
 * silently read closed in the other. `remaining_units` is DERIVED, never
 * stored (§3.2): units issued minus units allocated to non-voided returns.
 * Filtered to `remaining_units > 0` HERE — a fully-returned tranche is not
 * open — so neither caller repeats that filter or risks forgetting it.
 *
 * `where` is a predicate over `ci` (crate_issuances) and `s` (the issuance's
 * shift) — an SQL naming, never a request value — ANDed with
 * `ci.voided_at IS NULL`; pass `'TRUE'` for "every issuance network-wide".
 * Returns a PARENTHESISED SELECT, so a caller writes it straight after
 * `AS`/`WITH x AS` — see either caller below.
 */
export const openTranchesSql = (where: string): string => `(
    SELECT * FROM (
      SELECT ci.id,
             ci.supplier_id,
             ci.mode,
             ci.deposit_per_unit,
             s.collection_point_id,
             (ci.units - COALESCE((
                 SELECT SUM(a.units)
                   FROM crate_return_allocations a
                   JOIN crate_returns cr ON cr.id = a.return_id
                  WHERE a.issuance_id = ci.id
                    AND cr.voided_at IS NULL), 0))::int AS remaining_units
        FROM crate_issuances ci
        JOIN shifts s ON s.id = ci.shift_id
       WHERE ci.voided_at IS NULL
         AND ${where}
    ) t
   WHERE t.remaining_units > 0
)`;

/**
 * A TRANSFER IS HOW EMPTY CRATES ARRIVE AT THE POINT (spec §8.1) — the same
 * three-way reading `point-cash`'s `movementsSql` gives the cash on the same
 * rows (09.09.2026 client ruling): accepted → `crates`; disputed and resolved
 * → `resolved_crates`; disputed and open → the point's own `reported_crates`.
 * `sent` moves nothing. The void filter sits in the OUTER `WHERE` so a
 * resolved-then-voided transfer counts for nothing — voided wins.
 */
export const transferCratesSql = (pointExpr: string): string => `(
    SELECT COALESCE(SUM(CASE
             WHEN t.status = 'accepted' THEN t.crates
             WHEN t.status = 'disputed' AND t.resolved_at IS NOT NULL THEN t.resolved_crates
             WHEN t.status = 'disputed' THEN t.reported_crates
           END), 0)::int
      FROM transfers t
     WHERE t.collection_point_id = ${pointExpr}
       AND t.voided_at IS NULL
)`;

/**
 * THE SAME BOOK, IN CRATES RATHER THAN GRYVNIAS — R8's card, «завдатків за N
 * ящиків». `point-cash` shows this NEXT TO `crateBookSql`'s money figure, not
 * derived from it: a receipt issuance's units are never in `crateBookSql`
 * either (its rows carry `deposit_taken = 0` by
 * `CHK_crate_issuances_receipt_no_money`), but this counter states that
 * exclusion directly, with an explicit `ci.mode = 'deposit'`, rather than
 * leaning on a CHECK constraint a reader of this file would otherwise have to
 * already know about.
 *
 * SAME TWO-TERM SHAPE, SAME POINT-EXPRESSION CONTRACT AS `crateBookSql`: the
 * first term sums every live deposit-mode issuance's `units` at the point,
 * the second sums the `crate_return_allocations.units` that have since come
 * back against one of THOSE issuances — `a.units`, not `cr.units`, because a
 * return's own `units` can span both modes (§4.1 of the crates slice) and
 * only the allocation rows say which issuance, and therefore which mode,
 * each returned unit came off. `pointExpr` is spliced in unparameterised for
 * the identical reason `crateBookSql` splices it: it is a SQL NAMING the
 * caller controls (a bind placeholder or a correlated column), never a value
 * from a request.
 *
 * NOT `tranchesFor`'s `remaining_units`: that method already answers "how
 * many crates does THIS SUPPLIER still owe", per open tranche, receipt
 * tranches included. This answers "how many DEPOSIT-COVERED crates are out
 * across THE WHOLE POINT", which is a different aggregate over a different
 * filter — recomputing it from tranches would mean summing every supplier's
 * open tranches and then subtracting the receipt-mode ones back out, the
 * exact kind of re-derivation this file exists to avoid.
 *
 * `::int` WRAPS THE WHOLE EXPRESSION, NOT EITHER `SUM`. Postgres promotes
 * `SUM(int4)` to `bigint`, which the driver returns as a STRING (bigint can
 * exceed `Number.MAX_SAFE_INTEGER`, which no realistic crate count ever
 * will) — the outer cast back to `int4` is what hands `point-cash` back a
 * genuine JS `number` at the query boundary, so the units never cross into
 * TypeScript as a string that would need parsing there. Foundation §5.1 bans
 * exactly that conversion in this file's directory; casting in SQL is the
 * side of the line this belongs on, and it is why `point-cash.service.ts`
 * never calls `Number()`/`parseInt` on this column.
 *
 * ONE ASYMMETRY WITH `crateBookSql`, NOTED RATHER THAN FIXED: the SUBTRACTION
 * term here scopes by `ci.mode = 'deposit' AND cs.collection_point_id =
 * ${pointExpr}` — the ISSUANCE's point, reached through `ci`'s own shift —
 * while `crateBookSql`'s refund term scopes by the RETURN's point, through
 * `rs`/`cr.shift_id`. The two happen to agree today because a supplier's
 * `collection_point_id` is immutable (§3.9 — `update-supplier.dto.ts` carries
 * no such field) and a return only ever allocates against ITS OWN supplier's
 * issuances (`crate-allocation.ts`), so an issuance and every return drawn
 * against it are always the same point. This form — scoping by the
 * issuance's point on both terms — is the more ROBUST of the two, because it
 * stays correct even if a return's own shift could someday sit at a
 * different point than the issuance it draws down. A future supplier-transfer
 * feature (a supplier reassigned to another point mid-tranche) would have to
 * revisit BOTH functions, not just this one.
 */
export const crateUnitsSql = (pointExpr: string): string => `(
    COALESCE((SELECT SUM(ci.units)
         FROM crate_issuances ci
         JOIN shifts cs ON cs.id = ci.shift_id
        WHERE cs.collection_point_id = ${pointExpr}
          AND ci.mode = 'deposit'
          AND ci.voided_at IS NULL), 0)
  - COALESCE((SELECT SUM(a.units)
         FROM crate_return_allocations a
         JOIN crate_issuances ci ON ci.id = a.issuance_id
         JOIN crate_returns cr ON cr.id = a.return_id
         JOIN shifts cs ON cs.id = ci.shift_id
        WHERE cs.collection_point_id = ${pointExpr}
          AND ci.mode = 'deposit'
          AND ci.voided_at IS NULL
          AND cr.voided_at IS NULL), 0)
)::int`;

@Injectable()
export class CrateBalanceService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(CrateIssuance)
    private readonly issuances: Repository<CrateIssuance>,
    @InjectRepository(CrateReturn)
    private readonly returns: Repository<CrateReturn>,
    @InjectRepository(CrateReturnAllocation)
    private readonly allocations: Repository<CrateReturnAllocation>,
  ) {}

  /**
   * Open tranches, OLDEST FIRST, with `created_at` then `id` as the order —
   * the `intakes` tiebreaker, because two documents in one millisecond are
   * ordinary rather than exceptional.
   *
   * `remaining` is DERIVED, never stored (§3.2). A voided return releases its
   * allocations here, by the `cr.voided_at IS NULL` filter on the join, and no
   * allocation row is ever deleted.
   */
  async tranchesFor(supplierId: string, manager?: EntityManager): Promise<CrateTrancheView[]> {
    const runner = manager ?? this.dataSource.manager;
    const rows: Array<{
      issuance_id: string;
      code: string;
      per_unit: string;
      mode: CrateIssuanceMode;
      issued_at: Date;
      remaining_units: string | number;
    }> = await runner.query(
      `SELECT ci.id            AS issuance_id,
              ci.code          AS code,
              ci.deposit_per_unit AS per_unit,
              ci.mode          AS mode,
              ci.created_at    AS issued_at,
              (ci.units - COALESCE((
                  SELECT SUM(a.units)
                    FROM crate_return_allocations a
                    JOIN crate_returns cr ON cr.id = a.return_id
                   WHERE a.issuance_id = ci.id
                     AND cr.voided_at IS NULL), 0))::int AS remaining_units
         FROM crate_issuances ci
        WHERE ci.supplier_id = $1
          AND ci.voided_at IS NULL
        ORDER BY ci.created_at ASC, ci.id ASC`,
      [supplierId],
    );

    return rows
      .map((row) => ({
        issuance_id: row.issuance_id,
        code: row.code,
        per_unit: row.per_unit,
        mode: row.mode,
        issued_at: new Date(row.issued_at).toISOString(),
        // A row COUNT, not money — see this file's eslint guard note below.
        remaining_units: Number.parseInt(String(row.remaining_units), 10),
      }))
      .filter((tranche) => tranche.remaining_units > 0);
  }

  /** §6.3's header — «у цієї людини вже на руках 20 ящ., завдатку за них 2 400 ₴». */
  async balanceFor(supplierId: string, manager?: EntityManager): Promise<CrateBalanceResponse> {
    const tranches = await this.tranchesFor(supplierId, manager);
    const held = tranches.map((t) => mul(t.per_unit, String(t.remaining_units)));

    return {
      supplier_id: supplierId,
      outstanding_units: tranches.reduce((total, t) => total + t.remaining_units, 0),
      deposit_held: held.length ? sum(held) : '0.00',
      tranches,
    };
  }

  /** The point's crates drawer (spec §4.3). One number, no `as_of`. */
  async pointDepositBook(pointId: string, manager?: EntityManager): Promise<string> {
    const runner = manager ?? this.dataSource.manager;
    const rows: Array<{ book: string }> = await runner.query(
      `SELECT ${crateBookSql('$1')} AS book`,
      [pointId],
    );
    return rows[0]?.book ?? '0.00';
  }

  /**
   * The journal (unfiltered `voided`), ticket #58's supplier-receipts view
   * (`supplier_id` + `mode`), and the owner's voided-deposit incident list
   * (`voided: true` + `mode: deposit`) — three consumers, one query shape,
   * the same JOIN-on-`shifts` `PayoutsService.list` uses because neither
   * `crate_issuances` nor `crate_returns` stores a point or a business date.
   */
  async listIssuances(
    actor: AuthenticatedUser,
    query: ListCrateIssuancesQueryDto,
  ): Promise<Paginated<CrateIssuanceResponse>> {
    const pointId = resolvePointFilter(actor, query.collection_point_id);

    const qb = this.issuances
      .createQueryBuilder('i')
      .innerJoinAndMapOne('i.shift', Shift, 's', 's.id = i.shift_id');

    if (pointId) qb.andWhere('s.collection_point_id = :pointId', { pointId });
    if (query.supplier_id) qb.andWhere('i.supplier_id = :supplierId', { supplierId: query.supplier_id });
    if (query.mode) qb.andWhere('i.mode = :mode', { mode: query.mode });
    if (query.voided === true) qb.andWhere('i.voided_at IS NOT NULL');
    else if (!query.include_voided) qb.andWhere('i.voided_at IS NULL');

    const [data, total] = await qb
      .orderBy('i.created_at', 'DESC')
      .addOrderBy('i.id', 'ASC')
      .skip(skipOf(query))
      .take(query.limit)
      .getManyAndCount();

    // ONE query for the page, never one per row.
    const ids = data.map((issuance) => issuance.id);
    const liveRows: Array<{ issuance_id: string }> = ids.length
      ? await this.dataSource.query(
          `SELECT DISTINCT a.issuance_id
             FROM crate_return_allocations a
             JOIN crate_returns cr ON cr.id = a.return_id
            WHERE a.issuance_id = ANY($1)
              AND cr.voided_at IS NULL`,
          [ids],
        )
      : [];
    const live = new Set(liveRows.map((row) => row.issuance_id));

    return {
      data: data.map((issuance) =>
        toCrateIssuanceResponse(issuance, issuance.shift as Shift, live.has(issuance.id)),
      ),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  /**
   * Same shape as `listIssuances`, minus `mode` (a return can consume
   * tranches from both).
   *
   * NOT AN N+1: the allocations for the WHOLE PAGE come from one `find`
   * keyed by the page's return ids, and the issuance info those allocations
   * need (`mode`, `code`) from one more query keyed by their distinct
   * issuance ids — never a query per row. See `crate-balance.service.spec.ts`.
   */
  async listReturns(
    actor: AuthenticatedUser,
    query: ListCrateReturnsQueryDto,
  ): Promise<Paginated<CrateReturnResponse>> {
    const pointId = resolvePointFilter(actor, query.collection_point_id);

    const qb = this.returns
      .createQueryBuilder('r')
      .innerJoinAndMapOne('r.shift', Shift, 's', 's.id = r.shift_id');

    if (pointId) qb.andWhere('s.collection_point_id = :pointId', { pointId });
    if (query.supplier_id) qb.andWhere('r.supplier_id = :supplierId', { supplierId: query.supplier_id });
    if (query.voided === true) qb.andWhere('r.voided_at IS NOT NULL');
    else if (!query.include_voided) qb.andWhere('r.voided_at IS NULL');

    const [data, total] = await qb
      .orderBy('r.created_at', 'DESC')
      .addOrderBy('r.id', 'ASC')
      .skip(skipOf(query))
      .take(query.limit)
      .getManyAndCount();

    if (data.length === 0) {
      return { data: [], total, page: query.page, limit: query.limit };
    }

    const returnIds = data.map((ret) => ret.id);
    const allocationRows = await this.allocations.find({
      where: { return_id: In(returnIds) },
    });

    const issuanceIds = [...new Set(allocationRows.map((row) => row.issuance_id))];
    const issuanceInfo: CrateReturnIssuanceInfo[] =
      issuanceIds.length === 0
        ? []
        : await this.dataSource.manager.query(
            `SELECT id AS issuance_id, mode, code FROM crate_issuances WHERE id = ANY($1)`,
            [issuanceIds],
          );

    const allocationsByReturn = new Map<string, typeof allocationRows>();
    for (const row of allocationRows) {
      const existing = allocationsByReturn.get(row.return_id);
      if (existing) existing.push(row);
      else allocationsByReturn.set(row.return_id, [row]);
    }

    // The codes for the WHOLE PAGE in ONE query, keyed by the returns'
    // distinct `intake_id`s — never one query per row. Most pages carry no
    // linked return at all, hence the length guard.
    const intakeIds = [
      ...new Set(data.map((ret) => ret.intake_id).filter((id): id is string => typeof id === 'string')),
    ];
    const intakeCodeById = new Map<string, string>();
    if (intakeIds.length > 0) {
      const intakeRows: Array<{ id: string; code: string }> = await this.dataSource.manager.query(
        `SELECT id, code FROM intakes WHERE id = ANY($1)`,
        [intakeIds],
      );
      for (const row of intakeRows) intakeCodeById.set(row.id, row.code);
    }

    return {
      data: data.map((ret) =>
        toCrateReturnResponse(
          ret,
          ret.shift as Shift,
          allocationsByReturn.get(ret.id) ?? [],
          issuanceInfo,
          ret.intake_id ? intakeCodeById.get(ret.intake_id) ?? null : null,
        ),
      ),
      total,
      page: query.page,
      limit: query.limit,
    };
  }
}

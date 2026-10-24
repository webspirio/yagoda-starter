import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { ShiftsService } from '../shifts/shifts.service';
import { ReweighItem } from './reweigh-item.entity';
import { toReweighItemResponse, ReweighItemResponse } from './reweigh-item.mapper';
import { add, div, gt, mul, sub, sum, isZero } from '../common/money';
// From `top-up-allocation.ts` itself, NEVER via `product-cost-rows.ts`: that
// file imports this one, and going through it would close an import cycle.
import { topUpsByGradeForShift } from '../day-costs/top-up-allocation';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

export interface GradeTotalsRow {
  product_id: string;
  product_name: string;
  product_grade_id: string;
  product_grade_name: string;
  intake_net_kg: string;
  intake_amount: string;
  /** NULL — not '0.00' — when nothing was weighed for this grade. §8.6: «Це не нуль». */
  reweigh_net_kg: string | null;
}

/**
 * ONE ROW PER GRADE THAT THE SHIFT ACCEPTED. Never the catalogue (spec §3.15).
 *
 * Exported as a module-level function, not a private method on the service,
 * because a later task (cost-of-day, §8's PR-B) imports and reuses this exact
 * query rather than reimplementing it — see the task-5 brief's «Interfaces».
 *
 * `intake_amount` here is the INTAKE SIDE ONLY. Each reader adds the shift's
 * доплати on top of it from `topUpsByGradeForShift` — the reconciliation and
 * cost-of-day both price a shortfall at the accrued average WITH доплати (spec
 * §3.12; 2026-10-23 review §0: the two screens printed 229,99 and 265,19 ₴ for
 * the same 1,40 кг while they added them differently).
 *
 * The reweigh side is a PRE-AGGREGATED subquery, joined with `LEFT JOIN`, so a
 * grade with no lines survives as `NULL` rather than as `0` — the caller keys
 * the `not_reweighed` state off that `NULL`, and `COALESCE`ing it away here
 * would erase the one signal that distinguishes «не перезважено» from a real
 * zero.
 */
export async function gradeTotals(
  runner: DataSource | EntityManager,
  shiftId: string,
): Promise<GradeTotalsRow[]> {
  return runner.query(
    `SELECT p.id           AS product_id,
            p.name         AS product_name,
            pg.id          AS product_grade_id,
            pg.name        AS product_grade_name,
            SUM(ii.net_kg)::text  AS intake_net_kg,
            SUM(ii.amount)::text  AS intake_amount,
            rw.net_kg::text       AS reweigh_net_kg
       FROM intake_items ii
       JOIN intakes i        ON i.id = ii.intake_id AND i.voided_at IS NULL
       JOIN product_grades pg ON pg.id = ii.product_grade_id
       JOIN products p        ON p.id = pg.product_id
       LEFT JOIN (
            SELECT ri.product_grade_id, SUM(ri.net_kg) AS net_kg
              FROM reweigh_items ri
              JOIN reweighs r ON r.id = ri.reweigh_id
             WHERE r.shift_id = $1 AND ri.voided_at IS NULL
             GROUP BY ri.product_grade_id
       ) rw ON rw.product_grade_id = pg.id
      WHERE i.shift_id = $1
      GROUP BY p.id, p.name, pg.id, pg.name, rw.net_kg
      -- p.name stays leading so products[]' own order is unchanged; pg.name
      -- (not pg.id) orders grades WITHIN a product, because grades[] exists
      -- to fill a human's picker, and ordering by uuid is arbitrary to one.
      ORDER BY p.name, pg.name`,
    [shiftId],
  ) as Promise<GradeTotalsRow[]>;
}

/**
 * §3.15's PARTIAL-WEIGHING RULE, in one place.
 *
 * A product weighed in one grade but not another is «не перезважено» at the
 * PRODUCT level, «because the shortfall on the unweighed grade would
 * otherwise read as real». Both readers of `gradeTotals` need this — the
 * reconciliation screen to pick the state, `productCostRows` to keep an
 * unconfirmed shortfall out of the day's basket and out of §8.6's network
 * average — and two hand-written copies of `every(...)` is exactly how the
 * two screens drifted apart in the first place.
 */
export function weighedInFull(grades: Pick<GradeTotalsRow, 'reweigh_net_kg'>[]): boolean {
  return grades.every((g) => g.reweigh_net_kg !== null);
}

/**
 * НЕДОСТАЧА BELONGS TO THE PRODUCT, NOT TO A GRADE (client call 23.10.2026).
 *
 * The point's grades are its price tiers; the base weighs the berry, not the tiers, and may
 * put a crate onto another grade. Compared grade by grade, 596,8 кг against 595,4 кг read as
 * 106,3 кг missing (one grade's surplus clamped away) and 1 124 ₴ (each grade at its own
 * rate). So the kilograms are the product's — Σ point minus Σ base — and they are priced at
 * the product's average rate, `accrued ÷ point kilograms`. Signed: a surplus comes back
 * negative, and clamping it is the caller's call. Both readers of `gradeTotals` price the
 * shortfall here, so the reweigh screen and собівартість дня cannot disagree again.
 */
export function productShortfall(
  intakeNetKg: string,
  reweighNetKg: string,
  accrued: string,
): { kg: string; amount: string } {
  const kg = sub(intakeNetKg, reweighNetKg);
  if (isZero(intakeNetKg)) return { kg, amount: '0.00' };
  return { kg, amount: mul(kg, div(accrued, intakeNetKg)) };
}

/**
 * Tare UNITS — counted, never inferred from kilograms — at the point
 * (`intake_item_tare_types` of the shift's live receipts) and at the base
 * (`reweigh_item_tare_types` of its live reweigh lines). Totals across tare
 * types; `by_type` keeps the types apart, because the client counts a Чешка
 * and a Лубянка separately (receipt request §1). Client MUST, 23.10 47:55.
 */
interface ReconciliationCrates {
  point: number;
  base: number;
  by_type: { tare_type_id: string; tare_type_name: string; point: number; base: number }[];
}

export interface ReconciliationGrade {
  product_grade_id: string;
  product_grade_name: string;
  product_id: string;
  product_name: string;
  intake_net_kg: string;
  reweigh_net_kg: string;
  crates: ReconciliationCrates;
}

export interface ReconciliationProduct {
  product_id: string;
  product_name: string;
  intake_net_kg: string;
  reweigh_net_kg: string;
  state: 'weighed' | 'not_reweighed';
  missing_kg: string | null;
  missing_amount: string | null;
  /**
   * ₴/кг the shortfall is priced at: accrued INCLUDING доплати ÷ the point's
   * kilograms — the very `div` `productShortfall` multiplies by, so
   * `missing_kg × rate = missing_amount` re-checks on a hand calculator.
   * `null` when the point's kilograms are zero (nothing to divide by).
   */
  rate: string | null;
  /**
   * `rate`'s numerator — the product's нараховано INCLUDING доплати — and the
   * доплати inside it ('0.00' when none), so the screen can print the rate as
   * the division it is: «113 044,20 ÷ 596,80 = 189,42» (audit 2026-10-24 E5).
   */
  accrued: string;
  top_ups: string;
  crates: ReconciliationCrates;
}

export interface ReconciliationResponse {
  shift_id: string;
  closed_at: string | null;
  accepted_anything: boolean;
  /**
   * §5.3 — THE NON-VOIDED LINES, NEWEST FIRST.
   *
   * Functional, not decorative: `POST /reweigh-items/:id/void` is addressed
   * by LINE id, and the only other place a line id is ever returned is the
   * response to the POST that created it. Without this list §8.7's storno is
   * unreachable from a fresh page load — the owner can see a 10 кг недостача
   * and have no way to name the mis-weighed pallet behind it.
   */
  items: ReweighItemResponse[];
  products: ReconciliationProduct[];
  /**
   * ONE ROW PER GRADE THE SHIFT ACCEPTED — the picker on §8.1's screen.
   *
   * The API refuses a grade this shift did not accept (`GRADE_NOT_ACCEPTED`),
   * so the picker has to promise exactly that set, from exactly this query:
   * a list assembled anywhere else drifts from the refusal it is meant to
   * prevent. `gradeTotals` already computes these rows and the product rollup
   * below used to discard the grade identity; this keeps it.
   *
   * `reweigh_net_kg` is '0.00', never null: «не перезважено» is a PRODUCT
   * state (§3.15) and it lives on `products[]`. A second, weaker copy of that
   * rule at grade level is how the two screens drift apart.
   */
  grades: ReconciliationGrade[];
  /**
   * The day's недостача — Σ of the POSITIVE per-product shortfalls only: a
   * surplus on one berry never offsets a shortfall on another (the same clamp
   * cost-of-day applies). `null` while nothing is priced (open shift, every
   * product «не перезважено», nothing accepted) — «—», never a zero.
   */
  missing_total_kg: string | null;
  missing_total_amount: string | null;
}

interface TareUnitsRow {
  product_grade_id: string;
  tare_type_id: string;
  tare_type_name: string;
  point_units: number;
  base_units: number;
}

/**
 * Tare units per (grade, tare type), point side and base side, LIVE documents
 * only. Two PRE-AGGREGATED subqueries joined FULL OUTER: joining the unit rows
 * straight into `gradeTotals` would multiply its `SUM(net_kg)` by the number of
 * tare types on a line — and it stays out of `gradeTotals` so cost-of-day's
 * reader is untouched. `::int` so the driver hands back JS numbers, not
 * bigint strings.
 */
async function tareUnitsByGrade(
  runner: DataSource | EntityManager,
  shiftId: string,
): Promise<TareUnitsRow[]> {
  return runner.query(
    `SELECT COALESCE(pt.product_grade_id, bs.product_grade_id) AS product_grade_id,
            tt.id                        AS tare_type_id,
            tt.name                      AS tare_type_name,
            COALESCE(pt.units, 0)::int   AS point_units,
            COALESCE(bs.units, 0)::int   AS base_units
       FROM (
            SELECT ii.product_grade_id, iit.tare_type_id, SUM(iit.units) AS units
              FROM intake_item_tare_types iit
              JOIN intake_items ii ON ii.id = iit.item_id
              JOIN intakes i       ON i.id = ii.intake_id AND i.voided_at IS NULL
             WHERE i.shift_id = $1
             GROUP BY ii.product_grade_id, iit.tare_type_id
       ) pt
       FULL OUTER JOIN (
            SELECT ri.product_grade_id, rit.tare_type_id, SUM(rit.units) AS units
              FROM reweigh_item_tare_types rit
              JOIN reweigh_items ri ON ri.id = rit.item_id AND ri.voided_at IS NULL
              JOIN reweighs r       ON r.id = ri.reweigh_id
             WHERE r.shift_id = $1
             GROUP BY ri.product_grade_id, rit.tare_type_id
       ) bs ON bs.product_grade_id = pt.product_grade_id AND bs.tare_type_id = pt.tare_type_id
       JOIN tare_types tt ON tt.id = COALESCE(pt.tare_type_id, bs.tare_type_id)
      ORDER BY tt.name`,
    [shiftId],
  ) as Promise<TareUnitsRow[]>;
}

/** Sum per-type crate counts (one grade's, or several grades') into totals,
 *  keeping tare types apart. Integer `+` on unit COUNTS — not money, and never
 *  a kilogram. */
function mergeCrates(types: ReconciliationCrates['by_type']): ReconciliationCrates {
  const byType = new Map<string, ReconciliationCrates['by_type'][number]>();
  for (const t of types) {
    const into = byType.get(t.tare_type_id) ?? { ...t, point: 0, base: 0 };
    into.point += t.point;
    into.base += t.base;
    byType.set(t.tare_type_id, into);
  }
  const by_type = [...byType.values()].sort((a, b) => a.tare_type_name.localeCompare(b.tare_type_name));
  return {
    point: by_type.reduce((n, t) => n + t.point, 0),
    base: by_type.reduce((n, t) => n + t.base, 0),
    by_type,
  };
}

/**
 * §8.2's reconciliation read — the point's numbers next to the base's, with
 * the недостача the base owes nobody an apology for, because it is priced at
 * what was actually paid rather than at the day's list price (§3.6).
 *
 * THREE STATES THAT NEVER COLLAPSE INTO EACH OTHER: a real shortfall (signed,
 * possibly negative — a надлишок is surfaced per product, not clamped or
 * hidden; only the day's `missing_total_*` clamp, exactly as cost-of-day), «не
 * перезважено» (a product with any unweighed grade — the shortfall on that
 * grade would otherwise read as real), and «the shift is still open» (the
 * claim waits — §3.9). All three render as a dash on screen; only the first
 * is ever a number, and this service is the seam that keeps that true.
 */
@Injectable()
export class ReweighReconciliationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly shifts: ShiftsService,
  ) {}

  async forShift(
    _actor: AuthenticatedUser,
    shiftId: string,
    includeVoided = false,
  ): Promise<ReconciliationResponse> {
    const shift = await this.shifts.findOneRaw(shiftId);
    if (!shift) throw new NotFoundException('Shift not found');

    const rows = await gradeTotals(this.dataSource, shiftId);
    const open = shift.closed_at === null;
    // Spec §0 (2026-10-23): the ONE reader of a shift's доплати per grade —
    // the same one cost-of-day calls, so both screens price a shortfall alike.
    const topUps = rows.length
      ? await topUpsByGradeForShift(this.dataSource, shiftId)
      : new Map<string, string>();
    const tareRows = rows.length ? await tareUnitsByGrade(this.dataSource, shiftId) : [];
    const cratesByGrade = new Map<string, ReconciliationCrates>();
    for (const r of rows) {
      cratesByGrade.set(
        r.product_grade_id,
        mergeCrates(
          tareRows
            .filter((t) => t.product_grade_id === r.product_grade_id)
            .map((t) => ({
              tare_type_id: t.tare_type_id,
              tare_type_name: t.tare_type_name,
              point: t.point_units,
              base: t.base_units,
            })),
        ),
      );
    }
    const cratesOf = (gradeId: string): ReconciliationCrates =>
      cratesByGrade.get(gradeId) ?? { point: 0, base: 0, by_type: [] };

    // The RELATIONS the mapper reads are loaded here on purpose: without
    // them `product_name`, `product_grade_name` and every `tare_type_name`
    // come back `undefined`, which is a silently half-empty screen rather
    // than an error. `created_at` DESC is §5.3's «newest first»;
    // `item_order` breaks the tie for two lines saved in the same
    // transaction, which `created_at` alone cannot.
    //
    // §8.7's storno leaves the row: «документ НЕ зникає». Filtering voided
    // lines out of `items[]` made that promise false on screen — the line
    // the owner had just voided vanished on the next refetch, taking its
    // reason and its author with it. The flag governs THIS LIST ONLY:
    // `products[]` comes from `gradeTotals`, whose own SQL filters
    // `ri.voided_at IS NULL`, so a voided line can never be counted
    // whatever is passed here.
    const items = await this.dataSource.getRepository(ReweighItem).find({
      where: includeVoided
        ? { reweigh: { shift_id: shiftId } }
        : { reweigh: { shift_id: shiftId }, voided_at: IsNull() },
      relations: { product_grade: { product: true }, tare: { tare_type: true } },
      order: { created_at: 'DESC', item_order: 'DESC' },
    });

    const grades: ReconciliationGrade[] = rows.map((r) => ({
      product_grade_id: r.product_grade_id,
      product_grade_name: r.product_grade_name,
      product_id: r.product_id,
      product_name: r.product_name,
      intake_net_kg: r.intake_net_kg,
      reweigh_net_kg: r.reweigh_net_kg ?? '0.00',
      crates: cratesOf(r.product_grade_id),
    }));

    const byProduct = new Map<string, GradeTotalsRow[]>();
    for (const row of rows) {
      const list = byProduct.get(row.product_id) ?? [];
      list.push(row);
      byProduct.set(row.product_id, list);
    }

    const products: ReconciliationProduct[] = [];
    for (const [productId, productGrades] of byProduct) {
      const intakeNet = sum(productGrades.map((g) => g.intake_net_kg));
      const reweighNet = sum(productGrades.map((g) => g.reweigh_net_kg ?? '0.00'));
      // Accrued INCLUDING доплати (spec §3.12, review §0) — 265,19 ₴, not 229,99.
      const productTopUps = sum(productGrades.map((g) => topUps.get(g.product_grade_id) ?? '0.00'));
      const accrued = add(sum(productGrades.map((g) => g.intake_amount)), productTopUps);
      const rate = isZero(intakeNet) ? null : div(accrued, intakeNet);
      const crates = mergeCrates(productGrades.flatMap((g) => cratesOf(g.product_grade_id).by_type));

      // §3.15 — one unweighed grade makes the whole product «не перезважено»,
      // because the shortfall on that grade would otherwise read as real.
      const complete = weighedInFull(productGrades);

      if (!complete || open) {
        products.push({
          product_id: productId,
          product_name: productGrades[0].product_name,
          intake_net_kg: intakeNet,
          reweigh_net_kg: reweighNet,
          state: complete ? 'weighed' : 'not_reweighed',
          missing_kg: null,
          missing_amount: null,
          rate,
          accrued,
          top_ups: productTopUps,
          crates,
        });
        continue;
      }

      // Per PRODUCT, at the product's average actually accrued — bonuses and доплати
      // included, because both are paid — `productShortfall`.
      const missing = productShortfall(intakeNet, reweighNet, accrued);

      products.push({
        product_id: productId,
        product_name: productGrades[0].product_name,
        intake_net_kg: intakeNet,
        reweigh_net_kg: reweighNet,
        state: 'weighed',
        missing_kg: missing.kg,
        missing_amount: missing.amount,
        rate,
        accrued,
        top_ups: productTopUps,
        crates,
      });
    }

    // THE CLAMP, per product: only a positive shortfall enters the day's total.
    const priced = products.filter((p) => p.missing_kg !== null);
    const short = priced.filter((p) => gt(p.missing_kg as string, '0.00'));
    const missing_total_kg = priced.length ? sum(short.map((p) => p.missing_kg as string)) : null;
    const missing_total_amount = priced.length
      ? sum(short.map((p) => p.missing_amount as string))
      : null;

    return {
      shift_id: shiftId,
      closed_at: shift.closed_at ? shift.closed_at.toISOString() : null,
      accepted_anything: rows.length > 0,
      items: items.map(toReweighItemResponse),
      products,
      grades,
      missing_total_kg,
      missing_total_amount,
    };
  }
}

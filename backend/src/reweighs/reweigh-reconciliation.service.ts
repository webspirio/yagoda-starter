import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { ShiftsService } from '../shifts/shifts.service';
import { ReweighItem } from './reweigh-item.entity';
import { toReweighItemResponse, ReweighItemResponse } from './reweigh-item.mapper';
import { div, mul, sub, sum, isZero } from '../common/money';
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
 * `intake_amount` here is the INTAKE SIDE ONLY. Top-ups are added on top of it
 * by the cost-of-day service, in a later task; the reconciliation screen is
 * about weights, and adding a доплата to it would change the недостача shown
 * on a dispute screen for a reason the operator cannot see.
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

export interface ReconciliationGrade {
  product_grade_id: string;
  product_grade_name: string;
  product_id: string;
  product_name: string;
  intake_net_kg: string;
  reweigh_net_kg: string;
}

export interface ReconciliationProduct {
  product_id: string;
  product_name: string;
  intake_net_kg: string;
  reweigh_net_kg: string;
  state: 'weighed' | 'not_reweighed';
  missing_kg: string | null;
  missing_amount: string | null;
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
}

/**
 * §8.2's reconciliation read — the point's numbers next to the base's, with
 * the недостача the base owes nobody an apology for, because it is priced at
 * what was actually paid rather than at the day's list price (§3.6).
 *
 * THREE STATES THAT NEVER COLLAPSE INTO EACH OTHER: a real shortfall (signed,
 * possibly negative — a надлишок is surfaced, not clamped or hidden, because
 * clamping happens later, elsewhere, when it enters the day's cost), «не
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
  ): Promise<ReconciliationResponse> {
    const shift = await this.shifts.findOneRaw(shiftId);
    if (!shift) throw new NotFoundException('Shift not found');

    const rows = await gradeTotals(this.dataSource, shiftId);
    const open = shift.closed_at === null;

    // The RELATIONS the mapper reads are loaded here on purpose: without
    // them `product_name`, `product_grade_name` and every `tare_type_name`
    // come back `undefined`, which is a silently half-empty screen rather
    // than an error. `created_at` DESC is §5.3's «newest first»;
    // `item_order` breaks the tie for two lines saved in the same
    // transaction, which `created_at` alone cannot.
    const items = await this.dataSource.getRepository(ReweighItem).find({
      where: { reweigh: { shift_id: shiftId }, voided_at: IsNull() },
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
    }));

    const byProduct = new Map<string, GradeTotalsRow[]>();
    for (const row of rows) {
      const list = byProduct.get(row.product_id) ?? [];
      list.push(row);
      byProduct.set(row.product_id, list);
    }

    const products: ReconciliationProduct[] = [];
    for (const [productId, grades] of byProduct) {
      const intakeNet = sum(grades.map((g) => g.intake_net_kg));
      const reweighNet = sum(grades.map((g) => g.reweigh_net_kg ?? '0.00'));

      // §3.15 — one unweighed grade makes the whole product «не перезважено»,
      // because the shortfall on that grade would otherwise read as real.
      const complete = weighedInFull(grades);

      if (!complete || open) {
        products.push({
          product_id: productId,
          product_name: grades[0].product_name,
          intake_net_kg: intakeNet,
          reweigh_net_kg: reweighNet,
          state: complete ? 'weighed' : 'not_reweighed',
          missing_kg: null,
          missing_amount: null,
        });
        continue;
      }

      // §3.6 — per GRADE, at the weighted average actually accrued (bonuses
      // included, because it is already paid), then summed for display.
      const amounts = grades.map((g) => {
        const missing = sub(g.intake_net_kg, g.reweigh_net_kg as string);
        if (isZero(g.intake_net_kg)) return '0.00';
        return mul(missing, div(g.intake_amount, g.intake_net_kg));
      });

      products.push({
        product_id: productId,
        product_name: grades[0].product_name,
        intake_net_kg: intakeNet,
        reweigh_net_kg: reweighNet,
        state: 'weighed',
        missing_kg: sub(intakeNet, reweighNet),
        missing_amount: sum(amounts),
      });
    }

    return {
      shift_id: shiftId,
      closed_at: shift.closed_at ? shift.closed_at.toISOString() : null,
      accepted_anything: rows.length > 0,
      items: items.map(toReweighItemResponse),
      products,
      grades,
    };
  }
}

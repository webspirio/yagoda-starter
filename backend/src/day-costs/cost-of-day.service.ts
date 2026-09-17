import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ShiftsService } from '../shifts/shifts.service';
import { gradeTotals, GradeTotalsRow } from '../reweighs/reweigh-reconciliation.service';
import { allocateTopUps, ReceiptForAllocation } from './top-up-allocation';
import { add, div, gt, isZero, mul, sub, sum } from '../common/money';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

export interface CostOfDayProduct {
  product_id: string;
  product_name: string;
  /** «було» — the price the day's intake actually paid, per kilogram taken in. */
  price_was: string;
  /** «собівартість» — `price_was` plus the day's per-kilogram basket share. `null` when nothing was weighed (§8.6). */
  price_cost: string | null;
  /** «нараховане ÷ НАША вага» — priced against the BASE's weight, not the receiver's. `null` when nothing was weighed. */
  price_by_our_weight: string | null;
}

export interface CostOfDayResponse {
  shift_id: string;
  /** Σ intake_items.amount + allocated top-ups, non-voided, over every grade the shift accepted. */
  accrued: string;
  reweighed_kg: string;
  /** Σ per-grade недостача, clamped so a surplus never contributes (§8.2/§8.4 — the discard is here, and only here). */
  shortfall_amount: string;
  expenses_amount: string;
  /** shortfall_amount + expenses_amount — СПІЛЬНИЙ КОШИК. */
  basket: string;
  /** basket ÷ reweighed_kg — the same figure added to every product's price. `null` when nothing was weighed. */
  per_kg: string | null;
  /** accrued + expenses_amount — the client's own звірка check. */
  total_check: string;
  /** §3.12 — a late top-up may still move a closed day; the screen marks that with this pair. */
  top_ups_included: true;
  top_ups_latest_at: string | null;
  products: CostOfDayProduct[];
}

interface ReceiptRow {
  intake_id: string;
  top_up_total: string;
  lines: { product_grade_id: string; amount: string }[];
}

interface GradeCost {
  product_id: string;
  product_name: string;
  accrued: string;
  intake_net_kg: string;
  reweigh_net_kg: string | null;
  shortfall: string;
}

/**
 * §8.4 «Собівартість кілограма» — where the whole slice converges. Everything
 * else in this branch (reweigh reconciliation, top-up allocation, day
 * expenses) is an input to exactly this one screen.
 */
@Injectable()
export class CostOfDayService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly shifts: ShiftsService,
  ) {}

  async forShift(_actor: AuthenticatedUser, shiftId: string): Promise<CostOfDayResponse> {
    const shift = await this.shifts.findOneRaw(shiftId);
    if (!shift) throw new NotFoundException('Shift not found');

    const grades = await gradeTotals(this.dataSource, shiftId);

    const expensesRows = (await this.dataSource.query(
      `SELECT COALESCE(SUM(amount)::text, '0.00') AS total FROM day_expenses WHERE shift_id = $1`,
      [shiftId],
    )) as { total: string }[];
    const expenses = expensesRows[0]?.total ?? '0.00';

    const receiptRows = (await this.dataSource.query(
      `SELECT i.id AS intake_id,
              COALESCE(tu.total, '0.00') AS top_up_total,
              COALESCE(
                (SELECT json_agg(json_build_object('product_grade_id', ii.product_grade_id, 'amount', ii.amount::text))
                   FROM intake_items ii WHERE ii.intake_id = i.id),
                '[]'::json
              ) AS lines
         FROM intakes i
         LEFT JOIN (
              SELECT intake_id, SUM(amount)::text AS total
                FROM intake_top_ups
               WHERE voided_at IS NULL
               GROUP BY intake_id
         ) tu ON tu.intake_id = i.id
        WHERE i.shift_id = $1 AND i.voided_at IS NULL`,
      [shiftId],
    )) as ReceiptRow[];

    // §3.12/§3.13 — dated to THIS shift's receipts, not to the top-up's own
    // creation day. `intake_top_ups`'s documented rule dates a top-up to the
    // day it was CREATED, for debt purposes: «how much do we owe RIGHT NOW».
    // Cost-of-day asks a different question — «what did THESE kilograms
    // cost» — and the kilograms were recorded on the receipt's own shift, so
    // a late top-up belongs to the day the berries were weighed in, not the
    // day someone renegotiated the price. This is a deliberate divergence
    // from that Note, not an oversight.
    const receipts: ReceiptForAllocation[] = receiptRows.map((r) => ({
      intake_id: r.intake_id,
      top_up_total: r.top_up_total,
      lines: r.lines,
    }));
    const topUpsByGrade = allocateTopUps(receipts);

    const latestRows = (await this.dataSource.query(
      `SELECT MAX(ti.created_at) AS latest
         FROM intake_top_ups ti
         JOIN intakes i ON i.id = ti.intake_id
        WHERE i.shift_id = $1 AND i.voided_at IS NULL AND ti.voided_at IS NULL`,
      [shiftId],
    )) as { latest: Date | string | null }[];
    const latest = latestRows[0]?.latest ?? null;
    const topUpsLatestAt = latest ? new Date(latest).toISOString() : null;

    const byProduct = new Map<string, GradeTotalsRow[]>();
    for (const row of grades) {
      const list = byProduct.get(row.product_id) ?? [];
      list.push(row);
      byProduct.set(row.product_id, list);
    }

    const gradeCosts: GradeCost[] = grades.map((g) => {
      const accrued = add(g.intake_amount, topUpsByGrade.get(g.product_grade_id) ?? '0.00');
      // §3.6 — per GRADE, never a product-level average of summed amounts.
      const price = div(accrued, g.intake_net_kg);
      const reweighNet = g.reweigh_net_kg;
      let shortfall = '0.00';
      if (reweighNet !== null) {
        const missing = sub(g.intake_net_kg, reweighNet);
        // THE CLAMP — the one place a surplus (missing < 0) is discarded
        // rather than shown. A surplus entering the basket would LOWER the
        // day's cost, which §8.2 calls impossible; the reconciliation screen
        // still shows the signed number, this is a different question.
        shortfall = gt(missing, '0.00') ? mul(missing, price) : '0.00';
      }
      return {
        product_id: g.product_id,
        product_name: g.product_name,
        accrued,
        intake_net_kg: g.intake_net_kg,
        reweigh_net_kg: reweighNet,
        shortfall,
      };
    });

    const accrued = sum(gradeCosts.map((g) => g.accrued));
    const reweighedKg = sum(grades.map((g) => g.reweigh_net_kg ?? '0.00'));
    const shortfallAmount = sum(gradeCosts.map((g) => g.shortfall));
    const basket = add(shortfallAmount, expenses);
    // §8.6 «Це не нуль» — a day with nothing weighed gets a dash, not '0.00'.
    const perKg = isZero(reweighedKg) ? null : div(basket, reweighedKg);

    return {
      shift_id: shiftId,
      accrued,
      reweighed_kg: reweighedKg,
      shortfall_amount: shortfallAmount,
      expenses_amount: expenses,
      basket,
      per_kg: perKg,
      total_check: add(accrued, expenses),
      top_ups_included: true,
      top_ups_latest_at: topUpsLatestAt,
      products: this.buildProducts(byProduct, gradeCosts, perKg),
    };
  }

  private buildProducts(
    byProduct: Map<string, GradeTotalsRow[]>,
    gradeCosts: GradeCost[],
    perKg: string | null,
  ): CostOfDayProduct[] {
    const products: CostOfDayProduct[] = [];
    for (const [productId, productGrades] of byProduct) {
      const accruedForProduct = sum(
        gradeCosts.filter((g) => g.product_id === productId).map((g) => g.accrued),
      );
      const intakeNet = sum(productGrades.map((g) => g.intake_net_kg));
      const reweighNet = sum(productGrades.map((g) => g.reweigh_net_kg ?? '0.00'));

      const priceWas = div(accruedForProduct, intakeNet);
      const priceCost = perKg === null ? null : add(priceWas, perKg);
      const priceByOurWeight = isZero(reweighNet) ? null : div(accruedForProduct, reweighNet);

      products.push({
        product_id: productId,
        product_name: productGrades[0].product_name,
        price_was: priceWas,
        price_cost: priceCost,
        price_by_our_weight: priceByOurWeight,
      });
    }
    return products;
  }
}

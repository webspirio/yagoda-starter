import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { productCostRows } from './product-cost-rows';
import { div, isZero, sub, sum } from '../common/money';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

export interface NetworkAveragePointRow {
  point_id: string;
  point_name: string;
  /** `null` — not '0.00' — when this point did not accept this product that
   *  day, accepted it but has not weighed it, OR weighed it in one grade and
   *  not another (§3.15 — half a product is not the «both intake and
   *  reweigh» case this sum filters for). §8.6: «Порожня клітинка … це не
   *  нуль» — it enters neither sum below. */
  weight_kg: string | null;
  /** сума(point, product) = нараховано − недостача, i.e. the value of what
   *  actually ARRIVED at the base. `null` exactly when `weight_kg` is. */
  amount: string | null;
}

export interface NetworkAverageProduct {
  product_id: string;
  product_name: string;
  /** Every point that had an intake for this product that day, weighed or
   *  not. A point with NO intake for this product never appears here at
   *  all — not even as a `null` row. */
  points: NetworkAveragePointRow[];
  /** Σ weight_kg over points that accepted this product and weighed EVERY
   *  grade of it (§3.15). */
  total_kg: string;
  /** Σ amount over the same points. */
  total_amount: string;
  /** total_amount ÷ total_kg — NEVER the mean of `points[].amount /
   *  points[].weight_kg`. The client's own worked example: 158,95 is right,
   *  (160,00 + 155,00) ÷ 2 = 157,50 is the trap. `null` when total_kg is
   *  zero — a network day where nothing at all has been weighed yet. */
  average_price: string | null;
}

export interface NetworkAverageResponse {
  date: string;
  products: NetworkAverageProduct[];
}

interface ShiftRow {
  shift_id: string;
  point_id: string;
  point_name: string;
}

/**
 * §8.6 «Середня ціна по мережі за день» — across every point that has a
 * shift on the given business date, per product: `Σ сума ÷ Σ вага`. The
 * client stated the rule literally: «сума додається, а середня ціна просто
 * вже береться формулою. Сума розділити на вагу» — never the mean of the
 * per-point averages.
 *
 * Reuses `productCostRows` (extracted from `CostOfDayService` for exactly
 * this) for the per-shift, per-product нараховано/недостача/вага — this
 * service adds nothing to that arithmetic, it only sums it across points
 * and divides once at the end.
 */
@Injectable()
export class NetworkAverageService {
  constructor(private readonly dataSource: DataSource) {}

  async forDate(_actor: AuthenticatedUser, date: string): Promise<NetworkAverageResponse> {
    const shiftRows = (await this.dataSource.query(
      `SELECT s.id AS shift_id, s.collection_point_id AS point_id, cp.name AS point_name
         FROM shifts s
         JOIN collection_points cp ON cp.id = s.collection_point_id
        WHERE s.business_date = $1
        ORDER BY cp.name`,
      [date],
    )) as ShiftRow[];

    const byProduct = new Map<
      string,
      { product_name: string; points: NetworkAveragePointRow[] }
    >();

    for (const shift of shiftRows) {
      const rows = await productCostRows(this.dataSource, shift.shift_id);
      for (const r of rows) {
        const entry = byProduct.get(r.product_id) ?? { product_name: r.product_name, points: [] };
        entry.points.push({
          point_id: shift.point_id,
          point_name: shift.point_name,
          weight_kg: r.reweigh_net_kg,
          amount: r.reweigh_net_kg === null ? null : sub(r.accrued, r.shortfall),
        });
        byProduct.set(r.product_id, entry);
      }
    }

    const products: NetworkAverageProduct[] = [];
    for (const [productId, entry] of byProduct) {
      // Only points that weighed the product IN FULL contribute — an absent
      // cell enters neither sum, exactly per §8.6, and `productCostRows`
      // has already nulled out a partially weighed product (§3.15) so that
      // its unweighed grade's kilograms cannot skew the network figure.
      const weighed = entry.points.filter(
        (p): p is NetworkAveragePointRow & { weight_kg: string; amount: string } =>
          p.weight_kg !== null,
      );
      const totalKg = sum(weighed.map((p) => p.weight_kg));
      const totalAmount = sum(weighed.map((p) => p.amount));

      products.push({
        product_id: productId,
        product_name: entry.product_name,
        points: entry.points,
        total_kg: totalKg,
        total_amount: totalAmount,
        average_price: isZero(totalKg) ? null : div(totalAmount, totalKg),
      });
    }
    products.sort((a, b) => a.product_name.localeCompare(b.product_name));

    return { date, products };
  }
}

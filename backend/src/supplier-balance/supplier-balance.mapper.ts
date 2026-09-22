/** The three terms of `Σ intakes + Σ top-ups − Σ payouts` (#103), plus the
 *  season counters the card's tiles read instead of summing a page that
 *  truncates past 100 documents. Every money and weight field is a decimal
 *  STRING (`::text` in `SupplierBalanceService.breakdownFor`'s SQL) — `debt`
 *  is legitimately negative after a voided receipt that had already been
 *  paid for; the DBML's «інваріанта борг >= 0 в цій схемі немає». */
export interface SupplierBalanceBreakdown {
  debt: string;
  intakes_total: string;
  top_ups_total: string;
  payouts_total: string;
  intakes_count: number;
  kg_total: string;
  /** Business date of the most recent LIVE receipt; `null` when there is none. */
  last_intake_date: string | null;
}

/** «Разом» — §3.1's one number, now WITH what it is made of (#103). */
export interface SupplierBalanceResponse extends SupplierBalanceBreakdown {
  supplier_id: string;
}

export function toSupplierBalanceResponse(
  supplier_id: string,
  breakdown: SupplierBalanceBreakdown,
): SupplierBalanceResponse {
  return { supplier_id, ...breakdown };
}

/** The row `SupplierBalanceService.list` projects — `debt` already `::text`. */
export interface SupplierBalanceRow {
  supplier_id: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  collection_point_id: string;
  debt: string;
}

/**
 * One line of the «Залишки» screen. The name rides along so the list renders
 * without a request per row; `is_active` rides along because a DEACTIVATED
 * supplier with a balance IS listed, and the screen has to be able to say so.
 */
export interface SupplierBalanceRowResponse {
  supplier_id: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  collection_point_id: string;
  debt: string;
}

/** Field by field, not `...row`: a raw projection must not reach the client
 *  with whatever a later `SELECT` happens to add. */
export function toSupplierBalanceRowResponse(row: SupplierBalanceRow): SupplierBalanceRowResponse {
  return {
    supplier_id: row.supplier_id,
    first_name: row.first_name,
    last_name: row.last_name,
    is_active: row.is_active,
    collection_point_id: row.collection_point_id,
    debt: row.debt,
  };
}

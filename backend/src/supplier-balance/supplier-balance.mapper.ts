/** «Разом» — §3.1's one number. A decimal STRING, and legitimately negative
 *  after a voided receipt that had already been paid for. */
export interface SupplierBalanceResponse {
  supplier_id: string;
  debt: string;
}

export function toSupplierBalanceResponse(
  supplier_id: string,
  debt: string,
): SupplierBalanceResponse {
  return { supplier_id, debt };
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

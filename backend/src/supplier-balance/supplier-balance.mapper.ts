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

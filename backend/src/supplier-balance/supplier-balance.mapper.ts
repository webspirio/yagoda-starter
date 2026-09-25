import type { DebtKind, Settlement } from './settlement';

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

/** One line of «Відкриті залишки» — spec §4.3. Every amount a scale-2 string. */
interface SettlementLineResponse {
  kind: DebtKind;
  id: string;
  /** A top-up carries its PARENT receipt's code. */
  code: string;
  intake_id: string;
  business_date: string;
  created_at: string;
  amount: string;
  paid: string;
  open: string;
  covered_by: { payout_id: string; payout_code: string; amount: string }[];
}

interface SettlementPayoutResponse {
  id: string;
  code: string;
  business_date: string;
  created_at: string;
  amount: string;
  intake_id: string | null;
  covers: { line_id: string; kind: DebtKind; amount: string }[];
  unallocated: string;
}

/**
 * `GET /suppliers/:id/settlement`. `debt` is the SAME number `/balance`
 * returns — the db-spec holds `debt === Σ open − unallocated`. `lines` is in
 * queue order, oldest first; no pagination, by design (spec §3.9).
 */
export interface SupplierSettlementResponse {
  supplier_id: string;
  debt: string;
  unallocated: string;
  lines: SettlementLineResponse[];
  payouts: SettlementPayoutResponse[];
}

/** Field by field, not `...row` — a raw projection must not reach the client. */
export function toSupplierSettlementResponse(
  supplier_id: string,
  s: Settlement & { debt: string },
): SupplierSettlementResponse {
  const payoutCode = new Map(s.payouts.map((p) => [p.id, p.code]));
  return {
    supplier_id,
    debt: s.debt,
    unallocated: s.unallocated,
    lines: s.lines.map((l) => ({
      kind: l.kind,
      id: l.id,
      code: l.code,
      intake_id: l.intake_id,
      business_date: l.business_date,
      created_at: l.created_at,
      amount: l.amount,
      paid: l.paid,
      open: l.open,
      covered_by: l.covered_by.map((c) => ({
        payout_id: c.payout_id,
        payout_code: payoutCode.get(c.payout_id) ?? '',
        amount: c.amount,
      })),
    })),
    payouts: s.payouts.map((p) => ({
      id: p.id,
      code: p.code,
      business_date: p.business_date,
      created_at: p.created_at,
      amount: p.amount,
      intake_id: p.intake_id,
      covers: p.covers.map((c) => ({ line_id: c.line_id, kind: c.kind, amount: c.amount })),
      unallocated: p.unallocated,
    })),
  };
}

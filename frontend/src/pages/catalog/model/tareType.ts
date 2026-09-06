/**
 * Mirrors the backend's `TareTypeResponse`.
 *
 * `weight_kg` AND `deposit_price` ARE STRINGS, AND THAT IS NOT NEGOTIABLE.
 * They are `numeric` columns carried as strings from database to JSON so no
 * value ever passes through a binary float. This is a cash business whose own
 * rules say a one-kopiyka discrepancy is the same problem as a 350 ₴ one, and
 * these two numbers are snapshotted into receipts that are never recalculated.
 *
 * Typing either as `number` here would compile, look harmless, and reintroduce
 * float error at the exact point the schema spent its design effort avoiding.
 */
export interface TareType {
  id: string;
  name: string;
  weight_kg: string;
  deposit_price: string;
  is_crate: boolean;
  is_active: boolean;
  created_at: string;
}

export interface TareTypeFormValues {
  name: string;
  weight_kg: string;
  deposit_price: string;
  is_crate: boolean;
  is_active: boolean;
}

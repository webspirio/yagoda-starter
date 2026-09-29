/**
 * §8.3's «витрати дня» — one free-text line the owner records against a
 * point's working day: «касир 1 000,00 / вантажник 1 300,00 / пальне
 * 1 000,00». There is no closed list of categories, by rule.
 *
 * THE ONE MUTABLE MONEY ROW IN THIS SCHEMA. Every other document is frozen
 * (§2.7) and corrected by a void plus a new one; nothing is printed for a
 * scratchpad line, so this one is patched and deleted in place. The
 * compensating control is an audit entry on every write that changes
 * something, written in the same transaction, server-side.
 */
export interface DayExpense {
  id: string;
  shift_id: string;
  label: string;
  amount: string;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

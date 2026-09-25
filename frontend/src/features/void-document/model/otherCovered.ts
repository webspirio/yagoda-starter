import type { SupplierSettlement } from '@/entities/supplier';
import { sum } from '@/shared/lib/money';

/** What a payout covers beyond this receipt and its top-ups — the debt that reopens if both are voided. */
export function otherCovered(
  settlement: SupplierSettlement,
  payoutId: string,
  intakeId: string,
): string {
  const payout = settlement.payouts.find((p) => p.id === payoutId);
  if (!payout) return '0.00';
  const own = new Set(settlement.lines.filter((l) => l.intake_id === intakeId).map((l) => l.id));
  return sum(payout.covers.filter((c) => !own.has(c.line_id)).map((c) => c.amount));
}

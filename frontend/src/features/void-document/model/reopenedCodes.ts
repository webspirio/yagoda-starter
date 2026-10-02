import type { SupplierSettlement } from '@/entities/supplier';

/** Receipt codes that reopen if this payout is voided — top-ups carry their parent's code. */
export function reopenedCodes(
  settlement: SupplierSettlement,
  payoutId: string,
  exceptIntakeId: string | null,
): string[] {
  const payout = settlement.payouts.find((p) => p.id === payoutId);
  if (!payout) return [];
  const covered = new Set(payout.covers.map((c) => c.line_id));
  const codes = settlement.lines
    .filter((l) => covered.has(l.id) && l.intake_id !== exceptIntakeId)
    .map((l) => l.code);
  return [...new Set(codes)];
}

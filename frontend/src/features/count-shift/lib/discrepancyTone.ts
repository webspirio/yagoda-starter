import { isZero } from '@/shared/lib/money';

export type DiscrepancyTone = 'leaf' | 'destructive';

/**
 * §7.6/§7.7 — a drawer count that matches (`discrepancy === '0.00'`) reads
 * leaf/✓; anything else reads destructive/⚠, whatever its sign. ONE place
 * for that call: `CountResultView`'s pill and `ShiftCountPanel`'s own
 * closing-count pill and midday ✓/⚠ rows all used to repeat the same
 * `isZero(d) ? 'leaf' : 'destructive'` ternary independently — a discrepancy
 * never blocks anything (§7.7, the 09.09 rule), so this is a DISPLAY tone
 * only, never a gate.
 */
export function discrepancyTone(discrepancy: string): DiscrepancyTone {
  return isZero(discrepancy) ? 'leaf' : 'destructive';
}

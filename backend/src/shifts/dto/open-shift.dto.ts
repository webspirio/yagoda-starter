import { Matches } from 'class-validator';
import { CanonicalDecimal } from '../../common/dto/canonical-decimal';

/**
 * §6.1 — counting the drawer is PART of opening a shift, not a step after it.
 * «Must be counted» is only true if it cannot be skipped: a separate endpoint
 * would let a shift exist with no opening count, and the closing expectation
 * would then have no anchor.
 *
 * TWO AMOUNTS since #178: the berry drawer and the crate-deposits drawer,
 * each written as its own `cash_counts` row (`book = 'berry' | 'crates'`).
 *
 * NO EXPECTED FIGURE IS ACCEPTED OR RETURNED BEFORE THE WRITE. §7.6 —
 * «очікувана сума СХОВАНА, поки не введено фактичну».
 */
export class OpenShiftDto {
  @Matches(/^\d{1,10}(\.\d{1,2})?$/, {
    message: 'counted_amount must be a non-negative decimal string with at most 2 decimal places',
  })
  @CanonicalDecimal()
  counted_amount: string;

  /** #178 — the crate-deposits drawer, counted beside the berry one. Required
   *  for the reason `counted_amount` is: a figure that can be skipped gets
   *  skipped. `0` is a valid answer (a point that has never taken a deposit). */
  @Matches(/^\d{1,10}(\.\d{1,2})?$/, {
    message: 'counted_deposits must be a non-negative decimal string with at most 2 decimal places',
  })
  @CanonicalDecimal()
  counted_deposits: string;
}

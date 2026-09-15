import { Matches } from 'class-validator';
import { CanonicalDecimal } from '../../common/dto/canonical-decimal';

/**
 * §6.1 — counting the drawer is PART of opening a shift, not a step after it.
 * «Must be counted» is only true if it cannot be skipped: a separate endpoint
 * would let a shift exist with no opening count, and the closing expectation
 * would then have no anchor.
 *
 * ONE AMOUNT, and `book` is written from a constant (`'berry'`). The crates
 * book is derived only (`point-cash/`'s `crate_deposits`, from
 * `crates/crate-balance.service.ts`'s `crateBookSql`) — no `cash_counts`
 * row is ever written with `book = 'crates'` (spec §7).
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
}

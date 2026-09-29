import { IsIn, Matches } from 'class-validator';
import { CanonicalDecimal } from '../../common/dto/canonical-decimal';
import { CashBook } from '../cash-book.enum';

/**
 * A MIDDAY RECOUNT — R2, spec `2026-09-22-yagoda-point-cash-parity.md`. §7.6:
 * «перерахунок — це свідчення, а не коригування». It writes a `midday`
 * `CashCount` and touches nothing else — no shift, no document, no balance.
 *
 * `book` IS CONSTRAINED TO `berry` (`@IsIn([CashBook.Berry])`). The crates
 * book is never counted (crates spec §4.3, `cash-book.enum.ts`'s header) — it
 * is derived only, so there is nothing here for an operator to count.
 *
 * `counted_amount` — same shape as `OpenShiftDto`/`CloseShiftDto`: an
 * unsigned decimal string, at most 10 integer digits and 2 places, canonicalised
 * to the scale Postgres stores (`CanonicalDecimal`) so what the API echoes back
 * matches what a fresh `GET /cash-counts` would return.
 */
export class CreateCashCountDto {
  @IsIn([CashBook.Berry])
  book: CashBook.Berry;

  @Matches(/^\d{1,10}(\.\d{1,2})?$/, {
    message: 'counted_amount must be a non-negative decimal string with at most 2 decimal places',
  })
  @CanonicalDecimal()
  counted_amount: string;
}

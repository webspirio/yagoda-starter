import { IsOptional, IsUUID, Matches } from 'class-validator';
import { CanonicalDecimal } from '../../common/dto/canonical-decimal';

/**
 * NO `code`. It was the number printed in the paper payout book, copied in by
 * the operator; since 2026-09-18 the server numbers the shift itself
 * (`common/document-code.ts`) and the field is gone from the form. `amount`
 * stayed — §3.7 still allows any sum from 0 to «Разом», and only the person at
 * the counter knows which one is leaving the drawer.
 */
export class CreatePayoutDto {
  /** Owner only — an operator's point comes from their token. */
  @IsOptional()
  @IsUUID()
  collection_point_id?: string;

  @IsUUID()
  supplier_id: string;

  /**
   * UNSIGNED, and zero is refused by `CHK_payouts_amount` rather than here —
   * the regex admits '0.00' so the refusal comes with a message about handing
   * over nothing rather than a shape complaint.
   *
   * The CEILING is not checked here: it depends on `Σ intakes − Σ payouts` for
   * this supplier, which only the service can read, under a lock.
   */
  @Matches(/^\d{1,10}(\.\d{1,2})?$/, {
    message: 'amount must be a decimal string with at most 2 decimal places',
  })
  @CanonicalDecimal()
  amount: string;
}

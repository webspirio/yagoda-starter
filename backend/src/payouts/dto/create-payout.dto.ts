import { IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import { CanonicalDecimal } from '../../common/dto/canonical-decimal';

export class CreatePayoutDto {
  /** The number printed in the paper receipt book; the server prefixes point,
   *  kind and business date. */
  @IsString()
  code: string;

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

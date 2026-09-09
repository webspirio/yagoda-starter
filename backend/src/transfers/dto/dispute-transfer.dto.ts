import { IsInt, IsString, Length, Matches, Min } from 'class-validator';
import { CanonicalDecimal } from '../../common/dto/canonical-decimal';

/**
 * §7.9 step 4б — «Не сходиться»: the point writes what it actually counted and
 * a comment.
 *
 * THE NOTE IS MANDATORY. §7.9 has the point writing a number AND a comment,
 * and the comment is the entire reason this document reaches the owner at all.
 * A dispute with no explanation is a number the owner cannot act on.
 *
 * BY THE CLIENT'S RULING OF 09.09.2026 these figures ENTER THE CASH FORMULA
 * while the dispute is open, overruling §7.9's «у ЖОДНУ формулу не входять».
 * The money is credited at the amount actually received; the shortfall is
 * settled outside the system. See `transfer.entity.ts`'s header.
 */
export class DisputeTransferDto {
  @Matches(/^\d{1,10}(\.\d{1,2})?$/, {
    message: 'reported_cash must be a non-negative decimal string with at most 2 decimal places',
  })
  @CanonicalDecimal()
  reported_cash: string;

  @IsInt()
  @Min(0)
  reported_crates: number;

  @IsString()
  @Length(1, 500)
  @Matches(/\S/, { message: 'dispute_note must not be blank' })
  dispute_note: string;
}

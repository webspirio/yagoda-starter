import { IsInt, IsOptional, IsString, IsUUID, Length, Matches, Min } from 'class-validator';
import { CanonicalDecimal } from '../../common/dto/canonical-decimal';

/**
 * §7.9 step 1 — the owner creates the document. `carrier` is REQUIRED because
 * «без перевізника документ НЕ проводиться»: the carrier signs the paper book
 * and is half of a trip's identity, there being no trip number.
 *
 * `cash` and `crates` may each be zero — a crates-only run and a cash-only run
 * are both ordinary — but not both. The PAIR is refused by the service, not
 * here: a rule about two fields at once has no single-field decorator, and
 * `CHK_transfers_not_empty` behind it would surface as a 500 rather than a
 * 400 (no `QueryFailedError` mapping exists in this backend).
 *
 * THE REGEX ADMITS NO SIGN. A transfer that takes money AWAY from a point is
 * not in §7.3's closed list, and a negative `cash` would be a back door to
 * exactly that.
 */
export class CreateTransferDto {
  @IsUUID()
  collection_point_id: string;

  @Matches(/^\d{1,10}(\.\d{1,2})?$/, {
    message: 'cash must be a non-negative decimal string with at most 2 decimal places',
  })
  @CanonicalDecimal()
  cash: string;

  @IsInt()
  @Min(0)
  crates: number;

  @IsString()
  @Length(1, 200)
  @Matches(/\S/, { message: 'carrier must not be blank' })
  carrier: string;

  /** §9.3 — a correction is a new document naming the one it corrects. The
   *  service checks it belongs to the same point. */
  @IsOptional()
  @IsUUID()
  correction_of_transfer_id?: string;
}

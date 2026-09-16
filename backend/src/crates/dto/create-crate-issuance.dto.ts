import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { CrateIssuanceMode } from '../crate-issuance-mode.enum';

/**
 * WHAT IS ABSENT IS THE DESIGN. No `code` (the server generates it — the seam
 * is inverted relative to `intakes`, where the operator types what is printed
 * on paper), no `shift_id` (resolved from the point's open shift), no
 * `deposit_per_unit` and no `deposit_taken` (snapshotted and computed
 * server-side). Accepting any of them would make the catalogue decorative.
 *
 * `mode` IS ACCEPTED VERBATIM. §6.2's «до 50 завдаток, від 51 розписка» is a
 * default the client pre-selects; ticket #60: «ми не обмежуємо вибір».
 */
export class CreateCrateIssuanceDto {
  /** Owner only. An operator's point comes from their token. */
  @IsOptional()
  @IsUUID()
  collection_point_id?: string;

  @IsUUID()
  supplier_id: string;

  /** `Max` is a typo guard, not a business rule — the largest real issuance in
   *  the client's workbook is in the low hundreds. */
  @IsInt()
  @Min(1)
  @Max(10000)
  units: number;

  @IsEnum(CrateIssuanceMode)
  mode: CrateIssuanceMode;
}

import { IsEnum, IsInt, IsOptional, IsString, Length, Matches, Min } from 'class-validator';
import { PointKind } from '../point-kind.enum';

/**
 * `target_cash` is a STRING, not a number: `numeric(12,2)` is carried as a
 * string end to end so no value ever passes through a binary float. The regex
 * is the column's own shape — up to 10 integer digits and at most 2 decimals.
 *
 * Neither target is required, and NEITHER GETS A DEFAULT. §6.9 wants "—" for a
 * point with no target rather than a zero, and §7.10 wants such a point left
 * out of the network-debt table entirely.
 */
export class CreateCollectionPointDto {
  @IsString()
  @Length(1, 128)
  name: string;

  /**
   * REQUIRED, and the alternative was considered and rejected. A generated
   * `P07` would end up printed on a supplier's receipt with nobody ever having
   * been asked; creating a point is a rare, owner-only act and is the right
   * moment to ask. The migration backfills existing rows precisely because
   * they had no such moment.
   *
   * VALIDATED CASE-INSENSITIVELY AND NORMALIZED IN THE SERVICE, matching how
   * `name` is handled here (`assertTrimmedName`) rather than introducing a
   * second normalization pattern in the same module. «kpg» is accepted and
   * stored as «KPG»; the storage form is enforced by
   * `CHK_collection_points_code`, which is the real guarantee either way.
   */
  @IsString()
  @Matches(/^\s*[A-Za-z0-9]{2,8}\s*$/, {
    message: 'code must be 2–8 characters, letters and digits only',
  })
  code: string;

  @IsOptional()
  @IsEnum(PointKind)
  kind?: PointKind;

  @IsOptional()
  @Matches(/^\d{1,10}(\.\d{1,2})?$/, {
    message: 'target_cash must be a decimal string with at most 2 decimal places',
  })
  target_cash?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  target_crates?: number | null;
}

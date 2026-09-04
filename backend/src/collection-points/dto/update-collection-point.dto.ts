import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Length, Matches, Min } from 'class-validator';
import { PointKind } from '../point-kind.enum';

/**
 * ABSENT and NULL mean different things here, and the service tells them apart
 * with `in`: an absent target is left alone, an explicit `null` CLEARS it back
 * to "not known" (§6.9). `@IsOptional()` permits both, which is exactly what
 * is wanted — a `@ValidateIf` dance would only re-derive the same behaviour.
 *
 * A target LOWER than what is already out with people is allowed here on
 * purpose: §6.1 makes that a warning on screen, not a refusal, because a
 * target is a management decision.
 */
export class UpdateCollectionPointDto {
  @IsOptional()
  @IsString()
  @Length(1, 128)
  name?: string;

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

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  /** §6.1's worked example is "15.07.2026 цільове значення 600 → 800, керівник,
   *  причина: розширили точку". The reason is not stored on the row — targets
   *  keep no history — it becomes the audit entry's note. */
  @IsOptional()
  @IsString()
  @Length(1, 500)
  reason?: string;
}

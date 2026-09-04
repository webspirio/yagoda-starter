import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
  ValidateIf,
} from 'class-validator';
import { PointKind } from '../point-kind.enum';

/**
 * ABSENT and NULL mean different things here, and the service tells them apart
 * with `!== undefined` — NOT `in`, which is permanently TRUE on a
 * transformed DTO (see `CollectionPointsService.update`'s own comment on
 * `target_cash`/`target_crates` for why, and the exact bug that shape caused
 * once already): an absent target is left alone, an explicit `null` CLEARS it
 * back to "not known" (§6.9). `@IsOptional()` on `target_cash`/`target_crates`
 * permits both, which is exactly what is wanted for THOSE two columns — they
 * are nullable, and null is meaningful.
 *
 * `name`, `kind` and `is_active` are NOT nullable columns. `@IsOptional()`
 * treats an explicit `null` the same as an absent field and skips every
 * subsequent validator, which would let `{"name": null}` sail through
 * class-validator untouched and crash on the NOT NULL constraint at
 * `repo.save()` — a 500 instead of a 400. `@ValidateIf((o) => o.x !==
 * undefined)` only skips validation when the field is truly ABSENT; an
 * explicit `null` still reaches `@IsString()`/`@IsEnum()`/`@IsBoolean()` and
 * is correctly rejected with a 400.
 *
 * A target LOWER than what is already out with people is allowed here on
 * purpose: §6.1 makes that a warning on screen, not a refusal, because a
 * target is a management decision.
 */
export class UpdateCollectionPointDto {
  @ValidateIf((o: UpdateCollectionPointDto) => o.name !== undefined)
  @IsString()
  @Length(1, 128)
  name?: string;

  @ValidateIf((o: UpdateCollectionPointDto) => o.kind !== undefined)
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

  @ValidateIf((o: UpdateCollectionPointDto) => o.is_active !== undefined)
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

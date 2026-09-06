import { IsBoolean, IsString, Length, Matches, ValidateIf } from 'class-validator';
import { CanonicalDecimal } from '../../common/dto/canonical-decimal';

/**
 * Every field here backs a NOT NULL column, so all five use
 * `@ValidateIf(... !== undefined)` rather than `@IsOptional()`: the latter
 * treats an explicit `null` as absent and skips every later validator, letting
 * `{"weight_kg": null}` reach the database as a 500 where a 400 belongs.
 *
 * Editing these numbers is SAFE for history by construction: §2.7 snapshots
 * them into `intake_items.tare_weight_kg` and `crate_issuances.deposit_per_unit`
 * at write time, so raising a crate from 120 to 130 cannot move a July
 * issuance. There is deliberately no rule tying `deposit_price` to `is_crate`.
 *
 * `@CanonicalDecimal()` sits below `@Matches` on both numeric fields, same as
 * `CreateTareTypeDto` — see that file's doc comment for why. Without it, a
 * `PATCH {"weight_kg":"1.2"}` against a row already holding `1.20` makes
 * `diffFields` see a change that never happened and writes a phantom
 * `tare-type.updated` audit entry — the only record anywhere that this number
 * moved.
 */
export class UpdateTareTypeDto {
  @ValidateIf((o: UpdateTareTypeDto) => o.name !== undefined)
  @IsString()
  @Length(1, 128)
  name?: string;

  @ValidateIf((o: UpdateTareTypeDto) => o.weight_kg !== undefined)
  @Matches(/^\d{1,8}(\.\d{1,2})?$/, {
    message: 'weight_kg must be a decimal string with at most 2 decimal places',
  })
  @CanonicalDecimal()
  weight_kg?: string;

  @ValidateIf((o: UpdateTareTypeDto) => o.deposit_price !== undefined)
  @Matches(/^\d{1,10}(\.\d{1,2})?$/, {
    message: 'deposit_price must be a decimal string with at most 2 decimal places',
  })
  @CanonicalDecimal()
  deposit_price?: string;

  @ValidateIf((o: UpdateTareTypeDto) => o.is_crate !== undefined)
  @IsBoolean()
  is_crate?: boolean;

  @ValidateIf((o: UpdateTareTypeDto) => o.is_active !== undefined)
  @IsBoolean()
  is_active?: boolean;
}

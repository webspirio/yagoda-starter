import { IsBoolean, IsString, Length, Matches, ValidateIf } from 'class-validator';

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
  weight_kg?: string;

  @ValidateIf((o: UpdateTareTypeDto) => o.deposit_price !== undefined)
  @Matches(/^\d{1,10}(\.\d{1,2})?$/, {
    message: 'deposit_price must be a decimal string with at most 2 decimal places',
  })
  deposit_price?: string;

  @ValidateIf((o: UpdateTareTypeDto) => o.is_crate !== undefined)
  @IsBoolean()
  is_crate?: boolean;

  @ValidateIf((o: UpdateTareTypeDto) => o.is_active !== undefined)
  @IsBoolean()
  is_active?: boolean;
}

import { IsNotEmpty, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';
import { CanonicalDecimal } from '../../common/dto/canonical-decimal';

/**
 * The one `PATCH` DTO in this slice that patches a real, standing row — every
 * other document in this schema is frozen (§2.7) and edited only by a void
 * plus a new row. See `day-expense.entity.ts` for why this table is the
 * exception.
 *
 * HAND-WRITTEN, NOT `PartialType(CreateDayExpenseDto)` — `@nestjs/mapped-types`
 * is not a dependency of this repo (see `intakes/dto/preview-intake.dto.ts`'s
 * doc comment for the same call). Both fields use `@ValidateIf(... !==
 * undefined)` rather than `@IsOptional()`, matching `UpdateTareTypeDto`: the
 * latter treats an explicit `null` as absent and skips every later validator,
 * letting `{"amount": null}` reach the database as a 500 where a 400 belongs.
 */
export class UpdateDayExpenseDto {
  @ValidateIf((o: UpdateDayExpenseDto) => o.label !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'label must not be empty' })
  @MaxLength(120)
  label?: string;

  /**
   * `@CanonicalDecimal()` MATTERS MOST HERE, and this is the one table in
   * the schema where it does. `PATCH {"amount":"1000"}` against a row
   * already holding `1000.00` is a no-op, but `diffFields` compares with
   * `!==`, so without canonicalisation it records a `day-expense.updated`
   * entry reading `before "1000.00"` / `after "1000"` for a change that
   * never happened — and then persists the uncanonical string. §3.8 makes
   * that audit trail the SOLE compensating control for this table being
   * mutable at all; a trail with invented entries in it is not one.
   */
  @ValidateIf((o: UpdateDayExpenseDto) => o.amount !== undefined)
  @Matches(/^\d{1,10}(\.\d{1,2})?$/, {
    message: 'amount must be a decimal string with at most 2 decimal places',
  })
  @CanonicalDecimal()
  amount?: string;
}

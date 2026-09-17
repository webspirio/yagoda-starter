import { IsNotEmpty, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';

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

  @ValidateIf((o: UpdateDayExpenseDto) => o.amount !== undefined)
  @Matches(/^\d+(\.\d{1,2})?$/, { message: 'amount must be a decimal with at most 2 places' })
  amount?: string;
}

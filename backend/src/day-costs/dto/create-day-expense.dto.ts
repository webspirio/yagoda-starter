import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * `label` is FREE TEXT (§8.3 — no closed list of categories). Trimmed before
 * validation so a whitespace-only value 400s here as `LABEL_EMPTY` rather than
 * passing `@IsNotEmpty` and only being caught by `CHK_day_expenses_label`.
 */
export class CreateDayExpenseDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'label must not be empty' })
  @MaxLength(120)
  label: string;

  @Matches(/^\d+(\.\d{1,2})?$/, { message: 'amount must be a decimal with at most 2 places' })
  amount: string;
}

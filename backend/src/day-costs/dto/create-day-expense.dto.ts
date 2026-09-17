import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { CanonicalDecimal } from '../../common/dto/canonical-decimal';

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

  /**
   * UNSIGNED BY SHAPE AND DIGIT-BOUNDED, exactly as `CreateIntakeTopUpDto`:
   * `\d{1,10}` is what `numeric(12,2)` can hold, and without the bound an
   * over-long amount reaches Postgres as a numeric-field-overflow — an
   * opaque 500, because this backend maps no `QueryFailedError`
   * (`common/filters/all-exceptions.filter.ts`).
   *
   * The regex admits '0.00' on purpose; positivity is refused in
   * `DayExpensesService` so the answer is a sentence about an expense that
   * costs nothing rather than a shape complaint, and so
   * `CHK_day_expenses_amount` never has to be the one that speaks.
   */
  @Matches(/^\d{1,10}(\.\d{1,2})?$/, {
    message: 'amount must be a decimal string with at most 2 decimal places',
  })
  @CanonicalDecimal()
  amount: string;
}

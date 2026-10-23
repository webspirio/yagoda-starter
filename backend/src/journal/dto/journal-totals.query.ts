import {
  IsISO8601,
  IsOptional,
  IsUUID,
  Matches,
  Validate,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';

const BUSINESS_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` compares correctly as text, so no date parsing is needed. A missing
 *  `from` is `from`'s own error, not an inverted range. */
@ValidatorConstraint({ name: 'notBeforeFrom' })
class NotBeforeFrom implements ValidatorConstraintInterface {
  validate(to: string, args: ValidationArguments): boolean {
    const { from } = args.object as JournalTotalsQueryDto;
    return from === undefined || from <= to;
  }

  defaultMessage(): string {
    return 'to must not be before from';
  }
}

/** Both bounds required and inclusive, on the SHIFT's `business_date` — the
 *  same bounds `GET /intakes` and `GET /payouts` filter the journal's tables by.
 *  `collection_point_id` is IGNORED for an operator, as on those lists. */
export class JournalTotalsQueryDto {
  // `strict` rejects a date that is not on the calendar — `2026-02-30` would
  // otherwise reach `business_date BETWEEN` and come back as a 500.
  @Matches(BUSINESS_DATE, { message: 'from must be YYYY-MM-DD' })
  @IsISO8601({ strict: true }, { message: 'from must be a calendar date' })
  from: string;

  @Matches(BUSINESS_DATE, { message: 'to must be YYYY-MM-DD' })
  @IsISO8601({ strict: true }, { message: 'to must be a calendar date' })
  @Validate(NotBeforeFrom)
  to: string;

  @IsOptional()
  @IsUUID()
  collection_point_id?: string;

  @IsOptional()
  @IsUUID()
  supplier_id?: string;
}

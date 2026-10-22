import {
  IsOptional,
  IsUUID,
  Matches,
  Validate,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';

const BUSINESS_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` compares correctly as text, so no date parsing is needed. */
@ValidatorConstraint({ name: 'notBeforeFrom' })
class NotBeforeFrom implements ValidatorConstraintInterface {
  validate(to: string, args: ValidationArguments): boolean {
    return (args.object as JournalTotalsQueryDto).from <= to;
  }

  defaultMessage(): string {
    return 'to must not be before from';
  }
}

/** Both bounds required and inclusive, on the SHIFT's `business_date` — the
 *  same bounds `GET /intakes` and `GET /payouts` filter the journal's tables by.
 *  `collection_point_id` is IGNORED for an operator, as on those lists. */
export class JournalTotalsQueryDto {
  @Matches(BUSINESS_DATE, { message: 'from must be YYYY-MM-DD' })
  from: string;

  @Matches(BUSINESS_DATE, { message: 'to must be YYYY-MM-DD' })
  @Validate(NotBeforeFrom)
  to: string;

  @IsOptional()
  @IsUUID()
  collection_point_id?: string;

  @IsOptional()
  @IsUUID()
  supplier_id?: string;
}

import { IsString, IsUUID, Length, Matches } from 'class-validator';
import { CanonicalDecimal } from '../../common/dto/canonical-decimal';

export class CreateIntakeTopUpDto {
  /** The receipt this money is for. MANDATORY — see `IntakeTopUp`'s header:
   *  a nullable link would make this table the opening-balance mechanism the
   *  owner removed on 04.09.2026. */
  @IsUUID()
  intake_id: string;

  /**
   * UNSIGNED BY SHAPE, and positivity is refused in the service rather than
   * here — the regex admits '0.00' so the refusal arrives as a sentence about
   * a top-up that changes no debt rather than a shape complaint. The CHECK is
   * the real guarantee; the service pre-check only keeps it a 400 instead of
   * an opaque 500, since this backend maps no QueryFailedError anywhere.
   *
   * NO UPPER BOUND, deliberately. `amount <= intakes.amount` looks right and
   * is wrong: the parent is chosen by RECENCY, so a top-up covering a week of
   * deliveries would be refused because yesterday's receipt was small.
   */
  @Matches(/^\d{1,10}(\.\d{1,2})?$/, {
    message: 'amount must be a decimal string with at most 2 decimal places',
  })
  @CanonicalDecimal()
  amount: string;

  /**
   * #61's second requirement: «щоб при перегляді історії було ясно зрозуміло,
   * чому ми маємо викладати дві тисячі цьому постачальнику».
   *
   * `@Length(1, …)` ALONE IS NOT «NON-BLANK» — it counts characters, so
   * `{"reason":"   "}` passes it and the column ends up holding whitespace on
   * a 2 000 ₴ debt entry. `\S` is the whole test. Same pair as
   * `VoidDocumentDto`, and for the same reason.
   */
  @IsString()
  @Length(1, 500)
  @Matches(/\S/, { message: 'reason must not be blank' })
  reason: string;
}

import { IsString, Length, Matches } from 'class-validator';

/**
 * Shared by `intakes`, `payouts` and `transfers`: §9.3 governs all three
 * identically — «сторно повне, з обов'язковою причиною» — and separate copies
 * of one rule drift.
 *
 * The reason is MANDATORY, and that is the whole argument for why voiding is a
 * trio of columns rather than a status value: «спроба сторнувати без причини →
 * кнопка неактивна», and a status carries no reason. `transfer_status` lost its
 * `void` member on 03.09.2026 for exactly this.
 */
export class VoidDocumentDto {
  @IsString()
  @Length(1, 500)
  // `@Length(1, …)` ALONE IS NOT «NON-BLANK». It counts characters, so
  // `{"reason":"   "}` passes it, and the column ends up holding whitespace on
  // a document that §9.3 says may not be voided without a reason. «Спроба
  // сторнувати без причини → кнопка неактивна» has to hold for the API too, or
  // the button is the only thing enforcing it. `\S` is the whole test: at
  // least one character that survives a trim.
  //
  // WHAT THE STORED VALUE THEN IS varies by service, and this decorator is
  // what makes that variation harmless rather than load-bearing:
  // `TransfersService.void` writes `dto.reason.trim()`, while `IntakesService`
  // and `PayoutsService` write `dto.reason` as it arrived. Both now store a
  // reason with something in it. Making the three agree is recorded in the
  // follow-ups; it is a change to three services, not to this DTO.
  @Matches(/\S/, { message: 'reason must not be blank' })
  reason: string;
}

import { IsString, Length, Matches } from 'class-validator';

/**
 * §7.7's surviving half. The client's ruling removed the GATE, not the
 * explanation: the shift closes freely, and the owner writes down what the
 * discrepancy turned out to be whenever they find out.
 *
 * EXPLAINING IS NOT CORRECTING. «Розбіжність у документі лишається, її не
 * підганяють» — no number moves, and the point's accumulated
 * `Σ (counted − expected)` still includes explained incidents. An explanation
 * changes what is OPEN, never what is TRUE.
 *
 * ONE PER SHIFT, not per count. A shift whose opening and closing counts are
 * both off for different reasons shares this field; the shift is the unit an
 * owner investigates.
 */
export class SetExplanationDto {
  @IsString()
  @Length(1, 2000)
  @Matches(/\S/, { message: 'explanation must not be blank' })
  explanation: string;
}

import { IsInt, Matches, Max, Min } from 'class-validator';
import { CanonicalDecimal } from '../../common/dto/canonical-decimal';

/**
 * §6.1 — counting the drawer is PART of closing a shift.
 *
 * A DISCREPANCY DOES NOT REFUSE THE CLOSE. Client ruling of 09.09.2026, which
 * overrules §7.7 in full: «якщо каса не сходиться, це не блокує процес. Ми
 * йдемо далі за порахованою сумою, але повідомляємо керівника про розбіжність».
 * The shift closes, the discrepancy is recorded, and the owner is told —
 * `shift_status.awaiting_explanation` is never reached.
 *
 * THE RESPONSE IS THE SHIFT, AND CARRIES NEITHER FIGURE. An earlier draft of
 * §6.2 had it return the expectation and the discrepancy; the spec was amended
 * to match what ships, because `ShiftResponse` is the shift row and nothing
 * else. The operator reads the outcome from `GET /cash-counts?shift_id=…`,
 * which computes the discrepancy in one place for every caller. Nothing
 * returns either figure BEFORE this write — that much still holds, and it is
 * what stops a drawer being counted to match a number on screen.
 */
export class CloseShiftDto {
  @Matches(/^\d{1,10}(\.\d{1,2})?$/, {
    message: 'counted_amount must be a non-negative decimal string with at most 2 decimal places',
  })
  @CanonicalDecimal()
  counted_amount: string;

  /**
   * §6.8's «бій» — crates that broke during the shift (#110).
   *
   * REQUIRED, not optional, for the reason the cash count is written inside
   * this same transaction rather than beside it: a number that can be skipped
   * gets skipped. ZERO IS A NORMAL VALUE (#110, literally: «нуль — нормальне
   * значення»), so there is no `@IsOptional()` and no default — `null` means
   * «не записано» and is unreachable through this DTO.
   *
   * `@Max` is a typo guard, not a business rule — #110's own example is 3.
   * Same ceiling as `CreateCrateIssuanceDto.units`.
   */
  @IsInt()
  @Min(0)
  @Max(10000)
  broken_crates: number;
}

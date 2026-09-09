import { Matches } from 'class-validator';
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
 * The response carries the expectation and the discrepancy; nothing returns
 * them BEFORE this write (§6.2).
 */
export class CloseShiftDto {
  @Matches(/^\d{1,10}(\.\d{1,2})?$/, {
    message: 'counted_amount must be a non-negative decimal string with at most 2 decimal places',
  })
  @CanonicalDecimal()
  counted_amount: string;
}

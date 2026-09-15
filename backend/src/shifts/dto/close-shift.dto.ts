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
}

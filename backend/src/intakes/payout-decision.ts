import { BadRequestException } from '@nestjs/common';
import type { PayoutDecision } from './dto/void-intake.dto';

/**
 * #125 + 2026-09-28. Open shift: the supplier is at the counter, so a live bound payout always
 * goes with the receipt and there is nothing to decide. Closed shift (owner only, via
 * `assertCanVoid`): the decision is required iff a live payout is bound.
 */
export function assertPayoutDecision(
  shiftClosed: boolean,
  hasLivePayout: boolean,
  decision: PayoutDecision | undefined,
): void {
  if (decision && (!shiftClosed || !hasLivePayout)) {
    throw new BadRequestException({
      message: shiftClosed
        ? 'This receipt has no live payout to decide about'
        : 'In an open shift the payout is voided with the receipt — there is nothing to decide',
      code: 'PAYOUT_DECISION_NOT_APPLICABLE',
    });
  }
  if (shiftClosed && hasLivePayout && !decision) {
    throw new BadRequestException({
      message: 'This receipt has a live payout — say whether to keep or void it',
      code: 'PAYOUT_DECISION_REQUIRED',
    });
  }
}

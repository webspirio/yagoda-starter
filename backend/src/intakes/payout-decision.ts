import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import type { PayoutDecision } from './dto/void-intake.dto';

/**
 * #125: a receipt with a live bound payout cannot be voided without saying what
 * happens to that payout. `void_returned` attests cash back in the drawer — owner only,
 * like `settle-return`.
 */
export function assertPayoutDecision(
  actor: AuthenticatedUser,
  hasLivePayout: boolean,
  decision: PayoutDecision | undefined,
): void {
  if (hasLivePayout && !decision) {
    throw new BadRequestException({
      message: 'This receipt has a live payout — say whether to keep or void it',
      code: 'PAYOUT_DECISION_REQUIRED',
    });
  }
  if (!hasLivePayout && decision) {
    throw new BadRequestException({
      message: 'This receipt has no live payout to decide about',
      code: 'PAYOUT_DECISION_NOT_APPLICABLE',
    });
  }
  if (decision === 'void_returned' && actor.role !== UserRole.NetworkOwner) {
    throw new ForbiddenException({
      message: 'Only the network owner may record a returned payout',
      code: 'OWNER_ONLY',
    });
  }
}

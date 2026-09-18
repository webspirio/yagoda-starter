import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../users/user-role.enum';
import { CostOfDayService, CostOfDayResponse } from './cost-of-day.service';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * §8.4 — same owner-only world as reweigh reconciliation and day expenses
 * (§8 «Читання теж керівника»): собівартість is built from the base's own
 * numbers against a point, not something a point operator sees about itself.
 */
@Controller()
@Auth(UserRole.NetworkOwner)
export class CostOfDayController {
  constructor(private readonly costOfDay: CostOfDayService) {}

  @Get('shifts/:shiftId/cost-of-day')
  forShift(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('shiftId', ParseUUIDPipe) shiftId: string,
  ): Promise<CostOfDayResponse> {
    return this.costOfDay.forShift(actor, shiftId);
  }
}

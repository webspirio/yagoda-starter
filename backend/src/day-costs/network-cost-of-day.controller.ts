import { Controller, Get, Query } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../users/user-role.enum';
import { NetworkCostOfDayService, NetworkCostOfDayResponse } from './network-cost-of-day.service';
import { NetworkCostOfDayQueryDto } from './dto/network-cost-of-day.query';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * §8.4 for every point at once — the «Усі точки» option of «Собівартість
 * дня». Same owner-only world as the per-shift cost-of-day (§8 «Читання теж
 * керівника»): comparing points against each other is the owner's view.
 */
@Controller('reports')
@Auth(UserRole.NetworkOwner)
export class NetworkCostOfDayController {
  constructor(private readonly networkCost: NetworkCostOfDayService) {}

  @Get('cost-of-day')
  forDate(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: NetworkCostOfDayQueryDto,
  ): Promise<NetworkCostOfDayResponse> {
    return this.networkCost.forDate(actor, query.date);
  }
}

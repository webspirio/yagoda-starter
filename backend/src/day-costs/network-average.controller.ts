import { Controller, Get, Query } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../users/user-role.enum';
import { NetworkAverageService, NetworkAverageResponse } from './network-average.service';
import { NetworkAverageQueryDto } from './dto/network-average.query';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * §8.6 — same owner-only world as reweigh reconciliation, day expenses and
 * cost-of-day (§8 «Читання теж керівника»): the network average compares
 * points against each other, which is the owner's view, not any one point's.
 */
@Controller('reports')
@Auth(UserRole.NetworkOwner)
export class NetworkAverageController {
  constructor(private readonly networkAverage: NetworkAverageService) {}

  @Get('network-average')
  forDate(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: NetworkAverageQueryDto,
  ): Promise<NetworkAverageResponse> {
    return this.networkAverage.forDate(actor, query.date);
  }
}

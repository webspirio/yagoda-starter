import { Controller, Get, Query } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CrateStandingService, CrateStandingResponse } from './crate-standing.service';
import { CrateStandingQueryDto } from './dto/crate-standing.query';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * The «Ящики» screen's allotment bar. Its own noun rather than a block on
 * `/crate-balances`: that is a paginated per-supplier list, this is one
 * point's aggregate. Both roles — §6.10 gives the operator «склад цільового
 * значення» of their own point; the scope is the service's to decide.
 */
@Controller('crate-standing')
export class CrateStandingController {
  constructor(private readonly standing: CrateStandingService) {}

  @Get()
  @Auth()
  get(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: CrateStandingQueryDto,
  ): Promise<CrateStandingResponse> {
    return this.standing.forPoint(actor, query);
  }
}

import { Controller, Get, Query } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CashCountsService } from './cash-counts.service';
import { ListCashCountsQueryDto } from './dto/list-cash-counts.query';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * §7.6's journal, and the owner's incident list.
 *
 * NO WRITE ROUTE EXISTS, deliberately — see the service's header. Both roles
 * read it; an operator is scoped to their own point server-side.
 */
@Controller('cash-counts')
export class CashCountsController {
  constructor(private readonly counts: CashCountsService) {}

  @Get()
  @Auth()
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListCashCountsQueryDto) {
    return this.counts.list(actor, query);
  }
}

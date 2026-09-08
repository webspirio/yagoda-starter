import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PayoutsService } from './payouts.service';
import { CreatePayoutDto } from './dto/create-payout.dto';
import { SettleReturnDto } from './dto/settle-return.dto';
import { ListPayoutsQueryDto } from './dto/list-payouts.query';
import { VoidDocumentDto } from '../intakes/dto/void-document.dto';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * Cash handed over the counter.
 *
 * `settle-return` IS THE ONLY OWNER-ONLY VERB HERE, and the reason is §9.3's:
 * an operator who could both void their own payout and certify that the cash
 * came back would close that loop alone and unobserved — «інакше сторно стає
 * способом красти». The person holding the drawer is not the person who
 * attests it was refilled.
 *
 * `void` authority is decided in the SERVICE because it depends on the row
 * (§9.4 — «чужа квитанція → приймальник НІКОЛИ»), which a guard cannot see.
 *
 * No `PATCH`, no `DELETE` — §2.7, §9.3, §10.4.
 */
@Controller('payouts')
export class PayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  @Post()
  @Auth()
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreatePayoutDto) {
    return this.payouts.create(actor, dto);
  }

  @Get()
  @Auth()
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListPayoutsQueryDto) {
    return this.payouts.list(actor, query);
  }

  @Get(':id')
  @Auth()
  findOne(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payouts.findOne(actor, id);
  }

  @Post(':id/void')
  @Auth()
  void(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidDocumentDto,
  ) {
    return this.payouts.void(actor, id, dto);
  }

  @Post(':id/settle-return')
  @Auth(UserRole.NetworkOwner)
  settleReturn(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SettleReturnDto,
  ) {
    return this.payouts.settleReturn(actor, id, dto);
  }
}

import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ShiftsService } from './shifts.service';
import { ReopenShiftDto } from './dto/reopen-shift.dto';
import { ListShiftsQueryDto } from './dto/list-shifts.query';
import { CurrentShiftQueryDto } from './dto/current-shift.query';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * A shift is one point's working day. IN THIS SLICE IT IS A CONTAINER AND
 * NOTHING MORE — it exists so `intakes` and `payouts` have somewhere to hang a
 * point and a business date, neither of which they store themselves.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO: no cash count on open, no
 * reconciliation on close, no discrepancy, no `explanation`, and
 * `awaiting_explanation` is unreachable. All of it needs `cash_counts`, whose
 * `expected_amount` comes from a five-table formula over `transfers`,
 * `payouts`, `crate_issuances`, `crate_returns` and `intakes` — three of which
 * do not exist. `close` is a timestamp. Spec §2.1 prices this cut.
 *
 * ROLES ARE NOT UNIFORM HERE, and the split is §10.3 + §10.2:
 *
 *   open, close   → PointOperator ONLY. «Тільки приймальник — і це не помилка…
 *                   Відкрити чужий робочий день і закрити його за людину нема
 *                   кому, а підпис під зведеною касою мусить належати тому, хто
 *                   цю касу тримав у руках.» The owner has neither verb.
 *   reopen        → NetworkOwner ONLY. A correction, and §10.2 puts corrections
 *                   with the owner.
 *   reads         → both, scoped by `resolvePointFilter`.
 *
 * `POST /shifts` TAKES NO BODY. `business_date` is server-derived (foundation
 * §5.2) and the point comes from the operator's token, which leaves nothing a
 * caller could send. The route is nonetheless PROVISIONAL IN SHAPE: §07:30
 * makes opening a shift «сума вводиться фактично порахована», two records — one
 * per cash book — and that is when it grows a DTO.
 */
@Controller('shifts')
export class ShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  @Post()
  @Auth(UserRole.PointOperator)
  open(@CurrentUser() actor: AuthenticatedUser) {
    return this.shifts.open(actor);
  }

  /**
   * MUST BE DECLARED BEFORE `GET :id`. Nest resolves handlers in registration
   * order, so with the parameterized route first, `/shifts/current` is matched
   * as an id and `ParseUUIDPipe` answers 400 for a route that exists.
   */
  @Get('current')
  @Auth()
  current(@CurrentUser() actor: AuthenticatedUser, @Query() query: CurrentShiftQueryDto) {
    return this.shifts.current(actor, query);
  }

  @Get()
  @Auth()
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListShiftsQueryDto) {
    return this.shifts.list(actor, query);
  }

  @Get(':id')
  @Auth()
  findOne(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.shifts.findOne(actor, id);
  }

  @Post(':id/close')
  @Auth(UserRole.PointOperator)
  close(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.shifts.close(actor, id);
  }

  @Post(':id/reopen')
  @Auth(UserRole.NetworkOwner)
  reopen(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReopenShiftDto,
  ) {
    return this.shifts.reopen(actor, id, dto);
  }
}

import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ShiftsService } from './shifts.service';
import { OpenShiftDto } from './dto/open-shift.dto';
import { CloseShiftDto } from './dto/close-shift.dto';
import { ReopenShiftDto } from './dto/reopen-shift.dto';
import { SetExplanationDto } from './dto/set-explanation.dto';
import { ListShiftsQueryDto } from './dto/list-shifts.query';
import { CurrentShiftQueryDto } from './dto/current-shift.query';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * A shift is one point's working day. It exists so `intakes` and `payouts`
 * have somewhere to hang a point and a business date, neither of which they
 * store themselves.
 *
 * OPENING NOW COUNTS THE DRAWER (spec §6.1) — `POST /shifts` writes the shift
 * row and its `opening` cash count in one transaction, so a shift can never
 * exist without an opening count for the closing expectation to anchor on.
 * CLOSING DOES THE SAME (Task 6) — `POST /shifts/:id/close` writes the
 * `closing` count in the same transaction as the timestamp. A DISCREPANCY
 * NEVER REFUSES THE CLOSE (client ruling 09.09.2026, overruling §7.7 in
 * full) — `explanation`/`awaiting_explanation` stay unreachable by decision.
 *
 * ROLES ARE NOT UNIFORM HERE, and the split is §10.3 + §10.2:
 *
 *   open, close   → PointOperator ONLY. «Тільки приймальник — і це не помилка…
 *                   Відкрити чужий робочий день і закрити його за людину нема
 *                   кому, а підпис під зведеною касою мусить належати тому, хто
 *                   цю касу тримав у руках.» The owner has neither verb — and
 *                   removing the discrepancy block removed the owner's only
 *                   other reason to be involved in `close`.
 *   reopen        → NetworkOwner ONLY. A correction, and §10.2 puts corrections
 *                   with the owner. It also demotes the shift's `closing` count
 *                   to `midday` (§6.3), so a second close has a free slot.
 *   explanation   → NetworkOwner ONLY (§10.2). §7.7's surviving half: the
 *                   ruling removed the GATE, not the explanation — see
 *                   `SetExplanationDto`. Writing it never moves a number.
 *   reads         → both, scoped by `resolvePointFilter`.
 *
 * `POST /shifts` AND `POST /shifts/:id/close` EACH TAKE ONE FIELD,
 * `counted_amount` — see `OpenShiftDto` / `CloseShiftDto`.
 * `business_date` stays server-derived (foundation §5.2) and the point still
 * comes from the operator's token; `counted_amount` is the one thing a caller
 * supplies, because only a human standing at the drawer can supply it.
 */
@Controller('shifts')
export class ShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  @Post()
  @Auth(UserRole.PointOperator)
  open(@CurrentUser() actor: AuthenticatedUser, @Body() dto: OpenShiftDto) {
    return this.shifts.open(actor, dto);
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
  close(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseShiftDto,
  ) {
    return this.shifts.close(actor, id, dto);
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

  @Put(':id/explanation')
  @Auth(UserRole.NetworkOwner)
  setExplanation(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetExplanationDto,
  ) {
    return this.shifts.setExplanation(actor, id, dto);
  }
}

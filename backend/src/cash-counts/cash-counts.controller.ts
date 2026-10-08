import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CashCountsService } from './cash-counts.service';
import { ListCashCountsQueryDto } from './dto/list-cash-counts.query';
import { CreateCashCountDto } from './dto/create-cash-count.dto';
import { SetCountExplanationDto } from './dto/set-count-explanation.dto';
import { SetCountOperatorNoteDto } from './dto/set-count-operator-note.dto';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * §7.6's journal, and the owner's incident list.
 *
 * `POST` IS NOW A REAL ROUTE (R2, spec `2026-09-22-yagoda-point-cash-parity.md`)
 * — a midday recount. It DOES NOT open an incident: `is_open` stays false for
 * every `midday` row (`cash-count.mapper.ts`) and `only_discrepancies` still
 * excludes `kind = 'midday'` unconditionally (`CashCountsService.list`'s own
 * header) — the CLOSING count is still what carries the day. Earlier drafts of
 * this project's notes (10.09) read «midday = перекрито» as a midday count
 * settling the drawer the way a close does; that reading is FALSE, and this
 * comment is where the correction is recorded, since this is the route that
 * reading would have blocked.
 *
 * `GET` is still both roles, scoped to an operator's own point server-side.
 * `POST` is operator-only (§10.3 — counting a point's own drawer is the
 * operator's alone, same authority as opening/closing a shift).
 *
 * `PUT :id/explanation` is the owner's, `PUT :id/operator-note` is the counter's
 * (spec 2026-10-08) — both through `countNoteRefusal`.
 */
@Controller('cash-counts')
export class CashCountsController {
  constructor(private readonly counts: CashCountsService) {}

  @Get()
  @Auth()
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListCashCountsQueryDto) {
    return this.counts.list(actor, query);
  }

  @Post()
  @Auth(UserRole.PointOperator)
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateCashCountDto) {
    return this.counts.recount(actor, dto);
  }

  @Put(':id/explanation')
  @Auth(UserRole.NetworkOwner)
  setExplanation(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetCountExplanationDto,
  ) {
    return this.counts.setExplanation(actor, id, dto);
  }

  @Put(':id/operator-note')
  @Auth(UserRole.PointOperator)
  setOperatorNote(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetCountOperatorNoteDto,
  ) {
    return this.counts.setOperatorNote(actor, id, dto);
  }
}

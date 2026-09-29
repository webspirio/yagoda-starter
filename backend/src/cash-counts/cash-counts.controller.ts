import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CashCountsService } from './cash-counts.service';
import { ListCashCountsQueryDto } from './dto/list-cash-counts.query';
import { CreateCashCountDto } from './dto/create-cash-count.dto';
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
}

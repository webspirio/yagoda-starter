import { Controller, Get, Query } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JournalTotalsQuery } from './queries/journal-totals.query';
import { JournalTotalsQueryDto } from './dto/journal-totals.query';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/** The journal's tiles (#257). Both roles; scope is `resolvePointFilter`'s, inside the query. */
@Controller('journal-totals')
export class JournalTotalsController {
  constructor(private readonly journalTotals: JournalTotalsQuery) {}

  @Get()
  @Auth()
  totals(@CurrentUser() actor: AuthenticatedUser, @Query() query: JournalTotalsQueryDto) {
    return this.journalTotals.totals(actor, query);
  }
}

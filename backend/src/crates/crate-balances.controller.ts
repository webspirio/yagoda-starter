import { Controller, Get, Query } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CrateBalancesService } from './crate-balances.service';
import { ListCrateBalancesQueryDto } from './dto/list-crate-balances.query';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * The «Ящики» screen — every supplier still holding crates at a point, on one
 * page, where `GET /suppliers/:id/crate-balance` answers for one person.
 *
 * A SECOND CONTROLLER IN THIS MODULE, NOT A SECOND ROUTE ON THE FIRST — the
 * same shape `supplier-balance` already uses, and for the same reason: the
 * single read hangs off `/suppliers/:id`, and a list belongs under its own
 * noun. `/crate-balances` shares a prefix with nothing, so no registration
 * order matters here.
 *
 * Both roles read it: the operator is the one standing at the table handing
 * crates over. The point scope is decided in the SERVICE by
 * `resolvePointFilter`, per the convention that guards decide from the request
 * alone and `resolve*` decides from the data.
 */
@Controller('crate-balances')
export class CrateBalancesController {
  constructor(private readonly balances: CrateBalancesService) {}

  @Get()
  @Auth()
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListCrateBalancesQueryDto) {
    return this.balances.list(actor, query);
  }
}
